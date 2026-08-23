const path = require('node:path')
const { createCorrelationId } = require('./application-error.cjs')
const { getDatabase } = require('./workspace-store.cjs')

const PREFIX = 'setting:'

const PREFERENCE_DEFINITIONS = Object.freeze({
  'editor.fontSize': { section: 'editor', label: 'Dimensione testo', type: 'number', default: 13, min: 10, max: 24, step: 1 },
  'editor.tabSize': { section: 'editor', label: 'Dimensione tab', type: 'number', default: 2, min: 1, max: 8, step: 1 },
  'editor.wordWrap': { section: 'editor', label: 'A capo automatico', type: 'boolean', default: true },
  'editor.autoSave': { section: 'editor', label: 'Salvataggio automatico', type: 'boolean', default: false },
  'editor.explorerWidth': { section: 'editor', label: 'Larghezza Explorer', type: 'number', default: 320, min: 220, max: 720, step: 10 },
  'terminal.fontSize': { section: 'terminal', label: 'Dimensione testo', type: 'number', default: 11, min: 9, max: 24, step: 1 },
  'terminal.fontFamily': { section: 'terminal', label: 'Carattere', type: 'enum', default: 'system-mono', values: ['system-mono', 'menlo', 'monaco'] },
  'terminal.cursorStyle': { section: 'terminal', label: 'Cursore', type: 'enum', default: 'bar', values: ['bar', 'block', 'underline'] },
  'terminal.scrollback': { section: 'terminal', label: 'Righe cronologia', type: 'number', default: 10000, min: 1000, max: 100000, step: 1000 },
  'terminal.commandsWidth': { section: 'terminal', label: 'Larghezza Comandi', type: 'number', default: 400, min: 300, max: 720, step: 10 },
  'git.autoRefreshSeconds': { section: 'git', label: 'Aggiornamento automatico', type: 'number', default: 60, min: 0, max: 3600, step: 15 },
  'git.historyLimit': { section: 'git', label: 'Commit nel grafo', type: 'number', default: 100, min: 20, max: 1000, step: 20 },
  'git.confirmRemoteActions': { section: 'git', label: 'Conferma azioni remote', type: 'boolean', default: true },
  'git.projectSelectorWidth': { section: 'git', label: 'Larghezza selettore Project', type: 'number', default: 360, min: 280, max: 720, step: 10 },
  'database.rowLimit': { section: 'database', label: 'Righe per pagina', type: 'number', default: 500, min: 25, max: 5000, step: 25 },
  'database.queryTimeoutMs': { section: 'database', label: 'Timeout query (ms)', type: 'number', default: 30000, min: 1000, max: 300000, step: 1000 },
  'database.confirmMutations': { section: 'database', label: 'Conferma modifiche', type: 'boolean', default: true },
  'database.explorerWidth': { section: 'database', label: 'Larghezza Explorer', type: 'number', default: 300, min: 240, max: 720, step: 10 },
})

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS workspace_preferences (
      workspace_path TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_path, key)
    );
    CREATE INDEX IF NOT EXISTS workspace_preferences_path ON workspace_preferences(workspace_path);
  `)
}

function assertKey(key) {
  if (typeof key !== 'string' || !Object.hasOwn(PREFERENCE_DEFINITIONS, key)) throw new Error('Preferenza non valida.')
  return key
}

function assertWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.length > 4096) throw new Error('Workspace non valido.')
  return path.normalize(workspacePath)
}

function assertValue(key, value) {
  const definition = PREFERENCE_DEFINITIONS[assertKey(key)]
  const valid = definition.type === 'boolean'
    ? typeof value === 'boolean'
    : definition.type === 'enum'
      ? typeof value === 'string' && definition.values.includes(value)
      : typeof value === 'number' && Number.isFinite(value) && value >= definition.min && value <= definition.max
  if (!valid) throw new Error(`Valore della preferenza ${key} non valido.`)
  return value
}

function parseStoredValue(key, value) {
  try {
    return { valid: true, value: assertValue(key, JSON.parse(value)) }
  } catch {
    return { valid: false }
  }
}

function readGlobalValues() {
  const values = {}
  const invalidKeys = []
  for (const row of getDatabase().prepare("SELECT key, value FROM app_preferences WHERE key LIKE 'setting:%'").all()) {
    const key = row.key.slice(PREFIX.length)
    if (!Object.hasOwn(PREFERENCE_DEFINITIONS, key)) continue
    const parsed = parseStoredValue(key, row.value)
    if (parsed.valid) values[key] = parsed.value
    else invalidKeys.push(key)
  }
  return { invalidKeys, values }
}

function readWorkspaceValues(workspacePath) {
  if (!workspacePath) return { invalidKeys: [], values: {} }
  ensureSchema()
  const values = {}
  const invalidKeys = []
  for (const row of getDatabase().prepare('SELECT key, value FROM workspace_preferences WHERE workspace_path = ?').all(assertWorkspacePath(workspacePath))) {
    if (!Object.hasOwn(PREFERENCE_DEFINITIONS, row.key)) continue
    const parsed = parseStoredValue(row.key, row.value)
    if (parsed.valid) values[row.key] = parsed.value
    else invalidKeys.push(row.key)
  }
  return { invalidKeys, values }
}

function removeInvalidStoredValues(workspacePath, globalKeys, workspaceKeys) {
  if (globalKeys.length === 0 && workspaceKeys.length === 0) return
  const db = getDatabase()
  const deleteGlobal = db.prepare('DELETE FROM app_preferences WHERE key = ?')
  const deleteWorkspace = db.prepare('DELETE FROM workspace_preferences WHERE workspace_path = ? AND key = ?')
  db.transaction(() => {
    for (const key of globalKeys) deleteGlobal.run(`${PREFIX}${key}`)
    if (workspacePath) for (const key of workspaceKeys) deleteWorkspace.run(workspacePath, key)
  })()
}

function getPreferences(workspacePath = null) {
  ensureSchema()
  const normalizedWorkspacePath = workspacePath ? assertWorkspacePath(workspacePath) : null
  const globalResult = readGlobalValues()
  const workspaceResult = readWorkspaceValues(normalizedWorkspacePath)
  removeInvalidStoredValues(normalizedWorkspacePath, globalResult.invalidKeys, workspaceResult.invalidKeys)
  const explicitGlobal = globalResult.values
  const overrides = workspaceResult.values
  const global = {}
  const effective = {}
  const sources = {}
  for (const [key, definition] of Object.entries(PREFERENCE_DEFINITIONS)) {
    const hasGlobal = Object.hasOwn(explicitGlobal, key)
    const hasWorkspace = Object.hasOwn(overrides, key)
    global[key] = hasGlobal ? explicitGlobal[key] : definition.default
    effective[key] = hasWorkspace ? overrides[key] : global[key]
    sources[key] = hasWorkspace ? 'workspace' : hasGlobal ? 'global' : 'default'
  }
  const schema = Object.entries(PREFERENCE_DEFINITIONS).map(([key, definition]) => ({ key, ...definition }))
  const recoveredCount = globalResult.invalidKeys.length + workspaceResult.invalidKeys.length
  return {
    schema,
    global,
    explicitGlobal,
    overrides,
    effective,
    sources,
    workspaceAvailable: Boolean(normalizedWorkspacePath),
    ...(recoveredCount === 0 ? {} : {
      recovery: {
        kind: 'corrupt',
        correlationId: createCorrelationId(),
        globalCount: globalResult.invalidKeys.length,
        workspaceCount: workspaceResult.invalidKeys.length,
      },
    }),
  }
}

function setGlobalPreference(key, value) {
  key = assertKey(key)
  value = assertValue(key, value)
  getDatabase().prepare(`
    INSERT INTO app_preferences (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`${PREFIX}${key}`, JSON.stringify(value))
  return value
}

function setWorkspacePreference(workspacePath, key, value) {
  ensureSchema()
  workspacePath = assertWorkspacePath(workspacePath)
  key = assertKey(key)
  value = assertValue(key, value)
  getDatabase().prepare(`
    INSERT INTO workspace_preferences (workspace_path, key, value, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_path, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(workspacePath, key, JSON.stringify(value), Date.now())
  return getPreferences(workspacePath)
}

function clearWorkspacePreference(workspacePath, key) {
  ensureSchema()
  workspacePath = assertWorkspacePath(workspacePath)
  key = assertKey(key)
  getDatabase().prepare('DELETE FROM workspace_preferences WHERE workspace_path = ? AND key = ?').run(workspacePath, key)
  return getPreferences(workspacePath)
}

function clearAllWorkspacePreferences(workspacePath) {
  ensureSchema()
  const result = getDatabase().prepare('DELETE FROM workspace_preferences WHERE workspace_path = ?').run(assertWorkspacePath(workspacePath))
  return { deleted: result.changes }
}

module.exports = {
  PREFERENCE_DEFINITIONS,
  clearAllWorkspacePreferences,
  clearWorkspacePreference,
  getPreferences,
  setGlobalPreference,
  setWorkspacePreference,
}
