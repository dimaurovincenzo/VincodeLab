import { optionalVincodeLabBridge } from '@/bridge'

export const WORKSPACE_SESSION_VERSION = 2 as const
export const WORKSPACE_SESSION_DEBOUNCE_MS = 400
export const MAX_WORKSPACE_SESSION_BYTES = 256 * 1024

const APP_SECTIONS = ['ai', 'editor', 'terminal', 'github', 'database', 'redis', 'settings'] as const
const AI_TABS = ['terminal', 'skills', 'instructions'] as const
const FILE_SOURCES = ['workspace', 'remote'] as const
const EDITOR_FILE_MODES = ['source', 'preview'] as const
const TERMINAL_TABS = ['shell', 'remote'] as const
const REMOTE_VIEWS = ['server', 'local'] as const
const GITHUB_TABS = ['changes', 'graph', 'issues', 'projects'] as const
const ISSUE_STATE_FILTERS = ['all', 'OPEN', 'CLOSED'] as const
const DATABASE_SIDEBAR_TABS = ['items', 'queries', 'history'] as const
const DATABASE_VIEWS = ['sql', 'data'] as const
const REDIS_VIEWS = ['keys', 'search'] as const
const REDIS_KEY_TYPES = ['all', 'string', 'hash', 'list', 'set', 'zset', 'stream', 'json'] as const
const REDIS_INSPECTOR_TABS = ['value', 'metadata'] as const
const FOCUS_TARGETS = [
  'ai.terminal',
  'ai.instructions',
  'ai.skills',
  'editor.code',
  'editor.tabs',
  'editor.tree',
  'terminal.shell',
  'terminal.commands',
  'terminal.remote',
  'github.changes',
  'github.diff',
  'github.graph',
  'github.issues',
  'github.projects',
  'database.query',
  'database.results',
  'database.schema',
  'redis.keys',
  'redis.search',
  'redis.inspector',
  'settings.primary',
] as const

const ROOT_KEYS = ['navigation', 'editor', 'terminal', 'github', 'database', 'redis', 'panels', 'focus'] as const
const PANEL_KEYS = ['editorExplorer', 'terminalCommands', 'remoteConnections', 'databaseSidebar', 'githubProjectPicker'] as const

export type WorkspaceSessionClientState = WorkspaceSessionState
export type WorkspaceSessionStorage = Pick<Window['vincodeLab']['workspaceSession'], 'get' | 'save'>
export type WorkspaceSessionUpdater = (current: Readonly<WorkspaceSessionState>) => WorkspaceSessionState
export type WorkspaceSessionLoadSource = 'stored' | 'default' | 'fallback' | 'cancelled' | 'superseded'
export type WorkspaceSessionRecovery = Readonly<{
  correlationId: string
  kind: 'corrupt'
}>

export type WorkspaceSessionClientSnapshot = Readonly<{
  state: WorkspaceSessionState
  generation: number
  revision: number
  persistedRevision: number
  loaded: boolean
  dirty: boolean
  saving: boolean
  updatedAt: number | null
  lastError: Error | null
}>

export type WorkspaceSessionLoadResult = Readonly<{
  state: WorkspaceSessionState
  generation: number
  applied: boolean
  source: WorkspaceSessionLoadSource
  recovery: WorkspaceSessionRecovery | null
}>

export type WorkspaceSessionClientOptions = Readonly<{
  storage?: WorkspaceSessionStorage
  debounceMs?: number
  onError?: (error: Error) => void
}>

type SessionListener = (snapshot: WorkspaceSessionClientSnapshot) => void
type SaveQueueEntry = {
  generation: number
  revision: number
  promise: Promise<WorkspaceSessionSnapshot | null>
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const actualKeys = Object.keys(record)
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keys.includes(key))) return null
  return record
}

function recordWithOptionalKeys(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const allowedKeys = [...requiredKeys, ...optionalKeys]
  const actualKeys = Object.keys(record)
  if (actualKeys.some((key) => !allowedKeys.includes(key)) || requiredKeys.some((key) => !Object.hasOwn(record, key))) return null
  return record
}

function enumValue<const T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined
}

function textValue(value: unknown, maxLength: number, options: { opaque?: boolean; relativePath?: boolean } = {}) {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) return undefined
  if (options.opaque && !/^[A-Za-z0-9._:-]+$/.test(value)) return undefined
  if (options.relativePath) {
    const normalized = value.replace(/\\/g, '/')
    if (normalized.startsWith('/') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return undefined
  }
  return value
}

function nullableTextValue(value: unknown, maxLength: number, options: { opaque?: boolean; relativePath?: boolean } = {}) {
  if (value === null) return null
  return textValue(value, maxLength, options)
}

function numberValue(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined
}

function integerValue(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum ? value as number : undefined
}

function nullableIntegerValue(value: unknown, minimum: number, maximum: number) {
  if (value === null) return null
  return integerValue(value, minimum, maximum)
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  return new Set(items.map(key)).size === items.length
}

function normalizeFileRef(value: unknown): WorkspaceSessionFileRef | null {
  const input = recordWithOptionalKeys(value, ['source', 'id'], ['mode'])
  if (!input) return null
  const source = enumValue(input.source, FILE_SOURCES)
  if (!source) return null
  const id = source === 'workspace'
    ? textValue(input.id, 4_096, { relativePath: true })
    : textValue(input.id, 128, { opaque: true })
  const mode = Object.hasOwn(input, 'mode') ? enumValue(input.mode, EDITOR_FILE_MODES) : undefined
  if (!id || (Object.hasOwn(input, 'mode') && !mode)) return null
  return { source, id, ...(mode ? { mode } : {}) }
}

function fileRefKey(file: WorkspaceSessionFileRef) {
  return `${file.source}:${file.id}`
}

function normalizeFileView(value: unknown): WorkspaceSessionFileView | null {
  const input = recordWithOptionalKeys(value, ['source', 'id', 'selection', 'scroll'], ['mode'])
  if (!input) return null
  const file = normalizeFileRef({
    source: input.source,
    id: input.id,
    ...(Object.hasOwn(input, 'mode') ? { mode: input.mode } : {}),
  })
  const selection = exactRecord(input.selection, ['anchor', 'head'])
  const scroll = exactRecord(input.scroll, ['top', 'left'])
  if (!file || !selection || !scroll) return null
  const anchor = integerValue(selection.anchor, 0, 2_000_000)
  const head = integerValue(selection.head, 0, 2_000_000)
  const top = numberValue(scroll.top, 0, 100_000_000)
  const left = numberValue(scroll.left, 0, 100_000_000)
  if (anchor === undefined || head === undefined || top === undefined || left === undefined) return null
  return { ...file, selection: { anchor, head }, scroll: { top, left } }
}

function normalizeScrollGroup(value: unknown, keys: readonly string[]) {
  const input = exactRecord(value, keys)
  if (!input) return null
  const result: Record<string, number> = {}
  for (const key of keys) {
    const position = numberValue(input[key], 0, 100_000_000)
    if (position === undefined) return null
    result[key] = position
  }
  return result
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/**
 * Il restore accetta campi aggiunti da una revisione futura della stessa v1,
 * ma li elimina prima che lo stato raggiunga React o una write successiva.
 * Valori e campi richiesti restano invece validati dal normalizzatore stretto.
 */
function knownProperties(value: unknown, keys: readonly string[]): unknown {
  const input = recordValue(value)
  if (!input) return value
  return Object.fromEntries(
    keys
      .filter((key) => Object.hasOwn(input, key))
      .map((key) => [key, input[key]]),
  )
}

function compatibleFileRef(value: unknown) {
  return knownProperties(value, ['source', 'id', 'mode'])
}

function compatibleFileView(value: unknown) {
  const result = knownProperties(value, ['source', 'id', 'mode', 'selection', 'scroll'])
  const record = recordValue(result)
  if (!record) return result
  if (Object.hasOwn(record, 'selection')) record.selection = knownProperties(record.selection, ['anchor', 'head'])
  if (Object.hasOwn(record, 'scroll')) record.scroll = knownProperties(record.scroll, ['top', 'left'])
  return record
}

function compatibleEditor(value: unknown) {
  const result = knownProperties(value, ['openFiles', 'activeFile', 'expandedDirectoryIds', 'fileViews'])
  const record = recordValue(result)
  if (!record) return result
  if (Array.isArray(record.openFiles)) record.openFiles = record.openFiles.map(compatibleFileRef)
  if (record.activeFile !== null && Object.hasOwn(record, 'activeFile')) record.activeFile = compatibleFileRef(record.activeFile)
  if (Array.isArray(record.fileViews)) record.fileViews = record.fileViews.map(compatibleFileView)
  return record
}

function compatibleGitHub(value: unknown) {
  const result = knownProperties(value, ['tab', 'selectedDiffPath', 'selectedProjectNumber', 'issueStateFilter', 'scroll'])
  const record = recordValue(result)
  if (!record) return result
  if (Object.hasOwn(record, 'scroll')) record.scroll = knownProperties(record.scroll, ['changes', 'graph', 'issues', 'projects'])
  return record
}

function compatibleDatabase(value: unknown) {
  const result = knownProperties(value, [
    'selectedConnectionId',
    'sidebarTab',
    'view',
    'expandedSchemaIds',
    'selectedTableName',
    'activeSavedQueryId',
    'scroll',
  ])
  const record = recordValue(result)
  if (!record) return result
  if (Object.hasOwn(record, 'scroll')) record.scroll = knownProperties(record.scroll, ['explorer', 'editor', 'results'])
  return record
}

function compatibleRedis(value: unknown) {
  return knownProperties(value, ['selectedConnectionId', 'databaseIndex', 'view', 'typeFilter', 'inspectorTab'])
}

function normalizeStoredWorkspaceSessionState(value: unknown): WorkspaceSessionState | null {
  const root = recordValue(value)
  if (!root) return null
  const defaults = createDefaultWorkspaceSessionState()

  const normalizeSection = <Key extends keyof WorkspaceSessionState>(
    key: Key,
    candidate: unknown,
  ): WorkspaceSessionState[Key] => {
    const normalized = normalizeWorkspaceSessionState({ ...defaults, [key]: candidate })
    return normalized?.[key] ?? defaults[key]
  }

  return {
    navigation: normalizeSection('navigation', knownProperties(root.navigation, ['section', 'aiTab'])),
    editor: normalizeSection('editor', compatibleEditor(root.editor)),
    terminal: normalizeSection('terminal', knownProperties(root.terminal, [
      'tab',
      'remoteView',
      'selectedProfileCommandId',
      'openSessionCount',
      'activeSessionOrdinal',
    ])),
    github: normalizeSection('github', compatibleGitHub(root.github)),
    database: normalizeSection('database', compatibleDatabase(root.database)),
    redis: normalizeSection('redis', compatibleRedis(root.redis)),
    panels: normalizeSection('panels', knownProperties(root.panels, PANEL_KEYS)),
    focus: normalizeSection('focus', knownProperties(root.focus, ['view', 'target'])),
  }
}

export function normalizeWorkspaceSessionState(value: unknown): WorkspaceSessionState | null {
  const root = exactRecord(value, ROOT_KEYS)
  if (!root) return null

  const navigationInput = exactRecord(root.navigation, ['section', 'aiTab'])
  if (!navigationInput) return null
  const section = enumValue(navigationInput.section, APP_SECTIONS)
  const aiTab = enumValue(navigationInput.aiTab, AI_TABS)
  if (!section || !aiTab) return null

  const editorInput = exactRecord(root.editor, ['openFiles', 'activeFile', 'expandedDirectoryIds', 'fileViews'])
  if (!editorInput || !Array.isArray(editorInput.openFiles) || editorInput.openFiles.length > 100) return null
  const openFiles = editorInput.openFiles.map(normalizeFileRef)
  if (openFiles.some((file) => file === null)) return null
  const normalizedOpenFiles = openFiles as WorkspaceSessionFileRef[]
  if (!uniqueBy(normalizedOpenFiles, fileRefKey)) return null
  const activeFile = editorInput.activeFile === null ? null : normalizeFileRef(editorInput.activeFile)
  if (activeFile === null && editorInput.activeFile !== null) return null
  const openFileKeys = new Set(normalizedOpenFiles.map(fileRefKey))
  if (activeFile && !openFileKeys.has(fileRefKey(activeFile))) return null
  if (!Array.isArray(editorInput.expandedDirectoryIds) || editorInput.expandedDirectoryIds.length > 1_000) return null
  const expandedDirectoryIds = editorInput.expandedDirectoryIds.map((id) => textValue(id, 4_096, { relativePath: true }))
  if (expandedDirectoryIds.some((id) => id === undefined)) return null
  const normalizedDirectoryIds = expandedDirectoryIds as string[]
  if (!uniqueBy(normalizedDirectoryIds, (id) => id)) return null
  if (!Array.isArray(editorInput.fileViews) || editorInput.fileViews.length > 100) return null
  const fileViews = editorInput.fileViews.map(normalizeFileView)
  if (fileViews.some((view) => view === null)) return null
  const normalizedFileViews = fileViews as WorkspaceSessionFileView[]
  if (!uniqueBy(normalizedFileViews, fileRefKey) || normalizedFileViews.some((view) => !openFileKeys.has(fileRefKey(view)))) return null

  const terminalInput = recordWithOptionalKeys(
    root.terminal,
    ['tab', 'remoteView', 'selectedProfileCommandId'],
    ['openSessionCount', 'activeSessionOrdinal'],
  )
  if (!terminalInput) return null
  const terminalTab = enumValue(terminalInput.tab, TERMINAL_TABS)
  const remoteView = enumValue(terminalInput.remoteView, REMOTE_VIEWS)
  const selectedProfileCommandId = nullableTextValue(terminalInput.selectedProfileCommandId, 128, { opaque: true })
  const openSessionCount = Object.hasOwn(terminalInput, 'openSessionCount')
    ? integerValue(terminalInput.openSessionCount, 0, 8)
    : 0
  const activeSessionOrdinal = Object.hasOwn(terminalInput, 'activeSessionOrdinal')
    ? nullableIntegerValue(terminalInput.activeSessionOrdinal, 0, 7)
    : null
  if (
    !terminalTab
    || !remoteView
    || selectedProfileCommandId === undefined
    || openSessionCount === undefined
    || activeSessionOrdinal === undefined
  ) return null

  const githubInput = exactRecord(root.github, ['tab', 'selectedDiffPath', 'selectedProjectNumber', 'issueStateFilter', 'scroll'])
  if (!githubInput) return null
  const githubTab = enumValue(githubInput.tab, GITHUB_TABS)
  const selectedDiffPath = nullableTextValue(githubInput.selectedDiffPath, 4_096, { relativePath: true })
  const selectedProjectNumber = nullableIntegerValue(githubInput.selectedProjectNumber, 1, 1_000_000_000)
  const issueStateFilter = enumValue(githubInput.issueStateFilter, ISSUE_STATE_FILTERS)
  const githubScroll = normalizeScrollGroup(githubInput.scroll, ['changes', 'graph', 'issues', 'projects'])
  if (!githubTab || selectedDiffPath === undefined || selectedProjectNumber === undefined || !issueStateFilter || !githubScroll) return null

  const databaseInput = exactRecord(root.database, [
    'selectedConnectionId',
    'sidebarTab',
    'view',
    'expandedSchemaIds',
    'selectedTableName',
    'activeSavedQueryId',
    'scroll',
  ])
  if (!databaseInput) return null
  const selectedConnectionId = nullableTextValue(databaseInput.selectedConnectionId, 128, { opaque: true })
  const sidebarTab = enumValue(databaseInput.sidebarTab, DATABASE_SIDEBAR_TABS)
  const databaseView = enumValue(databaseInput.view, DATABASE_VIEWS)
  const selectedTableName = nullableTextValue(databaseInput.selectedTableName, 512)
  const activeSavedQueryId = nullableTextValue(databaseInput.activeSavedQueryId, 128, { opaque: true })
  if (!Array.isArray(databaseInput.expandedSchemaIds) || databaseInput.expandedSchemaIds.length > 500) return null
  const expandedSchemaIds = databaseInput.expandedSchemaIds.map((id) => textValue(id, 512))
  if (expandedSchemaIds.some((id) => id === undefined)) return null
  const normalizedSchemaIds = expandedSchemaIds as string[]
  const databaseScroll = normalizeScrollGroup(databaseInput.scroll, ['explorer', 'editor', 'results'])
  if (
    selectedConnectionId === undefined
    || !sidebarTab
    || !databaseView
    || selectedTableName === undefined
    || activeSavedQueryId === undefined
    || !uniqueBy(normalizedSchemaIds, (id) => id)
    || !databaseScroll
  ) return null

  const redisInput = exactRecord(root.redis, ['selectedConnectionId', 'databaseIndex', 'view', 'typeFilter', 'inspectorTab'])
  if (!redisInput) return null
  const redisConnectionId = nullableTextValue(redisInput.selectedConnectionId, 128, { opaque: true })
  const redisDatabaseIndex = integerValue(redisInput.databaseIndex, 0, 65_535)
  const redisView = enumValue(redisInput.view, REDIS_VIEWS)
  const redisTypeFilter = enumValue(redisInput.typeFilter, REDIS_KEY_TYPES)
  const redisInspectorTab = enumValue(redisInput.inspectorTab, REDIS_INSPECTOR_TABS)
  if (
    redisConnectionId === undefined
    || redisDatabaseIndex === undefined
    || !redisView
    || !redisTypeFilter
    || !redisInspectorTab
  ) return null

  const panelsInput = exactRecord(root.panels, PANEL_KEYS)
  if (!panelsInput) return null
  const panelValues: Record<string, number | null> = {}
  for (const key of PANEL_KEYS) {
    const panelSize = panelsInput[key] === null ? null : numberValue(panelsInput[key], 0, 10_000)
    if (panelSize === undefined) return null
    panelValues[key] = panelSize
  }

  const focusInput = exactRecord(root.focus, ['view', 'target'])
  if (!focusInput) return null
  const focusView = enumValue(focusInput.view, APP_SECTIONS)
  const focusTarget = focusInput.target === null ? null : enumValue(focusInput.target, FOCUS_TARGETS)
  if (!focusView || focusTarget === undefined) return null

  return {
    navigation: { section, aiTab },
    editor: {
      openFiles: normalizedOpenFiles,
      activeFile,
      expandedDirectoryIds: normalizedDirectoryIds,
      fileViews: normalizedFileViews,
    },
    terminal: { tab: terminalTab, remoteView, selectedProfileCommandId, openSessionCount, activeSessionOrdinal },
    github: {
      tab: githubTab,
      selectedDiffPath,
      selectedProjectNumber,
      issueStateFilter,
      scroll: {
        changes: githubScroll.changes,
        graph: githubScroll.graph,
        issues: githubScroll.issues,
        projects: githubScroll.projects,
      },
    },
    database: {
      selectedConnectionId,
      sidebarTab,
      view: databaseView,
      expandedSchemaIds: normalizedSchemaIds,
      selectedTableName,
      activeSavedQueryId,
      scroll: {
        explorer: databaseScroll.explorer,
        editor: databaseScroll.editor,
        results: databaseScroll.results,
      },
    },
    redis: {
      selectedConnectionId: redisConnectionId,
      databaseIndex: redisDatabaseIndex,
      view: redisView,
      typeFilter: redisTypeFilter,
      inspectorTab: redisInspectorTab,
    },
    panels: {
      editorExplorer: panelValues.editorExplorer,
      terminalCommands: panelValues.terminalCommands,
      remoteConnections: panelValues.remoteConnections,
      databaseSidebar: panelValues.databaseSidebar,
      githubProjectPicker: panelValues.githubProjectPicker,
    },
    focus: { view: focusView, target: focusTarget },
  }
}

export function createDefaultWorkspaceSessionState(): WorkspaceSessionState {
  return {
    navigation: { section: 'ai', aiTab: 'terminal' },
    editor: { openFiles: [], activeFile: null, expandedDirectoryIds: [], fileViews: [] },
    terminal: {
      tab: 'shell',
      remoteView: 'server',
      selectedProfileCommandId: null,
      openSessionCount: 0,
      activeSessionOrdinal: null,
    },
    github: {
      tab: 'changes',
      selectedDiffPath: null,
      selectedProjectNumber: null,
      issueStateFilter: 'OPEN',
      scroll: { changes: 0, graph: 0, issues: 0, projects: 0 },
    },
    database: {
      selectedConnectionId: null,
      sidebarTab: 'items',
      view: 'sql',
      expandedSchemaIds: [],
      selectedTableName: null,
      activeSavedQueryId: null,
      scroll: { explorer: 0, editor: 0, results: 0 },
    },
    redis: {
      selectedConnectionId: null,
      databaseIndex: 0,
      view: 'keys',
      typeFilter: 'all',
      inspectorTab: 'value',
    },
    panels: {
      editorExplorer: null,
      terminalCommands: null,
      remoteConnections: null,
      databaseSidebar: null,
      githubProjectPicker: null,
    },
    focus: { view: 'ai', target: null },
  }
}

function cloneState(state: WorkspaceSessionState) {
  return structuredClone(state)
}

function payloadFits(state: WorkspaceSessionState) {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength <= MAX_WORKSPACE_SESSION_BYTES
}

function normalizeSnapshot(value: unknown, recoverStoredSections = false): WorkspaceSessionSnapshot | null {
  const input = recoverStoredSections
    ? recordValue(value)
    : exactRecord(value, ['version', 'state', 'updatedAt'])
  if (!input || input.version !== WORKSPACE_SESSION_VERSION) return null
  if (input.updatedAt !== null && integerValue(input.updatedAt, 0, Number.MAX_SAFE_INTEGER) === undefined) return null
  const state = recoverStoredSections
    ? normalizeStoredWorkspaceSessionState(input.state)
    : normalizeWorkspaceSessionState(input.state)
  if (!state || !payloadFits(state)) return null
  const recoveryInput = recoverStoredSections && Object.hasOwn(input, 'recovery')
    ? exactRecord(input.recovery, ['correlationId', 'kind'])
    : null
  const recovery = recoveryInput
    && recoveryInput.kind === 'corrupt'
    && typeof recoveryInput.correlationId === 'string'
    && /^ERR-[A-F0-9]{6}$/u.test(recoveryInput.correlationId)
    ? { correlationId: recoveryInput.correlationId, kind: 'corrupt' as const }
    : undefined
  if (recoverStoredSections && Object.hasOwn(input, 'recovery') && !recovery) return null
  return { version: WORKSPACE_SESSION_VERSION, state, updatedAt: input.updatedAt as number | null, ...(recovery ? { recovery } : {}) }
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
      state: cloneState(this.#state),
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

    const snapshot = normalizeSnapshot(value, true)
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
    if (!state || !payloadFits(state)) throw new Error('Stato sessione workspace non valido o troppo grande.')
    this.#state = state
    this.#revision += 1
    this.#lastError = null
    this.#emit()
    this.#scheduleSave()
    return cloneState(this.#state)
  }

  patch(updater: WorkspaceSessionUpdater) {
    this.#assertActive()
    return this.replace(updater(cloneState(this.#state)))
  }

  /** Persiste la revisione corrente e attende anche eventuali write già in coda. */
  flush(): Promise<WorkspaceSessionSnapshot | null> {
    if (this.#disposed) return Promise.resolve(null)
    this.#cancelTimer()
    const generation = this.#generation
    const revision = this.#revision
    if (revision <= this.#persistedRevision) return Promise.resolve(null)
    if (this.#lastQueued?.generation === generation && this.#lastQueued.revision >= revision) return this.#lastQueued.promise
    const state = cloneState(this.#state)

    const promise = this.#saveTail.then(async () => {
      if (!this.#isCurrent(generation)) return null
      this.#saving += 1
      this.#emit()
      try {
        const response = normalizeSnapshot(await this.#storage.save({ version: WORKSPACE_SESSION_VERSION, state }))
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
    return { state: cloneState(this.#state), generation, applied, source, recovery }
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
