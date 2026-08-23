import type { FuzzyUsageSignal } from './fuzzy-score'

export type WorkbenchHistoryKind = 'command' | 'file'

export type WorkbenchHistoryEntry = Readonly<{
  id: string
  scope?: string
  lastUsedAt: number
  useCount: number
}>

export type WorkbenchHistoryStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>

export type WorkbenchHistoryOptions = Readonly<{
  storage?: WorkbenchHistoryStorage | null
  storageKey?: string
  maxCommands?: number
  maxFiles?: number
  now?: () => number
}>

export type WorkbenchHistoryListener = () => void

type WorkbenchHistorySnapshot = {
  version: 1
  commands: WorkbenchHistoryEntry[]
  files: WorkbenchHistoryEntry[]
}

const defaultStorageKey = 'vincodelab.workbench-history.v1'

function emptySnapshot(): WorkbenchHistorySnapshot {
  return { version: 1, commands: [], files: [] }
}

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function normalizeLimit(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value ?? fallback))
}

function normalizeEntry(value: unknown): WorkbenchHistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<WorkbenchHistoryEntry>
  if (typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 4_096) return null
  if (entry.scope !== undefined && (typeof entry.scope !== 'string' || entry.scope.length > 1_024)) return null
  if (!Number.isFinite(entry.lastUsedAt) || !Number.isFinite(entry.useCount)) return null
  return {
    id: entry.id,
    ...(entry.scope ? { scope: entry.scope } : {}),
    lastUsedAt: Math.max(0, entry.lastUsedAt ?? 0),
    useCount: Math.max(1, Math.floor(entry.useCount ?? 1)),
  }
}

function historyKey(entry: Pick<WorkbenchHistoryEntry, 'id' | 'scope'>) {
  return `${entry.scope ?? ''}\u0000${entry.id}`
}

function compareEntries(left: WorkbenchHistoryEntry, right: WorkbenchHistoryEntry) {
  if (left.lastUsedAt !== right.lastUsedAt) return right.lastUsedAt - left.lastUsedAt
  if (left.useCount !== right.useCount) return right.useCount - left.useCount
  const leftKey = historyKey(left)
  const rightKey = historyKey(right)
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function readEntries(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, WorkbenchHistoryEntry>()
  for (const candidate of value) {
    const entry = normalizeEntry(candidate)
    if (!entry) continue
    const key = historyKey(entry)
    const existing = unique.get(key)
    if (!existing || compareEntries(entry, existing) < 0) unique.set(key, entry)
  }
  return [...unique.values()].sort(compareEntries).slice(0, limit)
}

export function createMemoryHistoryStorage(initial: Record<string, string> = {}): WorkbenchHistoryStorage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

export class WorkbenchUsageHistory {
  readonly #listeners = new Set<WorkbenchHistoryListener>()
  readonly #storage?: WorkbenchHistoryStorage
  readonly #storageKey: string
  readonly #limits: Record<WorkbenchHistoryKind, number>
  readonly #now: () => number
  #snapshot: WorkbenchHistorySnapshot

  constructor(options: WorkbenchHistoryOptions = {}) {
    this.#storage = options.storage === null ? undefined : (options.storage ?? defaultStorage())
    this.#storageKey = options.storageKey ?? defaultStorageKey
    this.#limits = {
      command: normalizeLimit(options.maxCommands, 80),
      file: normalizeLimit(options.maxFiles, 200),
    }
    this.#now = options.now ?? Date.now
    this.#snapshot = this.#readSnapshot()
  }

  subscribe(listener: WorkbenchHistoryListener) {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  recordCommand(id: string) {
    return this.record('command', id)
  }

  recordFile(id: string, scope?: string) {
    return this.record('file', id, scope)
  }

  record(kind: WorkbenchHistoryKind, id: string, scope?: string) {
    if (!id.trim()) throw new Error('History metadata requires a non-empty id.')
    if (id.length > 4_096 || (scope?.length ?? 0) > 1_024) {
      throw new Error('History metadata exceeds the supported length.')
    }

    const list = this.#listFor(kind)
    const key = historyKey({ id, scope })
    const previous = list.find((entry) => historyKey(entry) === key)
    const timestamp = this.#now()
    const entry: WorkbenchHistoryEntry = {
      id,
      ...(scope ? { scope } : {}),
      lastUsedAt: Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0,
      useCount: Math.min(Number.MAX_SAFE_INTEGER, (previous?.useCount ?? 0) + 1),
    }
    const next = [entry, ...list.filter((candidate) => historyKey(candidate) !== key)]
      .sort(compareEntries)
      .slice(0, this.#limits[kind])
    this.#setList(kind, next)
    this.#persist()
    this.#emitChange()
    return entry
  }

  list(kind: WorkbenchHistoryKind) {
    return [...this.#listFor(kind)]
  }

  find(kind: WorkbenchHistoryKind, id: string, scope?: string) {
    const key = historyKey({ id, scope })
    return this.#listFor(kind).find((entry) => historyKey(entry) === key)
  }

  getUsage(kind: WorkbenchHistoryKind, id: string, scope?: string): FuzzyUsageSignal | undefined {
    const entry = this.find(kind, id, scope)
    return entry ? { lastUsedAt: entry.lastUsedAt, frequency: entry.useCount } : undefined
  }

  remove(kind: WorkbenchHistoryKind, id: string, scope?: string) {
    const key = historyKey({ id, scope })
    const list = this.#listFor(kind)
    const next = list.filter((entry) => historyKey(entry) !== key)
    if (next.length === list.length) return false
    this.#setList(kind, next)
    this.#persist()
    this.#emitChange()
    return true
  }

  clear(kind?: WorkbenchHistoryKind) {
    if (kind) this.#setList(kind, [])
    else this.#snapshot = emptySnapshot()
    this.#persist()
    this.#emitChange()
  }

  #listFor(kind: WorkbenchHistoryKind) {
    return kind === 'command' ? this.#snapshot.commands : this.#snapshot.files
  }

  #setList(kind: WorkbenchHistoryKind, list: WorkbenchHistoryEntry[]) {
    if (kind === 'command') this.#snapshot = { ...this.#snapshot, commands: list }
    else this.#snapshot = { ...this.#snapshot, files: list }
  }

  #readSnapshot(): WorkbenchHistorySnapshot {
    if (!this.#storage) return emptySnapshot()
    try {
      const raw = this.#storage.getItem(this.#storageKey)
      if (!raw) return emptySnapshot()
      const parsed = JSON.parse(raw) as Partial<WorkbenchHistorySnapshot>
      if (parsed.version !== 1) return emptySnapshot()
      return {
        version: 1,
        commands: readEntries(parsed.commands, this.#limits.command),
        files: readEntries(parsed.files, this.#limits.file),
      }
    } catch {
      return emptySnapshot()
    }
  }

  #persist() {
    if (!this.#storage) return
    try {
      this.#storage.setItem(this.#storageKey, JSON.stringify(this.#snapshot))
    } catch {
      // Persistence is best effort; in-memory history remains available.
    }
  }

  #emitChange() {
    for (const listener of this.#listeners) listener()
  }
}
