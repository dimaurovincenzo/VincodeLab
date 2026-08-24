const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const {
  clearAllWorkspacePreferences,
  clearWorkspacePreference,
  getPreferences,
  setGlobalPreference,
  setWorkspacePreference,
} = require('../electron/infrastructure/persistence/app-preferences.repository.cjs')

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-preferences-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('compone default globale e override del workspace indicando la sorgente', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-preferences-a'

  assert.equal(getPreferences(workspace).effective['terminal.fontSize'], 11)
  assert.equal(getPreferences(workspace).sources['terminal.fontSize'], 'default')

  setGlobalPreference('terminal.fontSize', 13)
  assert.equal(getPreferences(workspace).effective['terminal.fontSize'], 13)
  assert.equal(getPreferences(workspace).sources['terminal.fontSize'], 'global')

  setWorkspacePreference(workspace, 'terminal.fontSize', 15)
  assert.equal(getPreferences(workspace).effective['terminal.fontSize'], 15)
  assert.equal(getPreferences(workspace).sources['terminal.fontSize'], 'workspace')

  clearWorkspacePreference(workspace, 'terminal.fontSize')
  assert.equal(getPreferences(workspace).effective['terminal.fontSize'], 13)
  assert.equal(getPreferences(workspace).sources['terminal.fontSize'], 'global')
})

test('isola gli override e li rimuove in blocco per un solo workspace', (t) => {
  withTemporaryDatabase(t)
  setWorkspacePreference('/tmp/workspace-a', 'database.rowLimit', 250)
  setWorkspacePreference('/tmp/workspace-b', 'database.rowLimit', 750)

  assert.equal(getPreferences('/tmp/workspace-a').effective['database.rowLimit'], 250)
  assert.equal(getPreferences('/tmp/workspace-b').effective['database.rowLimit'], 750)
  assert.deepEqual(clearAllWorkspacePreferences('/tmp/workspace-a'), { deleted: 1 })
  assert.equal(getPreferences('/tmp/workspace-a').effective['database.rowLimit'], 500)
  assert.equal(getPreferences('/tmp/workspace-b').effective['database.rowLimit'], 750)
})

test('rifiuta chiavi valori e percorsi non consentiti', (t) => {
  withTemporaryDatabase(t)
  assert.throws(() => setGlobalPreference('terminal.command', 'rm -rf'), /Preferenza non valida/)
  assert.throws(() => setGlobalPreference('terminal.fontSize', 100), /Valore.*non valido/)
  assert.throws(() => setWorkspacePreference('relativo', 'editor.wordWrap', true), /Workspace non valido/)
  assert.throws(() => setWorkspacePreference('/tmp/workspace', 'terminal.cursorStyle', 'circle'), /Valore.*non valido/)
})

test('ripristina valori corrotti una volta e restituisce una recovery correlata', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-preferences-corrupt'
  getPreferences(workspace)
  getDatabase().prepare('INSERT INTO app_preferences (key, value) VALUES (?, ?)').run('setting:terminal.fontSize', '"huge"')
  getDatabase().prepare('INSERT INTO workspace_preferences (workspace_path, key, value, updated_at) VALUES (?, ?, ?, ?)')
    .run(workspace, 'database.rowLimit', '{broken', Date.now())

  const recovered = getPreferences(workspace)
  assert.equal(recovered.effective['terminal.fontSize'], 11)
  assert.equal(recovered.effective['database.rowLimit'], 500)
  assert.deepEqual({ ...recovered.recovery, correlationId: '<id>' }, {
    kind: 'corrupt',
    correlationId: '<id>',
    globalCount: 1,
    workspaceCount: 1,
  })
  assert.match(recovered.recovery.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(getDatabase().prepare("SELECT COUNT(*) AS total FROM app_preferences WHERE key = 'setting:terminal.fontSize'").get().total, 0)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM workspace_preferences WHERE workspace_path = ? AND key = ?').get(workspace, 'database.rowLimit').total, 0)

  assert.equal(getPreferences(workspace).recovery, undefined)
})
