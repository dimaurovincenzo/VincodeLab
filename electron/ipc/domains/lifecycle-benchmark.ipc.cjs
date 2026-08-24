const LIFECYCLE_BENCHMARK_INVOKE_CHANNELS = Object.freeze([
  'benchmark:dispatchCommand',
  'benchmark:shutdown',
  'benchmark:captureWindowBounds',
  'benchmark:injectFault',
  'benchmark:probe',
])

const LIFECYCLE_BENCHMARK_SEND_CHANNELS = Object.freeze([
  'lifecycle:closeResponse',
])

function createLifecycleBenchmarkInvokeHandlers({
  assertTrustedSender,
  dispatchApplicationMenuCommand,
  getMainWindow,
  getQuitCleanupComplete,
  getQuitCleanupPromise,
  lifecycleCloseGuard,
  quitApplication,
  reliabilityBenchmarkCommands,
  reliabilityBenchmarkMode,
  reliabilityFaultInjection,
  reliabilityFaultInjectionMode,
  scheduleImmediate,
  screenshotCaptureMode,
  setQuitCleanupComplete,
  setQuitCleanupPromise,
  shutdownApplication,
}) {
  const handlers = new Map()
  if (!reliabilityBenchmarkMode) return handlers

  handlers.set('benchmark:dispatchCommand', (event, command) => {
    assertTrustedSender(event)
    if (!reliabilityBenchmarkCommands.has(command)) throw new Error('Comando benchmark non valido.')
    dispatchApplicationMenuCommand(command)
    return { dispatched: true }
  })
  handlers.set('benchmark:shutdown', async (event) => {
    assertTrustedSender(event)
    if (!getQuitCleanupPromise() && !getQuitCleanupComplete()) {
      const cleanupPromise = shutdownApplication().then(() => {
        setQuitCleanupComplete(true)
        lifecycleCloseGuard.dispose()
      })
      setQuitCleanupPromise(cleanupPromise)
    }
    const cleanupPromise = getQuitCleanupPromise()
    if (cleanupPromise) await cleanupPromise
    scheduleImmediate(() => quitApplication())
    return { accepted: true }
  })

  if (screenshotCaptureMode) {
    handlers.set('benchmark:captureWindowBounds', (event) => {
      assertTrustedSender(event)
      const window = getMainWindow()
      if (!window || window.isDestroyed()) throw new Error('Finestra di cattura non disponibile.')
      return {
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        maximized: window.isMaximized(),
        visible: window.isVisible(),
      }
    })
  }

  if (reliabilityFaultInjectionMode) {
    handlers.set('benchmark:injectFault', (event, fault) => {
      assertTrustedSender(event)
      return reliabilityFaultInjection.inject(fault)
    })
    handlers.set('benchmark:probe', (event) => {
      assertTrustedSender(event)
      return reliabilityFaultInjection.probe()
    })
  }
  return handlers
}

function createLifecycleBenchmarkSendListeners({
  assertTrustedSender,
  confineIpcOneWay,
  lifecycleCloseGuard,
  log,
}) {
  return new Map([
    ['lifecycle:closeResponse', confineIpcOneWay(
      'lifecycle:closeResponse',
      (event, response) => {
        try {
          assertTrustedSender(event)
        } catch {
          // La guardia registra già il rifiuto. Una risposta one-way non attendibile
          // non deve influire sul lifecycle della finestra legittima.
          return
        }
        if (!lifecycleCloseGuard.respondRenderer(response)) {
          log('warn', 'lifecycle_close_response_rejected')
        }
      },
    )],
  ])
}

function registerLifecycleBenchmarkIpc({ ipcMain, ...dependencies }) {
  const invokeHandlers = createLifecycleBenchmarkInvokeHandlers(dependencies)
  const sendListeners = createLifecycleBenchmarkSendListeners(dependencies)
  for (const [channel, handler] of invokeHandlers) ipcMain.handle(channel, handler)
  for (const [channel, listener] of sendListeners) ipcMain.on(channel, listener)
  return Object.freeze({
    invokeChannels: Object.freeze([...invokeHandlers.keys()]),
    sendChannels: LIFECYCLE_BENCHMARK_SEND_CHANNELS,
  })
}

module.exports = {
  LIFECYCLE_BENCHMARK_INVOKE_CHANNELS,
  LIFECYCLE_BENCHMARK_SEND_CHANNELS,
  createLifecycleBenchmarkInvokeHandlers,
  createLifecycleBenchmarkSendListeners,
  registerLifecycleBenchmarkIpc,
}
