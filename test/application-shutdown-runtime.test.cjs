const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createApplicationShutdownRuntime,
  withCleanupDeadline,
} = require('../electron/app/application-shutdown-runtime.cjs')

function createFixture(overrides = {}) {
  const calls = []
  const listeners = new Map()
  const lifecycleCloseGuard = {
    dispose: () => calls.push('guard:dispose'),
    request: (reason) => calls.push(`guard:request:${reason}`),
  }
  const runtime = createApplicationShutdownRuntime({
    app: {
      on: (event, listener) => listeners.set(event, listener),
      quit: () => calls.push('app:quit'),
    },
    benchmarkMode: true,
    closeDatabase: () => calls.push('database:close-store'),
    closeDatabaseWorkspaceSessions: (workspacePath) => {
      calls.push(`database:close:${workspacePath}`)
      return Promise.resolve()
    },
    closeRedisWorkspaceSessions: (workspacePath) => {
      calls.push(`redis:close:${workspacePath}`)
      return Promise.resolve()
    },
    databaseOperations: { abortAll: () => { calls.push('database:abort'); return Promise.resolve() } },
    dialog: { showErrorBox: (...args) => calls.push(['dialog', ...args]) },
    disposeRendererRecovery: () => calls.push('renderer:dispose'),
    externalMutations: { waitAll: () => { calls.push('external:wait'); return Promise.resolve() } },
    flushLogs: () => { calls.push('logs:flush'); return Promise.resolve() },
    getActiveWorkspacePath: () => '/tmp/workspace',
    getMainWindow: () => ({ isDestroyed: () => false }),
    githubOperations: { abortAndWaitMatching: () => { calls.push('github:abort'); return Promise.resolve() } },
    lifecycleCloseGuard,
    log: (...entry) => calls.push(['log', ...entry]),
    platform: 'linux',
    projectFileIndex: { clear: () => calls.push('index:clear') },
    redisOperations: { abortAll: () => { calls.push('redis:abort'); return Promise.resolve() } },
    releaseInstanceRegistration: () => calls.push('instance:release'),
    remoteRuntime: {
      closeAll: (deadline) => {
        calls.push(['remote:close', deadline])
        return Promise.resolve()
      },
    },
    shellSessionManager: { dispose: () => { calls.push('shell:dispose'); return Promise.resolve() } },
    stopPiConfig: () => { calls.push('pi-config:stop'); return Promise.resolve() },
    stopTerminal: (reason) => { calls.push(`pi:stop:${reason}`); return Promise.resolve() },
    withDeadline: async (promise, timeoutMs, operation) => {
      calls.push(`deadline:${operation}:${timeoutMs}`)
      return await promise
    },
    writeBenchmarkTrace: (message) => calls.push(`trace:${message.trim().split(' ').at(-1)}`),
    ...overrides,
  })
  return { calls, lifecycleCloseGuard, listeners, runtime }
}

test('preserva ordine, timeout e ownership dell’intero shutdown applicativo', async () => {
  const fixture = createFixture()
  await fixture.runtime.shutdownApplication()

  assert.deepEqual(fixture.calls, [
    'trace:shutdown-start',
    ['log', 'info', 'app_stopping'],
    'renderer:dispose',
    'index:clear',
    'external:wait',
    'deadline:external-mutations:13000',
    'pi:stop:shutdown',
    'trace:pi-stopped',
    'database:abort',
    'database:close:/tmp/workspace',
    'deadline:database-runtime:6000',
    'redis:abort',
    'redis:close:/tmp/workspace',
    'deadline:redis-runtime:6000',
    'github:abort',
    'deadline:github-operations:4000',
    'trace:github-stopped',
    'trace:database-stopped',
    ['remote:close', fixture.calls.find((entry) => Array.isArray(entry) && entry[0] === 'remote:close')[1]],
    'trace:remote-files-stopped',
    'trace:ssh-stopped',
    'pi-config:stop',
    'shell:dispose',
    'trace:pty-stopped',
    'logs:flush',
    'deadline:logs:1500',
    'trace:logs-flushed',
    'instance:release',
    'trace:shutdown-complete',
  ])
  assert.equal(fixture.calls.find((entry) => Array.isArray(entry) && entry[0] === 'remote:close')[1] instanceof Function, true)
})

test('un cleanup fallito resta fail-closed e consente un nuovo tentativo completo', async () => {
  let attempts = 0
  const fixture = createFixture({
    stopTerminal: () => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new Error('PTY occupato'))
      return Promise.resolve()
    },
  })

  fixture.runtime.beginApprovedQuit()
  await fixture.runtime.getQuitCleanupPromise()
  assert.equal(fixture.runtime.getQuitCleanupPromise(), undefined)
  assert.equal(fixture.runtime.getQuitCleanupComplete(), false)
  assert.equal(fixture.calls.some((entry) => Array.isArray(entry) && entry[0] === 'dialog'), true)

  fixture.runtime.beginApprovedQuit()
  await fixture.runtime.getQuitCleanupPromise()
  assert.equal(fixture.runtime.getQuitCleanupComplete(), true)
  assert.equal(attempts, 2)
  assert.deepEqual(fixture.calls.slice(-3), ['trace:shutdown-complete', 'guard:dispose', 'app:quit'])
})

test('installa guardie Electron fail-closed e chiude il database soltanto su will-quit', () => {
  const fixture = createFixture()
  fixture.runtime.install()
  assert.deepEqual([...fixture.listeners.keys()], ['window-all-closed', 'before-quit', 'will-quit'])

  let prevented = false
  fixture.listeners.get('before-quit')({ preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(fixture.calls.at(-1), 'guard:request:quit')
  fixture.listeners.get('will-quit')()
  assert.equal(fixture.calls.at(-1), 'database:close-store')
})

test('withCleanupDeadline annulla il timer e produce il codice pubblico previsto', async () => {
  let timerCallback
  let unrefCount = 0
  const cancelled = []
  const pending = new Promise(() => undefined)
  const result = withCleanupDeadline(pending, 25, 'fixture', {
    cancelTimer: (timer) => cancelled.push(timer),
    scheduleTimer: (callback) => {
      timerCallback = callback
      return { unref: () => { unrefCount += 1 } }
    },
  })
  timerCallback()
  await assert.rejects(result, (error) => error.code === 'CLEANUP_TIMEOUT' && /fixture/u.test(error.message))
  assert.equal(unrefCount, 1)
  assert.equal(cancelled.length, 1)
})
