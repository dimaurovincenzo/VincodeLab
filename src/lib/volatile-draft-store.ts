import { optionalVincodeLabBridge, type RendererDraftIdentity, type RendererDraftSnapshot } from '@/bridge'

export type VolatileDraftIdentity = Readonly<RendererDraftIdentity>

export type VolatileDraft = Readonly<Pick<RendererDraftSnapshot, 'content' | 'baseline'>>

type VolatileDraftEntry = VolatileDraft & VolatileDraftIdentity & { sequence: number }
export type VolatileDraftHydrationResult = Readonly<{ invalid: number; loaded: number }>
export type VolatileDraftPersistenceFailure = Readonly<{
  error: unknown
  identity: VolatileDraftIdentity
  operation: 'write' | 'discard'
}>
export type VolatileDraftPersistenceState = Readonly<{
  degraded: boolean
  failures: readonly VolatileDraftPersistenceFailure[]
}>

type InternalPersistenceFailure = VolatileDraftPersistenceFailure & {
  attempt: number
  request: () => Promise<unknown>
}

const MAX_DRAFTS = 128
const MAX_DRAFT_BYTES = 1_000_000
const draftScopes = new Set<VolatileDraftIdentity['scope']>([
  'project-editor', 'project-instructions', 'project-skill',
  'settings-package-source', 'settings-new-skill', 'settings-system-skill',
  'database-sql', 'database-connection', 'database-grid',
])
const drafts = new Map<string, VolatileDraftEntry>()
let sequence = 0
let hydration: Promise<VolatileDraftHydrationResult> | null = null
let hydrationGeneration = 0
let mirrorAttempt = 0
const latestMirrorAttempt = new Map<string, number>()
const mirrorFailures = new Map<string, InternalPersistenceFailure>()
const mirrorFailureListeners = new Set<(state: VolatileDraftPersistenceState) => void>()

function draftKey(identity: VolatileDraftIdentity) {
  return JSON.stringify([identity.scope, identity.workspace, identity.resource])
}

function draftBridge() {
  return optionalVincodeLabBridge()?.volatileDrafts ?? null
}

function persistenceState(): VolatileDraftPersistenceState {
  const failures = [...mirrorFailures.values()].map(({ error, identity, operation }) => ({ error, identity, operation }))
  return Object.freeze({ degraded: failures.length > 0, failures: Object.freeze(failures) })
}

function notifyPersistenceState() {
  const state = persistenceState()
  for (const listener of mirrorFailureListeners) listener(state)
}

async function mirrorRequest(operation: VolatileDraftPersistenceFailure['operation'], identity: VolatileDraftIdentity, request: () => Promise<unknown>) {
  const key = draftKey(identity)
  const attempt = ++mirrorAttempt
  latestMirrorAttempt.set(key, attempt)
  try {
    await request()
    if (latestMirrorAttempt.get(key) !== attempt) return
    latestMirrorAttempt.delete(key)
    if (mirrorFailures.delete(key)) notifyPersistenceState()
  } catch (error) {
    if (latestMirrorAttempt.get(key) !== attempt) return
    const existing = mirrorFailures.get(key)
    mirrorFailures.set(key, { attempt, error, identity, operation, request })
    // Aggiorniamo internamente il retry all’ultima bozza, ma una tempesta dello
    // stesso failure point non deve ridisegnare o annunciare più volte il banner.
    if (!existing || existing.operation !== operation) notifyPersistenceState()
    throw error
  }
}

function queueMirrorRequest(operation: VolatileDraftPersistenceFailure['operation'], identity: VolatileDraftIdentity, request: () => Promise<unknown>) {
  void mirrorRequest(operation, identity, request).catch(() => {
    // L’incidente è posseduto dallo stato degradato sottoscrivibile qui sopra.
  })
}

function mirrorDiscard(identity: VolatileDraftIdentity) {
  const bridge = draftBridge()
  if (!bridge) return
  queueMirrorRequest('discard', identity, () => bridge.discard(identity))
}

function validSnapshot(value: unknown): value is VolatileDraftEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<VolatileDraftEntry>
  return typeof entry.scope === 'string'
    && draftScopes.has(entry.scope as VolatileDraftIdentity['scope'])
    && typeof entry.workspace === 'string'
    && entry.workspace.length <= 4_096
    && typeof entry.resource === 'string'
    && entry.resource.length <= 4_096
    && typeof entry.content === 'string'
    && new Blob([entry.content]).size <= MAX_DRAFT_BYTES
    && typeof entry.baseline === 'string'
    && new Blob([entry.baseline]).size <= MAX_DRAFT_BYTES
}

function trimOldestDrafts() {
  while (drafts.size > MAX_DRAFTS) {
    let oldestKey: string | null = null
    let oldestSequence = Number.POSITIVE_INFINITY
    for (const [key, entry] of drafts) {
      if (entry.sequence >= oldestSequence) continue
      oldestKey = key
      oldestSequence = entry.sequence
    }
    if (!oldestKey) return
    drafts.delete(oldestKey)
  }
}

export function readVolatileDraft(identity: VolatileDraftIdentity): VolatileDraft | null {
  const draft = drafts.get(draftKey(identity))
  return draft ? { content: draft.content, baseline: draft.baseline } : null
}

export function writeVolatileDraft(identity: VolatileDraftIdentity, content: string, baseline: string) {
  const key = draftKey(identity)
  if (content === baseline) {
    drafts.delete(key)
    mirrorDiscard(identity)
    return
  }
  const entry = { ...identity, content, baseline, sequence: ++sequence }
  drafts.set(key, entry)
  trimOldestDrafts()
  const bridge = draftBridge()
  if (bridge) queueMirrorRequest('write', identity, () => bridge.write({ ...identity, content, baseline }))
}

/** Rebase a surviving draft on the latest persisted value after a remount. */
export function restoreVolatileDraft(identity: VolatileDraftIdentity, persistedContent: string) {
  const draft = drafts.get(draftKey(identity))
  if (!draft) return persistedContent
  if (draft.content === persistedContent) {
    drafts.delete(draftKey(identity))
    mirrorDiscard(identity)
    return persistedContent
  }
  writeVolatileDraft(identity, draft.content, persistedContent)
  return draft.content
}

/**
 * Record a completed save without dropping an edit made after that save began.
 */
export function commitVolatileDraft(identity: VolatileDraftIdentity, savedContent: string) {
  const draft = drafts.get(draftKey(identity))
  if (!draft) return
  if (draft.content === savedContent) {
    drafts.delete(draftKey(identity))
    mirrorDiscard(identity)
    return
  }
  writeVolatileDraft(identity, draft.content, savedContent)
}

export function discardVolatileDraft(identity: VolatileDraftIdentity) {
  drafts.delete(draftKey(identity))
  mirrorDiscard(identity)
}

export function latestVolatileDraft(scope: VolatileDraftIdentity['scope'], workspace: string) {
  let latest: VolatileDraftEntry | null = null
  for (const draft of drafts.values()) {
    if (draft.scope !== scope || draft.workspace !== workspace) continue
    if (!latest || draft.sequence > latest.sequence) latest = draft
  }
  return latest ? { resource: latest.resource, content: latest.content, baseline: latest.baseline } : null
}

export function clearVolatileDrafts() {
  const hadFailures = mirrorFailures.size > 0
  drafts.clear()
  sequence = 0
  hydrationGeneration += 1
  hydration = null
  latestMirrorAttempt.clear()
  mirrorFailures.clear()
  if (hadFailures) notifyPersistenceState()
}

/**
 * Invalida soltanto il tentativo di reidratazione corrente. Una risposta IPC
 * tardiva potrà concludersi, ma non potrà più modificare le bozze in memoria.
 */
export function invalidateVolatileDraftHydration() {
  hydrationGeneration += 1
  hydration = null
}

export function getVolatileDraftPersistenceState() {
  return persistenceState()
}

export function subscribeVolatileDraftPersistence(listener: (state: VolatileDraftPersistenceState) => void) {
  mirrorFailureListeners.add(listener)
  listener(persistenceState())
  return () => mirrorFailureListeners.delete(listener)
}

export async function retryVolatileDraftPersistence() {
  const failures = [...mirrorFailures.values()]
  if (failures.length === 0) return
  const attempts = await Promise.allSettled(failures.map((failure) => mirrorRequest(failure.operation, failure.identity, failure.request)))
  const rejected = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected')
  if (rejected) throw rejected.reason
}

/**
 * Reidrata le bozze dalla memoria del processo Electron. Il registro main
 * sopravvive al crash/reload del solo renderer, ma viene perso alla chiusura
 * completa dell'app e non scrive contenuti utente su disco.
 */
export function hydrateVolatileDrafts() {
  if (hydration) return hydration
  const bridge = draftBridge()
  if (!bridge) return Promise.resolve({ invalid: 0, loaded: 0 })
  const generation = ++hydrationGeneration
  hydration = bridge.list().then((snapshots) => {
    if (generation !== hydrationGeneration) return { invalid: 0, loaded: 0 }
    if (!Array.isArray(snapshots)) return { invalid: 1, loaded: 0 }
    let invalid = 0
    let loaded = 0
    for (const snapshot of snapshots) {
      if (!validSnapshot(snapshot)) {
        invalid += 1
        continue
      }
      const identity: VolatileDraftIdentity = {
        scope: snapshot.scope as VolatileDraftIdentity['scope'],
        workspace: snapshot.workspace,
        resource: snapshot.resource,
      }
      const key = draftKey(identity)
      // Una modifica prodotta mentre l'IPC era in volo è più recente dello
      // snapshot main e non deve mai essere sostituita dalla reidratazione.
      if (drafts.has(key)) continue
      drafts.set(key, { ...identity, content: snapshot.content, baseline: snapshot.baseline, sequence: ++sequence })
      loaded += 1
    }
    trimOldestDrafts()
    return { invalid, loaded }
  })
  return hydration
}
