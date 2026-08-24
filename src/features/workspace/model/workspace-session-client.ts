import { optionalVincodeLabBridge, type WorkspaceSessionSnapshot, type WorkspaceSessionState } from '@/bridge'

import {
  cloneWorkspaceSessionState,
  normalizeWorkspaceSessionSnapshot,
  normalizeWorkspaceSessionState,
  workspaceSessionPayloadFits,
} from './workspace-session-normalization'
import {
  WORKSPACE_SESSION_DEBOUNCE_MS,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
} from './workspace-session.types'
import type {
  WorkspaceSessionClientOptions,
  WorkspaceSessionClientSnapshot,
  WorkspaceSessionLoadResult,
  WorkspaceSessionLoadSource,
  WorkspaceSessionRecovery,
  WorkspaceSessionStorage,
  WorkspaceSessionUpdater,
} from './workspace-session.types'

type SessionListener = (snapshot: WorkspaceSessionClientSnapshot) => void
type SaveQueueEntry = {
  generation: number
  revision: number
  promise: Promise<WorkspaceSessionSnapshot | null>
}

function defaultStorage(): WorkspaceSessionStorage {
  const storage = optionalVincodeLabBridge()?.workspaceSession
  if (!storage) {
    throw new Error('Il bridge della sessione workspace non è disponibile.')
  }
  return storage
}

function debounceDelay(value: number | undefined) {
  const delay = value ?? WORKSPACE_SESSION_DEBOUNCE_MS
  if (!Number.isInteger(delay) || delay < 300 || delay > 500) throw new Error('Il debounce della sessione workspace deve essere compreso tra 300 e 500 ms.')
  return delay
}

function errorValue(error: unknown) {
  return error instanceof Error ? error : new Error('Persistenza sessione workspace non disponibile.')
}

export class WorkspaceSessionClient {
  readonly #storage: WorkspaceSessionStorage
  readonly #debounceMs: number
  readonly #onError?: (error: Error) => void
  readonly #listeners = new Set<SessionListener>()
  #state = createDefaultWorkspaceSessionState()
  #generation = 0
  #revision = 0
  #persistedRevision = 0
  #loaded = false
  #saving = 0
  #updatedAt: number | null = null
  #lastError: Error | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #saveTail: Promise<void> = Promise.resolve()
  #lastQueued: SaveQueueEntry | null = null
  #disposed = false

  constructor(options: WorkspaceSessionClientOptions = {}) {
    this.#storage = options.storage ?? defaultStorage()
    this.#debounceMs = debounceDelay(options.debounceMs)
    this.#onError = options.onError
  }

  getSnapshot(): WorkspaceSessionClientSnapshot {
    return {
      state: cloneWorkspaceSessionState(this.#state),
      generation: this.#generation,
      revision: this.#revision,
      persistedRevision: this.#persistedRevision,
      loaded: this.#loaded,
      dirty: this.#revision > this.#persistedRevision,
      saving: this.#saving > 0,
      updatedAt: this.#updatedAt,
      lastError: this.#lastError,
    }
  }

  subscribe(listener: SessionListener) {
    this.#assertActive()
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Avvia una nuova generazione di workspace e rende obsolete le letture precedenti.
   * Chi cambia workspace deve chiamare flush() prima del cambio dell'active workspace:
   * load() scarta intenzionalmente il debounce appartenente alla generazione precedente.
   */
  async load(): Promise<WorkspaceSessionLoadResult> {
    this.#assertActive()
    this.#cancelTimer()
    const generation = ++this.#generation
    this.#state = createDefaultWorkspaceSessionState()
    this.#revision += 1
    this.#persistedRevision = this.#revision
    this.#loaded = false
    this.#updatedAt = null
    this.#lastError = null
    const loadRevision = this.#revision
    this.#emit()

    let value: unknown
    try {
      value = await this.#storage.get()
    } catch (error) {
      if (!this.#isCurrent(generation)) return this.#loadResult(generation, false, 'cancelled')
      if (this.#revision !== loadRevision) {
        this.#loaded = true
        this.#emit()
        return this.#loadResult(generation, false, 'superseded')
      }
      this.#loaded = true
      this.#reportError(errorValue(error))
      this.#emit()
      return this.#loadResult(generation, true, 'fallback')
    }

    if (!this.#isCurrent(generation)) return this.#loadResult(generation, false, 'cancelled')
    if (this.#revision !== loadRevision) {
      this.#loaded = true
      this.#emit()
      return this.#loadResult(generation, false, 'superseded')
    }

    const snapshot = normalizeWorkspaceSessionSnapshot(value, true)
    if (!snapshot) {
      this.#loaded = true
      this.#reportError(new Error('Lo stato della sessione workspace ricevuto non è valido.'))
      this.#emit()
      return this.#loadResult(generation, true, 'fallback')
    }

    this.#state = snapshot.state
    this.#revision += 1
    this.#persistedRevision = this.#revision
    this.#loaded = true
    this.#updatedAt = snapshot.updatedAt
    this.#lastError = null
    this.#emit()
    return this.#loadResult(generation, true, snapshot.updatedAt === null ? 'default' : 'stored', snapshot.recovery ?? null)
  }

  replace(nextState: WorkspaceSessionState) {
    this.#assertActive()
    const state = normalizeWorkspaceSessionState(nextState)
    if (!state || !workspaceSessionPayloadFits(state)) throw new Error('Stato sessione workspace non valido o troppo grande.')
    this.#state = state
    this.#revision += 1
    this.#lastError = null
    this.#emit()
    this.#scheduleSave()
    return cloneWorkspaceSessionState(this.#state)
  }

  patch(updater: WorkspaceSessionUpdater) {
    this.#assertActive()
    return this.replace(updater(cloneWorkspaceSessionState(this.#state)))
  }

  /** Persiste la revisione corrente e attende anche eventuali write già in coda. */
  flush(): Promise<WorkspaceSessionSnapshot | null> {
    if (this.#disposed) return Promise.resolve(null)
    this.#cancelTimer()
    const generation = this.#generation
    const revision = this.#revision
    if (revision <= this.#persistedRevision) return Promise.resolve(null)
    if (this.#lastQueued?.generation === generation && this.#lastQueued.revision >= revision) return this.#lastQueued.promise
    const state = cloneWorkspaceSessionState(this.#state)

    const promise = this.#saveTail.then(async () => {
      if (!this.#isCurrent(generation)) return null
      this.#saving += 1
      this.#emit()
      try {
        const response = normalizeWorkspaceSessionSnapshot(await this.#storage.save({ version: WORKSPACE_SESSION_VERSION, state }))
        if (!response) throw new Error('La conferma di salvataggio della sessione workspace non è valida.')
        if (this.#isCurrent(generation)) {
          this.#persistedRevision = Math.max(this.#persistedRevision, revision)
          this.#updatedAt = response.updatedAt
          this.#lastError = null
        }
        return response
      } catch (error) {
        if (this.#isCurrent(generation)) this.#reportError(errorValue(error))
        throw error
      } finally {
        this.#saving = Math.max(0, this.#saving - 1)
        if (!this.#disposed) this.#emit()
      }
    })
    this.#saveTail = promise.then(() => undefined, () => undefined)
    const entry: SaveQueueEntry = { generation, revision, promise }
    this.#lastQueued = entry
    void promise.then(
      () => { if (this.#lastQueued === entry) this.#lastQueued = null },
      () => { if (this.#lastQueued === entry) this.#lastQueued = null },
    )
    return promise
  }

  dispose() {
    if (this.#disposed) return
    this.#cancelTimer()
    this.#disposed = true
    this.#generation += 1
    this.#listeners.clear()
  }

  #scheduleSave() {
    this.#cancelTimer()
    this.#timer = setTimeout(() => {
      this.#timer = null
      void this.flush().catch(() => {
        // flush() ha già aggiornato lastError e invocato onError; il timer non deve
        // duplicare l'incidente attraverso l'handler globale delle rejection.
      })
    }, this.#debounceMs)
  }

  #cancelTimer() {
    if (this.#timer === null) return
    clearTimeout(this.#timer)
    this.#timer = null
  }

  #loadResult(
    generation: number,
    applied: boolean,
    source: WorkspaceSessionLoadSource,
    recovery: WorkspaceSessionRecovery | null = null,
  ): WorkspaceSessionLoadResult {
    return { state: cloneWorkspaceSessionState(this.#state), generation, applied, source, recovery }
  }

  #isCurrent(generation: number) {
    return !this.#disposed && generation === this.#generation
  }

  #reportError(error: Error) {
    this.#lastError = error
    try {
      this.#onError?.(error)
    } catch {
      // Un observer non deve interrompere restore o coda di persistenza.
    }
  }

  #emit() {
    if (this.#disposed) return
    const snapshot = this.getSnapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }

  #assertActive() {
    if (this.#disposed) throw new Error('Il client della sessione workspace è stato chiuso.')
  }
}

export function createWorkspaceSessionClient(options: WorkspaceSessionClientOptions = {}) {
  return new WorkspaceSessionClient(options)
}
