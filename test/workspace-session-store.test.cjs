const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
  getWorkspaceSession,
  saveWorkspaceSession,
} = require('../electron/infrastructure/persistence/workspace-session.repository.cjs')

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-workspace-session-'))
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

function writeSnapshot(state = createDefaultWorkspaceSessionState()) {
  return { version: WORKSPACE_SESSION_VERSION, state }
}

test('restituisce default versionati e isola lo stato durevole tra workspace', (t) => {
  withTemporaryDatabase(t)
  const workspaceA = '/tmp/vincodelab-session-a'
  const workspaceB = '/tmp/vincodelab-session-b'

  assert.deepEqual(getWorkspaceSession(workspaceA), {
    version: WORKSPACE_SESSION_VERSION,
    state: createDefaultWorkspaceSessionState(),
    updatedAt: null,
  })

  const stateA = createDefaultWorkspaceSessionState()
  stateA.navigation.section = 'editor'
  stateA.editor.openFiles = [{ source: 'workspace', id: 'src/App.tsx', mode: 'source' }]
  stateA.editor.activeFile = { source: 'workspace', id: 'src/App.tsx', mode: 'source' }
  stateA.editor.fileViews = [{
    source: 'workspace',
    id: 'src/App.tsx',
    mode: 'source',
    selection: { anchor: 12, head: 18 },
    scroll: { top: 420.5, left: 0 },
  }]
  stateA.terminal.openSessionCount = 8
  stateA.terminal.activeSessionOrdinal = 7
  stateA.focus = { view: 'editor', target: 'editor.code' }
  saveWorkspaceSession(workspaceA, writeSnapshot(stateA))

  const stateB = createDefaultWorkspaceSessionState()
  stateB.navigation.section = 'database'
  stateB.database.selectedConnectionId = '4e36c5b1-cf3e-4f6e-8cab-fdf71881ea98'
  stateB.database.activeSavedQueryId = '6477810f-3323-4ad6-8939-bb0316e0d82c'
  saveWorkspaceSession(workspaceB, writeSnapshot(stateB))

  closeDatabase()
  assert.equal(getWorkspaceSession(workspaceA).state.navigation.section, 'editor')
  assert.equal(getWorkspaceSession(workspaceA).state.editor.activeFile.id, 'src/App.tsx')
  assert.equal(getWorkspaceSession(workspaceA).state.editor.activeFile.mode, 'source')
  assert.equal(getWorkspaceSession(workspaceA).state.terminal.openSessionCount, 8)
  assert.equal(getWorkspaceSession(workspaceA).state.terminal.activeSessionOrdinal, 7)
  assert.equal(getWorkspaceSession(workspaceB).state.navigation.section, 'database')
  assert.equal(getWorkspaceSession(workspaceB).state.database.selectedConnectionId, stateB.database.selectedConnectionId)
})

test('normalizza snapshot v1 terminale legacy senza cancellarli o rifiutarne la scrittura', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-terminal-legacy'
  const legacyState = createDefaultWorkspaceSessionState()
  delete legacyState.terminal.openSessionCount
  delete legacyState.terminal.activeSessionOrdinal

  const normalizedWrite = saveWorkspaceSession(workspace, writeSnapshot(legacyState))
  assert.equal(normalizedWrite.state.terminal.openSessionCount, 0)
  assert.equal(normalizedWrite.state.terminal.activeSessionOrdinal, null)

  getDatabase().prepare(`
    UPDATE workspace_ui_state
    SET payload_json = ?, updated_at = ?
    WHERE workspace_path = ?
  `).run(JSON.stringify(legacyState), 42, workspace)

  const restored = getWorkspaceSession(workspace)
  assert.equal(restored.updatedAt, 42)
  assert.equal(restored.state.terminal.openSessionCount, 0)
  assert.equal(restored.state.terminal.activeSessionOrdinal, null)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).count, 1)
})

test('mantiene compatibili i file Editor v1 privi della modalità', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-editor-v1'
  const state = createDefaultWorkspaceSessionState()
  state.editor.openFiles = [{ source: 'workspace', id: 'README.md' }]
  state.editor.activeFile = { source: 'workspace', id: 'README.md' }
  state.editor.fileViews = [{
    source: 'workspace',
    id: 'README.md',
    selection: { anchor: 0, head: 0 },
    scroll: { top: 0, left: 0 },
  }]

  saveWorkspaceSession(workspace, writeSnapshot(state))
  assert.deepEqual(getWorkspaceSession(workspace).state.editor, state.editor)
})

test('migra lo snapshot v1 aggiungendo Redis senza perdere il layout esistente', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-redis-v1'
  const legacyState = createDefaultWorkspaceSessionState()
  delete legacyState.redis
  legacyState.navigation.section = 'editor'
  legacyState.database.selectedConnectionId = 'database-existing'

  getWorkspaceSession(workspace)
  getDatabase().prepare(`
    INSERT INTO workspace_ui_state (workspace_path, schema_version, payload_json, updated_at)
    VALUES (?, 1, ?, ?)
  `).run(workspace, JSON.stringify(legacyState), 99)

  const restored = getWorkspaceSession(workspace)
  assert.equal(restored.version, WORKSPACE_SESSION_VERSION)
  assert.equal(restored.updatedAt, 99)
  assert.equal(restored.state.navigation.section, 'editor')
  assert.equal(restored.state.database.selectedConnectionId, 'database-existing')
  assert.deepEqual(restored.state.redis, createDefaultWorkspaceSessionState().redis)
  assert.equal(getDatabase().prepare('SELECT schema_version AS version FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).version, WORKSPACE_SESSION_VERSION)
})

test('rimuove uno stato corrente corrotto e riparte dai default senza propagare errori', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-corrupt'
  saveWorkspaceSession(workspace, writeSnapshot())

  getDatabase().prepare('UPDATE workspace_ui_state SET payload_json = ? WHERE workspace_path = ?')
    .run('{json-non-valido}', workspace)

  const invalidJsonRecovery = getWorkspaceSession(workspace)
  assert.deepEqual(invalidJsonRecovery.state, createDefaultWorkspaceSessionState())
  assert.equal(invalidJsonRecovery.updatedAt, null)
  assert.equal(invalidJsonRecovery.recovery.kind, 'corrupt')
  assert.match(invalidJsonRecovery.recovery.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).count, 0)

  saveWorkspaceSession(workspace, writeSnapshot())
  getDatabase().prepare('UPDATE workspace_ui_state SET payload_json = ? WHERE workspace_path = ?')
    .run(JSON.stringify('x'.repeat(MAX_WORKSPACE_SESSION_BYTES)), workspace)
  const oversizedRecovery = getWorkspaceSession(workspace)
  assert.equal(oversizedRecovery.updatedAt, null)
  assert.equal(oversizedRecovery.recovery.kind, 'corrupt')
  assert.match(oversizedRecovery.recovery.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).count, 0)
})

test('ignora versioni future senza distruggerle e rifiuta write con versione non supportata', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-version'
  getWorkspaceSession(workspace)
  getDatabase().prepare(`
    INSERT INTO workspace_ui_state (workspace_path, schema_version, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(workspace, WORKSPACE_SESSION_VERSION + 1, JSON.stringify(createDefaultWorkspaceSessionState()), 123)

  const snapshot = getWorkspaceSession(workspace)
  assert.equal(snapshot.version, WORKSPACE_SESSION_VERSION)
  assert.equal(snapshot.updatedAt, null)
  assert.equal(getDatabase().prepare('SELECT schema_version AS version FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).version, WORKSPACE_SESSION_VERSION + 1)
  assert.throws(
    () => saveWorkspaceSession(workspace, { version: WORKSPACE_SESSION_VERSION + 1, state: createDefaultWorkspaceSessionState() }),
    /Versione sessione workspace non supportata/,
  )
})

test('applica allowlist ricorsiva e non accetta contenuti sensibili o stato operativo effimero', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-allowlist'
  const baseline = createDefaultWorkspaceSessionState()
  baseline.navigation.section = 'github'
  saveWorkspaceSession(workspace, writeSnapshot(baseline))

  const forbidden = [
    ['Editor dirty text', (state) => { state.editor.dirtyText = 'contenuto non salvato' }],
    ['Output terminale', (state) => { state.terminal.output = 'TOKEN=segreto' }],
    ['ID sessione terminale', (state) => { state.terminal.sessionId = 'sessione-effimera' }],
    ['Directory terminale', (state) => { state.terminal.cwd = '/workspace/segreto' }],
    ['Titolo terminale', (state) => { state.terminal.title = 'deploy produzione' }],
    ['Risultati database', (state) => { state.database.results = [{ password: 'segreta' }] }],
    ['Transazione database', (state) => { state.database.transactionActive = true }],
    ['Payload Redis', (state) => { state.redis.payload = '{"token":"segreto"}' }],
    ['Query Redis', (state) => { state.redis.query = 'contenuto privato' }],
    ['Segreto generico', (state) => { state.secrets = { token: 'segreto' } }],
  ]

  for (const [label, mutate] of forbidden) {
    const state = createDefaultWorkspaceSessionState()
    mutate(state)
    assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(state)), /campi non consentiti/, label)
  }
  assert.throws(
    () => saveWorkspaceSession(workspace, { ...writeSnapshot(), workspacePath: '/tmp/altro-workspace' }),
    /campi non consentiti/,
  )

  assert.equal(getWorkspaceSession(workspace).state.navigation.section, 'github')
})

test('limita cardinalità, identificatori, coordinate e dimensione JSON prima della scrittura', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-bounds'

  const tooManyFiles = createDefaultWorkspaceSessionState()
  tooManyFiles.editor.openFiles = Array.from({ length: 101 }, (_, index) => ({ source: 'workspace', id: `src/file-${index}.ts` }))
  assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(tooManyFiles)), /File aperti non valido/)

  const traversal = createDefaultWorkspaceSessionState()
  traversal.editor.openFiles = [{ source: 'workspace', id: '../segreto.txt' }]
  assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(traversal)), /file non valido/)

  const invalidEditorMode = createDefaultWorkspaceSessionState()
  invalidEditorMode.editor.openFiles = [{ source: 'workspace', id: 'README.md', mode: 'raw' }]
  assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(invalidEditorMode)), /modalità non valido/)

  const invalidScroll = createDefaultWorkspaceSessionState()
  invalidScroll.github.scroll.issues = Number.POSITIVE_INFINITY
  assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(invalidScroll)), /Scroll GitHub/)

  for (const [field, value] of [
    ['openSessionCount', -1],
    ['openSessionCount', 9],
    ['openSessionCount', 1.5],
    ['activeSessionOrdinal', -1],
    ['activeSessionOrdinal', 8],
    ['activeSessionOrdinal', 2.5],
  ]) {
    const invalidTerminal = createDefaultWorkspaceSessionState()
    invalidTerminal.terminal[field] = value
    assert.throws(
      () => saveWorkspaceSession(workspace, writeSnapshot(invalidTerminal)),
      field === 'openSessionCount' ? /Numero terminali aperti/ : /Posizione terminale attivo/,
    )
  }

  const oversized = createDefaultWorkspaceSessionState()
  oversized.editor.expandedDirectoryIds = Array.from(
    { length: 1_000 },
    (_, index) => `packages/package-${index}/${'directory'.repeat(40)}`,
  )
  assert.ok(Buffer.byteLength(JSON.stringify(oversized), 'utf8') > MAX_WORKSPACE_SESSION_BYTES)
  assert.throws(() => saveWorkspaceSession(workspace, writeSnapshot(oversized)), /supera il limite consentito/)

  getWorkspaceSession(workspace)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state').get().count, 0)
})

test('tratta come corrotto anche JSON valido che non rispetta lo schema allowlist', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/vincodelab-session-invalid-schema'
  saveWorkspaceSession(workspace, writeSnapshot())
  const unsafe = createDefaultWorkspaceSessionState()
  unsafe.database.results = [{ value: 'dato non persistibile' }]
  getDatabase().prepare('UPDATE workspace_ui_state SET payload_json = ? WHERE workspace_path = ?')
    .run(JSON.stringify(unsafe), workspace)

  const recovery = getWorkspaceSession(workspace)
  assert.deepEqual(recovery.state, createDefaultWorkspaceSessionState())
  assert.equal(recovery.updatedAt, null)
  assert.equal(recovery.recovery.kind, 'corrupt')
  assert.match(recovery.recovery.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state').get().count, 0)
})
