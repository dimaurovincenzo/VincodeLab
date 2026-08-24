const assert = require('node:assert/strict')
const test = require('node:test')

const { createApplicationStartupRuntime } = require('../electron/app/application-startup-runtime.cjs')

function createFixture(overrides = {}) {
  const calls = []
  const appListeners = new Map()
  const themeListeners = new Map()
  const heartbeatTimer = { unref: () => calls.push('heartbeat:unref') }
  const registry = {
    heartbeat: (instanceId) => calls.push(`registry:heartbeat:${instanceId}`),
    register: (identity) => {
      calls.push(['registry:register', identity])
      return { accepted: true }
    },
    unregister: (instanceId) => calls.push(`registry:unregister:${instanceId}`),
  }
  let updateTask
  const runtime = createApplicationStartupRuntime({
    activatePendingUpdates: async () => {
      calls.push('updates:activate')
      return [{ success: true }]
    },
    app: {
      on: (event, listener) => appListeners.set(event, listener),
      quit: () => calls.push('app:quit'),
      whenReady: () => Promise.resolve(),
    },
    checkUpdates: async () => {
      calls.push('updates:check')
      return [{ status: 'available' }]
    },
    configureDatabaseSecretStorage: () => calls.push('secrets:database'),
    configureRedisSecretStorage: () => calls.push('secrets:redis'),
    createInstanceRegistry: () => {
      calls.push('registry:create')
      return registry
    },
    createMenu: () => calls.push('menu:create'),
    createWindow: () => calls.push('window:create'),
    dialog: { showErrorBox: (...args) => calls.push(['dialog', ...args]) },
    externalMutations: {
      run: (context, operation) => {
        calls.push(['updates:boundary', context])
        updateTask = operation()
        return updateTask
      },
    },
    fatalErrorExperience: { handleStartup: (error) => calls.push(['fatal', error]) },
    getAppearance: () => {
      calls.push('appearance:get')
      return 'dark'
    },
    getApplicationErrorLogMetadata: (incident) => ({ correlationId: incident.correlationId }),
    getDatabase: () => ({ id: 'database' }),
    getManagedSsh: () => calls.push('ssh:prepare'),
    getMainWindow: () => ({ setBackgroundColor: (color) => calls.push(`window:color:${color}`) }),
    getOpenWindows: () => [],
    instanceId: 'instance-a',
    log: (...entry) => calls.push(['log', ...entry]),
    migrateLegacyConnectionSecrets: () => ({ remaining: false, scrubbed: 0 }),
    nativeTheme: {
      shouldUseDarkColors: true,
      on: (event, listener) => themeListeners.set(event, listener),
      themeSource: 'system',
    },
    openWorkspace: async (workspacePath) => {
      calls.push(`workspace:open:${workspacePath}`)
      return { path: workspacePath }
    },
    piAgentRoot: '/tmp/pi-agent',
    processArguments: ['VincodeLab', '/tmp/workspace'],
    processId: 42,
    readWorkspaceArgument: () => '/tmp/workspace',
    reconcileManagedPiPackages: async (resolveExecutable, root) => {
      calls.push(['updates:reconcile', resolveExecutable(), root])
    },
    registerIpc: (receivedRegistry) => calls.push(['ipc:register', receivedRegistry]),
    resolvePiExecutable: () => '/usr/local/bin/pi',
    safeStorage: { id: 'safe-storage' },
    scheduleInterval: (callback, timeoutMs) => {
      calls.push(`heartbeat:schedule:${timeoutMs}`)
      heartbeatTimer.callback = callback
      return heartbeatTimer
    },
    cancelInterval: (timer) => calls.push(['heartbeat:cancel', timer]),
    toApplicationError: (_error, options) => ({ ...options, correlationId: 'ERR-A1B2C3' }),
    ...overrides,
  })
  return { appListeners, calls, heartbeatTimer, registry, runtime, themeListeners, updateTask: () => updateTask }
}

test('inizializza sicurezza, workspace, finestra e aggiornamenti nell’ordine storico', async () => {
  const fixture = createFixture()
  await fixture.runtime.initialize()
  await fixture.updateTask()

  assert.deepEqual(fixture.calls.slice(0, 12), [
    'secrets:database',
    'secrets:redis',
    'registry:create',
    ['registry:register', { instanceId: 'instance-a', pid: 42 }],
    'heartbeat:schedule:5000',
    'heartbeat:unref',
    'appearance:get',
    'ssh:prepare',
    'menu:create',
    'workspace:open:/tmp/workspace',
    'window:create',
    ['updates:boundary', { ownerId: 0, workspacePath: null, type: 'startup:managed-updates' }],
  ])
  assert.ok(fixture.calls.findIndex((entry) => entry === 'window:create') < fixture.calls.findIndex((entry) => Array.isArray(entry) && entry[0] === 'updates:reconcile'))
  assert.equal(fixture.themeListeners.has('updated'), true)
  assert.equal(fixture.appListeners.has('activate'), true)
  assert.deepEqual(fixture.calls.find((entry) => Array.isArray(entry) && entry[0] === 'ipc:register'), ['ipc:register', fixture.registry])

  fixture.heartbeatTimer.callback()
  fixture.themeListeners.get('updated')()
  fixture.appListeners.get('activate')()
  fixture.runtime.releaseInstanceRegistration()
  assert.equal(fixture.calls.includes('registry:heartbeat:instance-a'), true)
  assert.equal(fixture.calls.includes('window:color:#1c1c1e'), true)
  assert.equal(fixture.calls.filter((entry) => entry === 'window:create').length, 2)
  assert.equal(fixture.calls.includes('registry:unregister:instance-a'), true)
})

test('rifiuta una terza istanza prima di creare menu, finestra o IPC', async () => {
  const fixture = createFixture()
  fixture.registry.register = () => ({ accepted: false })
  await fixture.runtime.initialize()

  assert.equal(fixture.calls.some((entry) => Array.isArray(entry) && entry[0] === 'dialog' && entry[1] === 'VincodeLab è già aperto'), true)
  assert.equal(fixture.calls.includes('app:quit'), true)
  assert.equal(fixture.calls.includes('menu:create'), false)
  assert.equal(fixture.calls.includes('window:create'), false)
  assert.equal(fixture.calls.some((entry) => Array.isArray(entry) && entry[0] === 'ipc:register'), false)
})

test('confina migrazione e heartbeat degradati con diagnostica sanitizzata', () => {
  const migrationFailure = new Error('password=secret')
  const fixture = createFixture({
    migrateLegacyConnectionSecrets: () => { throw migrationFailure },
  })
  fixture.runtime.migrateLegacyDatabaseSecretsInBatches()

  assert.deepEqual(fixture.calls.at(-1), ['log', 'warning', 'database_secrets_migration_deferred', { correlationId: 'ERR-A1B2C3' }])
  assert.doesNotMatch(JSON.stringify(fixture.calls), /password=secret/u)
})

test('start inoltra i failure imprevisti alla fatal Error Experience', async () => {
  const failure = new Error('startup failure')
  const fixture = createFixture({ configureDatabaseSecretStorage: () => { throw failure } })
  fixture.runtime.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(fixture.calls, [['fatal', failure]])
})
