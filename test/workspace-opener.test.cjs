const assert = require('node:assert/strict')
const test = require('node:test')

const { createWorkspaceOpener } = require('../electron/domains/workspace/workspace-opener.cjs')

function fixture(overrides = {}) {
  const calls = []
  const state = { error: undefined, incident: undefined, path: overrides.previousPath }
  const opener = createWorkspaceOpener({
    cleanupWorkspaceRuntime: async (...args) => calls.push(['cleanup', ...args]),
    getActiveWorkspacePath: () => state.path,
    getInstanceRegistry: () => ({
      setWorkspace: (_instanceId, workspacePath) => ({ accepted: true, workspacePath }),
    }),
    getWindow: () => ({}),
    instanceId: 'instance',
    isDirectory: () => true,
    log: (...entry) => calls.push(['log', ...entry]),
    notifyWhenBackground: (...entry) => calls.push(['notify', ...entry]),
    projectFileIndex: {
      build: async (workspacePath) => calls.push(['index:build', workspacePath]),
      clear: () => calls.push(['index:clear']),
    },
    recordWorkspace: (workspacePath) => calls.push(['record', workspacePath]),
    remoteRuntime: { openWorkspace: (workspacePath) => calls.push(['remote', workspacePath]) },
    setActiveWorkspaceError: (value) => { state.error = value },
    setActiveWorkspaceIncident: (value) => { state.incident = value },
    setActiveWorkspacePath: (value) => { state.path = value },
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    startPi: async (workspacePath) => calls.push(['pi:start', workspacePath]),
    stopTerminal: async (reason) => calls.push(['pi:stop', reason]),
    workspaceFailure: (_error, options) => ({
      error: options.message,
      errorIncident: { code: options.code },
    }),
    ...overrides,
  })
  return { calls, opener, state }
}

test('rifiuta input non assoluti prima di riservare il workspace', async () => {
  const { opener } = fixture()
  assert.deepEqual(await opener.open('relative'), {
    error: 'La cartella selezionata non è più disponibile.',
    errorIncident: { code: 'WORKSPACE_NOT_FOUND' },
  })
})

test('apre il workspace e mantiene operative le feature se Pi parte', async () => {
  const { calls, opener, state } = fixture()
  assert.deepEqual(await opener.open('/workspace'), { path: '/workspace' })
  assert.equal(state.path, '/workspace')
  assert.ok(calls.some((entry) => entry[0] === 'record'))
  assert.ok(calls.some((entry) => entry[0] === 'pi:start'))
})

test('un failure di startup del Terminale AI produce una sola notifica di proprietà del workspace', async () => {
  const { calls, opener } = fixture({
    startPi: async () => { throw new Error('Pi closed during startup') },
    workspaceFailure: (_error, options) => ({
      error: options.message,
      errorIncident: { code: 'PI_SESSION_ENDED_DURING_STARTUP' },
    }),
  })

  const result = await opener.open('/workspace')

  assert.equal(result.errorIncident.code, 'PI_SESSION_ENDED_DURING_STARTUP')
  assert.equal(calls.filter((entry) => entry[0] === 'notify').length, 1)
})

test('il cambio workspace drena il runtime precedente prima della nuova sessione', async () => {
  const { calls, opener } = fixture({ previousPath: '/previous' })
  await opener.open('/next')
  assert.ok(calls.findIndex((entry) => entry[0] === 'cleanup') < calls.findIndex((entry) => entry[0] === 'pi:start'))
})

test('il dialog annullato non altera lo stato', async () => {
  const { opener, state } = fixture()
  assert.equal(await opener.chooseAndOpen(), null)
  assert.equal(state.path, undefined)
})
