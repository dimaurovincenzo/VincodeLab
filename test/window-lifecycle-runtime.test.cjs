const assert = require('node:assert/strict')
const test = require('node:test')

const { createWindowLifecycleRuntime } = require('../electron/app/window-lifecycle-runtime.cjs')

test('crea una BrowserWindow confinata e installa i guard prima del renderer', () => {
  const order = []
  let browserOptions
  let mainWindow
  let recoveryDisposed = 0
  class FakeBrowserWindow {
    constructor(options) {
      browserOptions = options
      this.handlers = new Map()
      this.webContents = {
        id: 17,
        handlers: new Map(),
        isDestroyed: () => false,
        on: (name, handler) => this.webContents.handlers.set(name, handler),
        reload: () => order.push('reload'),
      }
    }

    isDestroyed() { return false }
    loadFile(file) { order.push(`load:${file}`); return Promise.resolve() }
    loadURL(url) { order.push(`url:${url}`); return Promise.resolve() }
    on(name, handler) { this.handlers.set(name, handler) }
    once(name, handler) { this.handlers.set(name, handler) }
  }

  const lifecycleCloseGuard = {
    getPending: () => undefined,
    request: () => undefined,
    respondTimeout: () => undefined,
  }
  const windowCloseCoordinator = {
    isPending: () => false,
    request: () => Promise.resolve(),
  }
  const runtime = createWindowLifecycleRuntime({
    BrowserWindow: FakeBrowserWindow,
    benchmarkMode: true,
    beginApprovedQuit: () => undefined,
    cleanupWorkspaceRuntime: () => Promise.resolve(),
    closeDatabaseWorkspaceSessions: () => Promise.resolve(),
    closeRedisWorkspaceSessions: () => Promise.resolve(),
    createLifecycleCloseController: () => lifecycleCloseGuard,
    createRendererRecoveryController: () => ({
      dispose: () => { recoveryDisposed += 1 },
      handleLoadFailure: () => Promise.resolve(),
      handleLoadFinished: () => undefined,
      handlePreloadFailure: () => Promise.resolve(),
      handleProcessGone: () => Promise.resolve(),
    }),
    createWindowCloseCoordinator: () => windowCloseCoordinator,
    databaseOperations: { abortOwner: () => Promise.resolve() },
    dialog: { showMessageBox: () => Promise.resolve({ response: 1 }) },
    faultInjectionMode: true,
    getActiveWorkspacePath: () => '/workspace',
    getApplicationErrorLogMetadata: () => ({}),
    getInstanceRegistry: () => undefined,
    getMainWindow: () => mainWindow,
    getQuitCleanupComplete: () => false,
    getQuitCleanupPromise: () => undefined,
    installNavigationGuards: () => order.push('guards'),
    instanceId: 'instance-1',
    log: () => undefined,
    nativeTheme: { shouldUseDarkColors: true },
    parseRendererDiagnosticMessage: () => undefined,
    preloadPath: '/app/preload.cjs',
    redisOperations: { abortOwner: () => Promise.resolve() },
    rendererEntryPath: '/app/dist/index.html',
    reportPreloadFailure: () => undefined,
    screenshotCaptureMode: false,
    screenshotViewport: { width: 1440, height: 900 },
    sendToRenderer: () => undefined,
    setActiveWorkspaceError: () => undefined,
    setActiveWorkspaceIncident: () => undefined,
    setActiveWorkspacePath: () => undefined,
    setMainWindow: (value) => { mainWindow = value },
    toApplicationError: (error) => error,
    withCleanupDeadline: (promise) => promise,
  })

  const window = runtime.createWindow()
  assert.equal(mainWindow, window)
  assert.deepEqual(order, ['guards', 'load:/app/dist/index.html'])
  assert.equal(browserOptions.webPreferences.contextIsolation, true)
  assert.equal(browserOptions.webPreferences.nodeIntegration, false)
  assert.equal(browserOptions.webPreferences.sandbox, true)
  assert.equal(browserOptions.webPreferences.preload, '/app/preload.cjs')
  assert.deepEqual(browserOptions.webPreferences.additionalArguments, [
    '--vincodelab-reliability-benchmark',
    '--vincodelab-reliability-fault-injection',
  ])
  runtime.disposeRendererRecovery()
  assert.equal(recoveryDisposed, 1)
})
