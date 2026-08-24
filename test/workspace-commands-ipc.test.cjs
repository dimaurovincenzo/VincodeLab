const assert = require('node:assert/strict')
const test = require('node:test')

const {
  WORKSPACE_COMMANDS_INVOKE_CHANNELS,
  createWorkspaceCommandsHandlers,
  registerWorkspaceCommandsIpc,
} = require('../electron/ipc/domains/workspace-commands.ipc.cjs')

function createHarness(overrides = {}) {
  const calls = []
  const services = {
    assertTrustedSender: (event) => calls.push(['guard', event]),
    createCommandCategory: (...args) => ({ action: 'create-category', args }),
    createWorkspaceCommand: (...args) => ({ action: 'create', args }),
    deleteCommandCategory: (...args) => calls.push(['delete-category', ...args]),
    deleteWorkspaceCommand: (...args) => calls.push(['delete', ...args]),
    getManagedSsh: () => ({
      buildTerminalCommand: (...args) => {
        calls.push(['build-ssh', ...args])
        return { command: 'ssh managed', connection: { id: 'managed-1' } }
      },
      waitUntilConnected: (connectionId) => {
        calls.push(['wait-ssh', connectionId])
        return Promise.resolve()
      },
    }),
    getWorkspaceCommand: (_workspacePath, commandId) => ({ id: commandId, kind: 'shell', command: 'npm test' }),
    listWorkspaceCommands: (...args) => ({ action: 'list', args }),
    moveWorkspaceCommand: (...args) => calls.push(['move', ...args]),
    requireActiveWorkspace: () => '/workspace',
    requireRunningShellSession: (...args) => {
      calls.push(['require-session', ...args])
      return { sessionId: 'session-1' }
    },
    shellSessionManager: { write: (...args) => calls.push(['write', ...args]) },
    updateCommandCategory: (...args) => ({ action: 'update-category', args }),
    updateWorkspaceCommand: (...args) => ({ action: 'update', args }),
    ...overrides,
  }
  return { calls, handlers: createWorkspaceCommandsHandlers(services), services }
}

test('registra una sola volta il manifesto completo dei comandi workspace', () => {
  const registrations = []
  const { services } = createHarness()
  const result = registerWorkspaceCommandsIpc({
    ...services,
    ipcMain: { handle: (channel, handler) => registrations.push([channel, handler]) },
  })

  assert.deepEqual(registrations.map(([channel]) => channel), [...WORKSPACE_COMMANDS_INVOKE_CHANNELS])
  assert.equal(new Set(registrations.map(([channel]) => channel)).size, 9)
  assert.deepEqual(result.channels, WORKSPACE_COMMANDS_INVOKE_CHANNELS)
  assert.equal(Object.isFrozen(result), true)
})

test('CRUD preserva guardia, workspace, argomenti e contratti pubblici', () => {
  const { calls, handlers } = createHarness()
  const event = { sender: { id: 7 } }

  assert.deepEqual(handlers.get('workspaceCommands:list')(event), { action: 'list', args: ['/workspace'] })
  assert.deepEqual(handlers.get('workspaceCommands:createCategory')(event, 'Deploy'), { action: 'create-category', args: ['/workspace', 'Deploy'] })
  assert.deepEqual(handlers.get('workspaceCommands:updateCategory')(event, 'cat-1', 'Build'), { action: 'update-category', args: ['/workspace', 'cat-1', 'Build'] })
  assert.deepEqual(handlers.get('workspaceCommands:deleteCategory')(event, 'cat-1'), { deleted: true })
  assert.deepEqual(handlers.get('workspaceCommands:create')(event, { name: 'Test' }), { action: 'create', args: ['/workspace', { name: 'Test' }] })
  assert.deepEqual(handlers.get('workspaceCommands:update')(event, 'cmd-1', { name: 'Lint' }), { action: 'update', args: ['/workspace', 'cmd-1', { name: 'Lint' }] })
  assert.deepEqual(handlers.get('workspaceCommands:move')(event, 'cmd-1', 'cat-2'), { moved: true })
  assert.deepEqual(handlers.get('workspaceCommands:delete')(event, 'cmd-1'), { deleted: true })
  assert.equal(calls.filter(([type]) => type === 'guard').length, 8)
  assert.deepEqual(calls.find(([type]) => type === 'delete-category'), ['delete-category', '/workspace', 'cat-1'])
  assert.deepEqual(calls.find(([type]) => type === 'move'), ['move', '/workspace', 'cmd-1', 'cat-2'])
  assert.deepEqual(calls.find(([type]) => type === 'delete'), ['delete', '/workspace', 'cmd-1'])
})

test('run invia il comando shell alla sola sessione attiva', () => {
  const { calls, handlers } = createHarness()

  assert.deepEqual(handlers.get('workspaceCommands:run')({ sender: { id: 7 } }, 'cmd-1'), { executed: true })
  assert.deepEqual(calls.find(([type]) => type === 'require-session'), ['require-session', '/workspace'])
  assert.deepEqual(calls.find(([type]) => type === 'write'), ['write', '/workspace', 'session-1', 'npm test\r'])
})

test('run costruisce SSH gestito e conserva l identificatore di recovery', () => {
  const { calls, handlers } = createHarness({
    getWorkspaceCommand: (_workspacePath, commandId) => ({ id: commandId, kind: 'ssh', host: 'example.internal' }),
  })

  assert.deepEqual(handlers.get('workspaceCommands:run')({ sender: { id: 7 } }, 'cmd-ssh'), {
    executed: true,
    managedConnectionId: 'managed-1',
  })
  assert.deepEqual(calls.find(([type]) => type === 'write'), ['write', '/workspace', 'session-1', 'ssh managed\r'])
  assert.deepEqual(calls.find(([type]) => type === 'wait-ssh'), ['wait-ssh', 'managed-1'])
})

test('run non scrive se il comando non esiste e propaga gli errori invariati', () => {
  const missing = createHarness({ getWorkspaceCommand: () => null })
  assert.throws(
    () => missing.handlers.get('workspaceCommands:run')({ sender: { id: 7 } }, 'missing'),
    /Comando del workspace non trovato/,
  )
  assert.equal(missing.calls.some(([type]) => type === 'write'), false)

  const rejection = new Error('sender rifiutato')
  const rejected = createHarness({ assertTrustedSender: () => { throw rejection } })
  assert.throws(
    () => rejected.handlers.get('workspaceCommands:list')({ sender: { id: 7 } }),
    (error) => error === rejection,
  )
})
