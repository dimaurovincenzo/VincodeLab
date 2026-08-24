const assert = require('node:assert/strict')
const test = require('node:test')

const {
  MANAGED_SSH_INVOKE_CHANNELS,
  createManagedSshHandlers,
  registerManagedSshIpc,
} = require('../electron/ipc/domains/managed-ssh.ipc.cjs')

function deferred() {
  let reject
  let resolve
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, reject, resolve }
}

function managedSshFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const results = {
    check: { connected: true },
    list: [{ id: 'ssh-1' }],
  }
  const managedSsh = {
    check: (connectionId) => { calls.push(['check', connectionId]); return results.check },
    disconnect: async (connectionId) => { calls.push(['disconnect', connectionId]) },
    list: (workspacePath) => { calls.push(['list', workspacePath]); return results.list },
    ...overrides.managedSsh,
  }
  const sftpService = overrides.sftpService === undefined
    ? { closeConnection: async (connectionId) => { calls.push(['sftp-close', connectionId]) } }
    : overrides.sftpService
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    getManagedSsh: () => { calls.push(['managed-factory']); return managedSsh },
    getSftpService: () => { calls.push(['sftp-factory']); return sftpService },
    requireActiveWorkspace: () => { calls.push(['workspace']); return '/workspace/current' },
    requireManagedConnectionForWorkspace: (connectionId) => {
      calls.push(['require-connection', connectionId])
      return { id: connectionId, workspacePath: '/workspace/current' }
    },
    ...overrides.dependencies,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, results }
}

test('registra il manifesto completo Managed SSH senza duplicati', () => {
  const fixture = managedSshFixture()
  const registration = registerManagedSshIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(MANAGED_SSH_INVOKE_CHANNELS, [
    'managedSsh:list',
    'managedSsh:check',
    'managedSsh:disconnect',
  ])
  assert.deepEqual(registration.channels, MANAGED_SSH_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], MANAGED_SSH_INVOKE_CHANNELS)
})

test('lista e verifica connessioni preservando guardie, workspace e factory', () => {
  const fixture = managedSshFixture()
  const handlers = createManagedSshHandlers(fixture.dependencies)
  const event = { sender: { id: 7 } }

  assert.equal(handlers.get('managedSsh:list')(event), fixture.results.list)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['managed-factory'],
    ['workspace'],
    ['list', '/workspace/current'],
  ])

  fixture.calls.length = 0
  assert.equal(handlers.get('managedSsh:check')(event, 'ssh-1'), fixture.results.check)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-connection', 'ssh-1'],
    ['managed-factory'],
    ['check', 'ssh-1'],
  ])
})

test('disconnect attende in ordine cleanup SFTP e ControlMaster', async () => {
  const sftpClose = deferred()
  const sshDisconnect = deferred()
  const fixture = managedSshFixture({
    managedSsh: {
      disconnect: (connectionId) => {
        fixture.calls.push(['disconnect', connectionId])
        return sshDisconnect.promise
      },
    },
    sftpService: {
      closeConnection: (connectionId) => {
        fixture.calls.push(['sftp-close', connectionId])
        return sftpClose.promise
      },
    },
  })
  const event = { sender: { id: 9 } }
  const handler = createManagedSshHandlers(fixture.dependencies).get('managedSsh:disconnect')
  const operation = handler(event, 'ssh-1')

  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-connection', 'ssh-1'],
    ['sftp-factory'],
    ['sftp-close', 'ssh-1'],
  ])
  sftpClose.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(fixture.calls.slice(-2), [['managed-factory'], ['disconnect', 'ssh-1']])

  sshDisconnect.resolve()
  assert.deepEqual(await operation, { disconnected: true })
})

test('disconnect supporta SFTP non inizializzato senza alterare il risultato', async () => {
  const fixture = managedSshFixture({ sftpService: null })
  const event = { sender: { id: 11 } }
  const handler = createManagedSshHandlers(fixture.dependencies).get('managedSsh:disconnect')

  assert.deepEqual(await handler(event, 'ssh-2'), { disconnected: true })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-connection', 'ssh-2'],
    ['sftp-factory'],
    ['managed-factory'],
    ['disconnect', 'ssh-2'],
  ])
})

test('propaga invariati errori di ownership, cleanup SFTP e disconnect', async () => {
  const ownershipError = new Error('connection ownership failed')
  const ownershipFixture = managedSshFixture({
    dependencies: { requireManagedConnectionForWorkspace: () => { throw ownershipError } },
  })
  const ownershipHandler = createManagedSshHandlers(ownershipFixture.dependencies).get('managedSsh:check')
  assert.throws(() => ownershipHandler({ sender: { id: 1 } }, 'ssh-1'), (error) => error === ownershipError)

  const sftpError = new Error('sftp cleanup failed')
  const sftpFixture = managedSshFixture({
    sftpService: { closeConnection: async () => { throw sftpError } },
  })
  const sftpHandler = createManagedSshHandlers(sftpFixture.dependencies).get('managedSsh:disconnect')
  await assert.rejects(sftpHandler({ sender: { id: 2 } }, 'ssh-1'), (error) => error === sftpError)
  assert.equal(sftpFixture.calls.some(([kind]) => kind === 'managed-factory'), false)

  const disconnectError = new Error('ssh disconnect failed')
  const disconnectFixture = managedSshFixture({
    managedSsh: { disconnect: async () => { throw disconnectError } },
    sftpService: null,
  })
  const disconnectHandler = createManagedSshHandlers(disconnectFixture.dependencies).get('managedSsh:disconnect')
  await assert.rejects(disconnectHandler({ sender: { id: 3 } }, 'ssh-1'), (error) => error === disconnectError)
})
