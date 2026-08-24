const path = require('node:path')
const { createCorrelationId } = require('../../domains/errors/application-error.cjs')
const { getDatabase } = require('./workspace.repository.cjs')

const WORKSPACE_SESSION_VERSION = 2
const LEGACY_WORKSPACE_SESSION_VERSION = 1
const MAX_WORKSPACE_SESSION_BYTES = 256 * 1024

const APP_SECTIONS = new Set(['ai', 'editor', 'terminal', 'github', 'database', 'redis', 'settings'])
const AI_TABS = new Set(['terminal', 'skills', 'instructions'])
const FILE_SOURCES = new Set(['workspace', 'remote'])
const EDITOR_FILE_MODES = new Set(['source', 'preview'])
const TERMINAL_TABS = new Set(['shell', 'remote'])
const REMOTE_VIEWS = new Set(['server', 'local'])
const GITHUB_TABS = new Set(['changes', 'graph', 'issues', 'projects'])
const ISSUE_STATE_FILTERS = new Set(['all', 'OPEN', 'CLOSED'])
const DATABASE_SIDEBAR_TABS = new Set(['items', 'queries', 'history'])
const DATABASE_VIEWS = new Set(['sql', 'data'])
const REDIS_VIEWS = new Set(['keys', 'search'])
const REDIS_KEY_TYPES = new Set(['all', 'string', 'hash', 'list', 'set', 'zset', 'stream', 'json'])
const REDIS_INSPECTOR_TABS = new Set(['value', 'metadata'])
const FOCUS_TARGETS = new Set([
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
])

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS workspace_ui_state (
      workspace_path TEXT PRIMARY KEY NOT NULL,
      schema_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workspace_ui_state_updated_at
      ON workspace_ui_state(updated_at DESC);
  `)
}

function assertWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.length > 4_096 || workspacePath.includes('\0')) {
    throw new Error('Workspace non valido.')
  }
  return workspacePath
}

function assertObject(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} non valido.`)
  const keys = Object.keys(value)
  if (keys.some((key) => !allowedKeys.includes(key))) throw new Error(`${label} contiene campi non consentiti.`)
  return value
}

function assertArray(value, label, maxLength) {
  if (!Array.isArray(value) || value.length > maxLength) throw new Error(`${label} non valido.`)
  return value
}

function assertEnum(value, label, allowedValues) {
  if (!allowedValues.has(value)) throw new Error(`${label} non valido.`)
  return value
}

function assertNullableString(value, label, maxLength, { opaque = false, relativePath = false } = {}) {
  if (value === null) return null
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) throw new Error(`${label} non valido.`)
  if (opaque && !/^[A-Za-z0-9._:-]+$/.test(value)) throw new Error(`${label} non valido.`)
  if (relativePath) {
    const normalized = value.replace(/\\/g, '/')
    if (path.isAbsolute(value) || normalized.startsWith('/') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error(`${label} non valido.`)
    }
  }
  return value
}

function assertString(value, label, maxLength, options) {
  const result = assertNullableString(value, label, maxLength, options)
  if (result === null) throw new Error(`${label} non valido.`)
  return result
}

function assertNullableInteger(value, label, min, max) {
  if (value === null) return null
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} non valido.`)
  return value
}

function assertInteger(value, label, min, max) {
  const result = assertNullableInteger(value, label, min, max)
  if (result === null) throw new Error(`${label} non valido.`)
  return result
}

function assertNumber(value, label, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} non valido.`)
  return value
}

function assertUnique(items, key, label) {
  if (new Set(items.map(key)).size !== items.length) throw new Error(`${label} contiene duplicati.`)
  return items
}

function validateFileRef(input, label) {
  const value = assertObject(input, label, ['source', 'id', 'mode'])
  const source = assertEnum(value.source, `${label}: origine`, FILE_SOURCES)
  const id = source === 'workspace'
    ? assertString(value.id, `${label}: file`, 4_096, { relativePath: true })
    : assertString(value.id, `${label}: file`, 128, { opaque: true })
  const mode = Object.hasOwn(value, 'mode')
    ? assertEnum(value.mode, `${label}: modalità`, EDITOR_FILE_MODES)
    : undefined
  return { source, id, ...(mode ? { mode } : {}) }
}

function fileRefKey(file) {
  return `${file.source}:${file.id}`
}

function validateFileView(input, label) {
  const value = assertObject(input, label, ['source', 'id', 'mode', 'selection', 'scroll'])
  const file = validateFileRef({
    source: value.source,
    id: value.id,
    ...(Object.hasOwn(value, 'mode') ? { mode: value.mode } : {}),
  }, label)
  const selection = assertObject(value.selection, `${label}: selezione`, ['anchor', 'head'])
  const scroll = assertObject(value.scroll, `${label}: scroll`, ['top', 'left'])
  return {
    ...file,
    selection: {
      anchor: assertInteger(selection.anchor, `${label}: ancora`, 0, 2_000_000),
      head: assertInteger(selection.head, `${label}: cursore`, 0, 2_000_000),
    },
    scroll: {
      top: assertNumber(scroll.top, `${label}: scroll verticale`, 0, 100_000_000),
      left: assertNumber(scroll.left, `${label}: scroll orizzontale`, 0, 100_000_000),
    },
  }
}

function validateScrollGroup(input, label, keys) {
  const value = assertObject(input, label, keys)
  return Object.fromEntries(keys.map((key) => [key, assertNumber(value[key], `${label}: ${key}`, 0, 100_000_000)]))
}

function validateWorkspaceSessionState(input) {
  const root = assertObject(input, 'Stato sessione workspace', [
    'navigation',
    'editor',
    'terminal',
    'github',
    'database',
    'redis',
    'panels',
    'focus',
  ])

  const navigationInput = assertObject(root.navigation, 'Navigazione', ['section', 'aiTab'])
  const navigation = {
    section: assertEnum(navigationInput.section, 'Sezione', APP_SECTIONS),
    aiTab: assertEnum(navigationInput.aiTab, 'Scheda AI', AI_TABS),
  }

  const editorInput = assertObject(root.editor, 'Editor', ['openFiles', 'activeFile', 'expandedDirectoryIds', 'fileViews'])
  const openFiles = assertUnique(
    assertArray(editorInput.openFiles, 'File aperti', 100).map((file, index) => validateFileRef(file, `File aperto ${index + 1}`)),
    fileRefKey,
    'File aperti',
  )
  const activeFile = editorInput.activeFile === null ? null : validateFileRef(editorInput.activeFile, 'File attivo')
  const openFileKeys = new Set(openFiles.map(fileRefKey))
  if (activeFile && !openFileKeys.has(fileRefKey(activeFile))) throw new Error('Il file attivo non è presente tra i file aperti.')
  const expandedDirectoryIds = assertUnique(
    assertArray(editorInput.expandedDirectoryIds, 'Directory espanse', 1_000)
      .map((id, index) => assertString(id, `Directory espansa ${index + 1}`, 4_096, { relativePath: true })),
    (id) => id,
    'Directory espanse',
  )
  const fileViews = assertUnique(
    assertArray(editorInput.fileViews, 'Viste file', 100).map((view, index) => validateFileView(view, `Vista file ${index + 1}`)),
    fileRefKey,
    'Viste file',
  )
  if (fileViews.some((view) => !openFileKeys.has(fileRefKey(view)))) throw new Error('Una vista editor non corrisponde a un file aperto.')
  const editor = { openFiles, activeFile, expandedDirectoryIds, fileViews }

  const terminalInput = assertObject(root.terminal, 'Terminale', [
    'tab',
    'remoteView',
    'selectedProfileCommandId',
    'openSessionCount',
    'activeSessionOrdinal',
  ])
  const terminal = {
    tab: assertEnum(terminalInput.tab, 'Scheda terminale', TERMINAL_TABS),
    remoteView: assertEnum(terminalInput.remoteView, 'Vista remota', REMOTE_VIEWS),
    selectedProfileCommandId: assertNullableString(terminalInput.selectedProfileCommandId, 'Profilo SSH', 128, { opaque: true }),
    openSessionCount: Object.hasOwn(terminalInput, 'openSessionCount')
      ? assertInteger(terminalInput.openSessionCount, 'Numero terminali aperti', 0, 8)
      : 0,
    activeSessionOrdinal: Object.hasOwn(terminalInput, 'activeSessionOrdinal')
      ? assertNullableInteger(terminalInput.activeSessionOrdinal, 'Posizione terminale attivo', 0, 7)
      : null,
  }

  const githubInput = assertObject(root.github, 'GitHub', ['tab', 'selectedDiffPath', 'selectedProjectNumber', 'issueStateFilter', 'scroll'])
  const github = {
    tab: assertEnum(githubInput.tab, 'Scheda GitHub', GITHUB_TABS),
    selectedDiffPath: assertNullableString(githubInput.selectedDiffPath, 'File diff', 4_096, { relativePath: true }),
    selectedProjectNumber: assertNullableInteger(githubInput.selectedProjectNumber, 'Progetto GitHub', 1, 1_000_000_000),
    issueStateFilter: assertEnum(githubInput.issueStateFilter, 'Filtro issue', ISSUE_STATE_FILTERS),
    scroll: validateScrollGroup(githubInput.scroll, 'Scroll GitHub', ['changes', 'graph', 'issues', 'projects']),
  }

  const databaseInput = assertObject(root.database, 'Database', [
    'selectedConnectionId',
    'sidebarTab',
    'view',
    'expandedSchemaIds',
    'selectedTableName',
    'activeSavedQueryId',
    'scroll',
  ])
  const expandedSchemaIds = assertUnique(
    assertArray(databaseInput.expandedSchemaIds, 'Elementi schema espansi', 500)
      .map((id, index) => assertString(id, `Elemento schema ${index + 1}`, 512)),
    (id) => id,
    'Elementi schema espansi',
  )
  const database = {
    selectedConnectionId: assertNullableString(databaseInput.selectedConnectionId, 'Connessione database', 128, { opaque: true }),
    sidebarTab: assertEnum(databaseInput.sidebarTab, 'Scheda database', DATABASE_SIDEBAR_TABS),
    view: assertEnum(databaseInput.view, 'Vista database', DATABASE_VIEWS),
    expandedSchemaIds,
    selectedTableName: assertNullableString(databaseInput.selectedTableName, 'Tabella database', 512),
    activeSavedQueryId: assertNullableString(databaseInput.activeSavedQueryId, 'Query salvata', 128, { opaque: true }),
    scroll: validateScrollGroup(databaseInput.scroll, 'Scroll database', ['explorer', 'editor', 'results']),
  }

  const redisInput = assertObject(root.redis, 'Redis', [
    'selectedConnectionId',
    'databaseIndex',
    'view',
    'typeFilter',
    'inspectorTab',
  ])
  const redis = {
    selectedConnectionId: assertNullableString(redisInput.selectedConnectionId, 'Connessione Redis', 128, { opaque: true }),
    databaseIndex: assertInteger(redisInput.databaseIndex, 'Database Redis', 0, 65_535),
    view: assertEnum(redisInput.view, 'Vista Redis', REDIS_VIEWS),
    typeFilter: assertEnum(redisInput.typeFilter, 'Filtro Redis', REDIS_KEY_TYPES),
    inspectorTab: assertEnum(redisInput.inspectorTab, 'Scheda inspector Redis', REDIS_INSPECTOR_TABS),
  }

  const panelsInput = assertObject(root.panels, 'Pannelli', [
    'editorExplorer',
    'terminalCommands',
    'remoteConnections',
    'databaseSidebar',
    'githubProjectPicker',
  ])
  const panels = Object.fromEntries(Object.keys(panelsInput).map((key) => [
    key,
    panelsInput[key] === null ? null : assertNumber(panelsInput[key], `Pannello ${key}`, 0, 10_000),
  ]))
  for (const key of ['editorExplorer', 'terminalCommands', 'remoteConnections', 'databaseSidebar', 'githubProjectPicker']) {
    if (!(key in panels)) throw new Error('Pannelli non validi.')
  }

  const focusInput = assertObject(root.focus, 'Focus', ['view', 'target'])
  const focus = {
    view: assertEnum(focusInput.view, 'Vista focus', APP_SECTIONS),
    target: focusInput.target === null ? null : assertEnum(focusInput.target, 'Destinazione focus', FOCUS_TARGETS),
  }

  return { navigation, editor, terminal, github, database, redis, panels, focus }
}

function createDefaultWorkspaceSessionState() {
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

function migrateLegacyWorkspaceSessionState(input) {
  const legacy = assertObject(input, 'Stato sessione workspace v1', [
    'navigation',
    'editor',
    'terminal',
    'github',
    'database',
    'panels',
    'focus',
  ])
  return validateWorkspaceSessionState({
    ...legacy,
    redis: createDefaultWorkspaceSessionState().redis,
  })
}

function defaultSnapshot() {
  return {
    version: WORKSPACE_SESSION_VERSION,
    state: createDefaultWorkspaceSessionState(),
    updatedAt: null,
  }
}

function recoveredSnapshot(kind) {
  return {
    ...defaultSnapshot(),
    recovery: {
      correlationId: createCorrelationId(),
      kind,
    },
  }
}

function removeCorruptedState(workspacePath) {
  getDatabase().prepare('DELETE FROM workspace_ui_state WHERE workspace_path = ?').run(workspacePath)
}

function getWorkspaceSession(workspacePath) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  const row = getDatabase().prepare(`
    SELECT schema_version AS version, payload_json AS payloadJson, updated_at AS updatedAt
    FROM workspace_ui_state WHERE workspace_path = ?
  `).get(workspacePath)
  if (!row || (row.version !== WORKSPACE_SESSION_VERSION && row.version !== LEGACY_WORKSPACE_SESSION_VERSION)) return defaultSnapshot()

  if (
    typeof row.payloadJson !== 'string'
    || Buffer.byteLength(row.payloadJson, 'utf8') > MAX_WORKSPACE_SESSION_BYTES
    || !Number.isInteger(row.updatedAt)
    || row.updatedAt < 0
  ) {
    removeCorruptedState(workspacePath)
    return recoveredSnapshot('corrupt')
  }

  try {
    const parsed = JSON.parse(row.payloadJson)
    const state = row.version === LEGACY_WORKSPACE_SESSION_VERSION
      ? migrateLegacyWorkspaceSessionState(parsed)
      : validateWorkspaceSessionState(parsed)
    if (row.version === LEGACY_WORKSPACE_SESSION_VERSION) {
      const payloadJson = JSON.stringify(state)
      getDatabase().prepare(`
        UPDATE workspace_ui_state
        SET schema_version = ?, payload_json = ?, updated_at = ?
        WHERE workspace_path = ? AND schema_version = ?
      `).run(WORKSPACE_SESSION_VERSION, payloadJson, row.updatedAt, workspacePath, LEGACY_WORKSPACE_SESSION_VERSION)
    }
    return {
      version: WORKSPACE_SESSION_VERSION,
      state,
      updatedAt: row.updatedAt,
    }
  } catch {
    removeCorruptedState(workspacePath)
    return recoveredSnapshot('corrupt')
  }
}

function saveWorkspaceSession(workspacePath, snapshot) {
  workspacePath = assertWorkspacePath(workspacePath)
  const input = assertObject(snapshot, 'Sessione workspace', ['version', 'state'])
  if (input.version !== WORKSPACE_SESSION_VERSION) throw new Error('Versione sessione workspace non supportata.')
  const state = validateWorkspaceSessionState(input.state)
  const payloadJson = JSON.stringify(state)
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_WORKSPACE_SESSION_BYTES) {
    throw new Error('Lo stato della sessione workspace supera il limite consentito.')
  }

  ensureSchema()
  const updatedAt = Date.now()
  getDatabase().prepare(`
    INSERT INTO workspace_ui_state (workspace_path, schema_version, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_path) DO UPDATE SET
      schema_version = excluded.schema_version,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run(workspacePath, WORKSPACE_SESSION_VERSION, payloadJson, updatedAt)
  return { version: WORKSPACE_SESSION_VERSION, state, updatedAt }
}

module.exports = {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
  getWorkspaceSession,
  saveWorkspaceSession,
  validateWorkspaceSessionState,
}
