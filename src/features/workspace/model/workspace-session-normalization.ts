import {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
} from './workspace-session.types'

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

export function cloneWorkspaceSessionState(state: WorkspaceSessionState) {
  return structuredClone(state)
}

export function workspaceSessionPayloadFits(state: WorkspaceSessionState) {
  return new TextEncoder().encode(JSON.stringify(state)).byteLength <= MAX_WORKSPACE_SESSION_BYTES
}

export function normalizeWorkspaceSessionSnapshot(
  value: unknown,
  recoverStoredSections = false,
): WorkspaceSessionSnapshot | null {
  const input = recoverStoredSections
    ? recordValue(value)
    : exactRecord(value, ['version', 'state', 'updatedAt'])
  if (!input || input.version !== WORKSPACE_SESSION_VERSION) return null
  if (input.updatedAt !== null && integerValue(input.updatedAt, 0, Number.MAX_SAFE_INTEGER) === undefined) return null
  const state = recoverStoredSections
    ? normalizeStoredWorkspaceSessionState(input.state)
    : normalizeWorkspaceSessionState(input.state)
  if (!state || !workspaceSessionPayloadFits(state)) return null
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
