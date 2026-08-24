const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PREFERENCES_INVOKE_CHANNELS,
  createPreferencesHandlers,
  registerPreferencesIpc,
} = require('../electron/ipc/domains/preferences.ipc.cjs')

function preferencesFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const snapshots = {
    current: { scope: 'current' },
    global: { scope: 'global' },
    workspace: { scope: 'workspace' },
    cleared: { scope: 'cleared' },
  }
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    clearAllWorkspacePreferences: (workspacePath) => { calls.push(['clear-all-workspace', workspacePath]) },
    clearWorkspacePreference: (workspacePath, key) => {
      calls.push(['clear-workspace', workspacePath, key])
      return snapshots.cleared
    },
    getActiveWorkspacePath: () => '/workspace/current',
    getPreferences: (workspacePath) => {
      calls.push(['get', workspacePath])
      return snapshots.current
    },
    reportPreferenceRecovery: (snapshot) => {
      calls.push(['report-recovery', snapshot])
      return snapshot
    },
    requireActiveWorkspace: () => {
      calls.push(['require-workspace'])
      return '/workspace/current'
    },
    setGlobalPreference: (key, value) => { calls.push(['set-global', key, value]) },
    setWorkspacePreference: (workspacePath, key, value) => {
      calls.push(['set-workspace', workspacePath, key, value])
      return snapshots.workspace
    },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, snapshots }
}

test('registra una sola volta il manifesto IPC Preferenze', () => {
  const fixture = preferencesFixture()
  const registration = registerPreferencesIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(PREFERENCES_INVOKE_CHANNELS, [
    'preferences:get',
    'preferences:setGlobal',
    'preferences:setWorkspace',
    'preferences:clearWorkspace',
    'preferences:clearAllWorkspace',
  ])
  assert.deepEqual(registration.channels, PREFERENCES_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], PREFERENCES_INVOKE_CHANNELS)
})

test('legge le preferenze globali quando non esiste un workspace attivo', () => {
  const fixture = preferencesFixture({ getActiveWorkspacePath: () => undefined })
  const event = { sender: { id: 42 } }
  const handler = createPreferencesHandlers(fixture.dependencies).get('preferences:get')

  assert.equal(handler(event), fixture.snapshots.current)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['get', null],
    ['report-recovery', fixture.snapshots.current],
  ])
})

test('salva una preferenza globale e restituisce lo snapshot del contesto corrente', () => {
  const fixture = preferencesFixture()
  const event = { sender: { id: 7 } }
  const handler = createPreferencesHandlers(fixture.dependencies).get('preferences:setGlobal')

  assert.equal(handler(event, 'terminal.fontSize', 14), fixture.snapshots.current)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['set-global', 'terminal.fontSize', 14],
    ['get', '/workspace/current'],
    ['report-recovery', fixture.snapshots.current],
  ])
})

test('salva e cancella una preferenza soltanto nel workspace attivo', () => {
  const fixture = preferencesFixture()
  const handlers = createPreferencesHandlers(fixture.dependencies)
  const event = { sender: { id: 9 } }

  assert.equal(
    handlers.get('preferences:setWorkspace')(event, 'database.rowLimit', 500),
    fixture.snapshots.workspace,
  )
  assert.equal(
    handlers.get('preferences:clearWorkspace')(event, 'database.rowLimit'),
    fixture.snapshots.cleared,
  )
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['set-workspace', '/workspace/current', 'database.rowLimit', 500],
    ['report-recovery', fixture.snapshots.workspace],
    ['guard', event],
    ['require-workspace'],
    ['clear-workspace', '/workspace/current', 'database.rowLimit'],
    ['report-recovery', fixture.snapshots.cleared],
  ])
})

test('cancella tutte le preferenze workspace e rilegge lo snapshot risultante', () => {
  const fixture = preferencesFixture()
  const event = { sender: { id: 11 } }
  const handler = createPreferencesHandlers(fixture.dependencies).get('preferences:clearAllWorkspace')

  assert.equal(handler(event), fixture.snapshots.current)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['clear-all-workspace', '/workspace/current'],
    ['get', '/workspace/current'],
    ['report-recovery', fixture.snapshots.current],
  ])
})

test('propaga senza trasformarli gli errori destinati alla boundary IPC globale', () => {
  const expected = new Error('preference store failed')
  const fixture = preferencesFixture({ setGlobalPreference: () => { throw expected } })
  const handler = createPreferencesHandlers(fixture.dependencies).get('preferences:setGlobal')

  assert.throws(() => handler({ sender: { id: 1 } }, 'terminal.fontSize', 16), (error) => error === expected)
  assert.equal(fixture.calls[0][0], 'guard')
})
