const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PI_SYSTEM_INVOKE_CHANNELS,
  createPiSystemHandlers,
  registerPiSystemIpc,
} = require('../electron/ipc/domains/pi-system.ipc.cjs')

function piSystemFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const results = {
    install: { output: 'installed' },
    packages: ['pkg-one', 'pkg-two'],
    remove: { output: 'removed' },
    skills: [{ id: 'review', name: 'Review' }],
    status: { executable: '/usr/local/bin/pi', state: 'ready', version: '1.0.0' },
    update: { output: 'updated' },
  }
  const resolvePiExecutable = () => '/usr/local/bin/pi'
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    getPiSystemStatus: (resolveExecutable) => {
      calls.push(['status', resolveExecutable])
      return results.status
    },
    installPiPackage: async (source, resolveExecutable) => {
      calls.push(['install', source, resolveExecutable])
      return results.install
    },
    listPiPackageSkills: (resolveExecutable) => {
      calls.push(['list-skills', resolveExecutable])
      return results.skills
    },
    listPiPackages: (resolveExecutable) => {
      calls.push(['list', resolveExecutable])
      return results.packages
    },
    piAgentRoot: '/agent-root',
    reconcileManagedPiPackages: async (resolveExecutable, allowedRoot) => {
      calls.push(['reconcile', resolveExecutable, allowedRoot])
      return []
    },
    removePiPackage: async (source, resolveExecutable) => {
      calls.push(['remove', source, resolveExecutable])
      return results.remove
    },
    resolvePiExecutable,
    runExternalMutation: (event, type, workspacePath, operation) => {
      calls.push(['mutation', event, type, workspacePath])
      dependencies.assertTrustedSender(event)
      return operation()
    },
    updatePiPackage: async (source, resolveExecutable) => {
      calls.push(['update', source, resolveExecutable])
      return results.update
    },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, resolvePiExecutable, results }
}

test('registra una sola volta il manifesto IPC Pi System', () => {
  const fixture = piSystemFixture()
  const registration = registerPiSystemIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(PI_SYSTEM_INVOKE_CHANNELS, [
    'piSystem:status',
    'piSystem:list',
    'piSystem:listSkills',
    'piSystem:install',
    'piSystem:update',
    'piSystem:remove',
  ])
  assert.deepEqual(registration.channels, PI_SYSTEM_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], PI_SYSTEM_INVOKE_CHANNELS)
})

test('protegge le letture e inoltra il resolver Pi senza eseguirlo nel registrar', () => {
  const fixture = piSystemFixture()
  const handlers = createPiSystemHandlers(fixture.dependencies)
  const event = { sender: { id: 42 } }

  assert.equal(handlers.get('piSystem:status')(event), fixture.results.status)
  assert.equal(handlers.get('piSystem:list')(event), fixture.results.packages)
  assert.equal(handlers.get('piSystem:listSkills')(event), fixture.results.skills)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['status', fixture.resolvePiExecutable],
    ['guard', event],
    ['list', fixture.resolvePiExecutable],
    ['guard', event],
    ['list-skills', fixture.resolvePiExecutable],
  ])
})

test('installa e aggiorna tramite mutation registry prima di riconciliare i pacchetti gestiti', async () => {
  const fixture = piSystemFixture()
  const handlers = createPiSystemHandlers(fixture.dependencies)
  const event = { sender: { id: 7 } }

  assert.equal(await handlers.get('piSystem:install')(event, 'pkg-install'), fixture.results.install)
  assert.equal(await handlers.get('piSystem:update')(event, 'pkg-update'), fixture.results.update)
  assert.deepEqual(fixture.calls, [
    ['mutation', event, 'pi-system:install', null],
    ['guard', event],
    ['install', 'pkg-install', fixture.resolvePiExecutable],
    ['reconcile', fixture.resolvePiExecutable, '/agent-root'],
    ['mutation', event, 'pi-system:update', null],
    ['guard', event],
    ['update', 'pkg-update', fixture.resolvePiExecutable],
    ['reconcile', fixture.resolvePiExecutable, '/agent-root'],
  ])
})

test('rimuove tramite mutation registry senza riconciliazione aggiuntiva', async () => {
  const fixture = piSystemFixture()
  const event = { sender: { id: 9 } }
  const handler = createPiSystemHandlers(fixture.dependencies).get('piSystem:remove')

  assert.equal(await handler(event, 'pkg-remove'), fixture.results.remove)
  assert.deepEqual(fixture.calls, [
    ['mutation', event, 'pi-system:remove', null],
    ['guard', event],
    ['remove', 'pkg-remove', fixture.resolvePiExecutable],
  ])
})

test('non riconcilia dopo un install fallito e propaga lo stesso errore', async () => {
  const expected = new Error('install failed')
  const fixture = piSystemFixture({ installPiPackage: async () => { throw expected } })
  const handler = createPiSystemHandlers(fixture.dependencies).get('piSystem:install')

  await assert.rejects(handler({ sender: { id: 1 } }, 'broken-package'), (error) => error === expected)
  assert.equal(fixture.calls.some(([kind]) => kind === 'reconcile'), false)
})

test('propaga gli errori di lettura, mutation registry e reconcile senza trasformarli', async () => {
  const readError = new Error('status failed')
  const mutationError = new Error('registry failed')
  const reconcileError = new Error('reconcile failed')

  const readFixture = piSystemFixture({ getPiSystemStatus: () => { throw readError } })
  const readHandler = createPiSystemHandlers(readFixture.dependencies).get('piSystem:status')
  assert.throws(() => readHandler({ sender: { id: 1 } }), (error) => error === readError)
  assert.equal(readFixture.calls[0][0], 'guard')

  const mutationFixture = piSystemFixture({ runExternalMutation: () => { throw mutationError } })
  const removeHandler = createPiSystemHandlers(mutationFixture.dependencies).get('piSystem:remove')
  assert.throws(() => removeHandler({ sender: { id: 2 } }, 'pkg'), (error) => error === mutationError)

  const reconcileFixture = piSystemFixture({
    reconcileManagedPiPackages: async () => { throw reconcileError },
  })
  const updateHandler = createPiSystemHandlers(reconcileFixture.dependencies).get('piSystem:update')
  await assert.rejects(updateHandler({ sender: { id: 3 } }, 'pkg'), (error) => error === reconcileError)
})
