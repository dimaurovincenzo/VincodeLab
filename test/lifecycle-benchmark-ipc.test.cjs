const assert = require('node:assert/strict')
const test = require('node:test')

const {
  LIFECYCLE_BENCHMARK_INVOKE_CHANNELS,
  LIFECYCLE_BENCHMARK_SEND_CHANNELS,
  createLifecycleBenchmarkInvokeHandlers,
  createLifecycleBenchmarkSendListeners,
  registerLifecycleBenchmarkIpc,
} = require('../electron/ipc/domains/lifecycle-benchmark.ipc.cjs')

function dependencies(overrides = {}) {
  return {
    assertTrustedSender() {},
    confineIpcOneWay: (_channel, listener) => listener,
    dispatchApplicationMenuCommand() {},
    getMainWindow: () => null,
    getQuitCleanupComplete: () => false,
    getQuitCleanupPromise: () => null,
    lifecycleCloseGuard: { dispose() {}, respondRenderer: () => true },
    log() {},
    quitApplication() {},
    reliabilityBenchmarkCommands: new Set(['workbench.commandPalette', 'workbench.quickOpen']),
    reliabilityBenchmarkMode: false,
    reliabilityFaultInjection: { inject: () => undefined, probe: () => undefined },
    reliabilityFaultInjectionMode: false,
    scheduleImmediate: (callback) => callback(),
    screenshotCaptureMode: false,
    setQuitCleanupComplete() {},
    setQuitCleanupPromise() {},
    shutdownApplication: () => Promise.resolve(),
    ...overrides,
  }
}

test('i manifesti registrano tutti i canali autorizzati e confinano closeResponse', () => {
  const handles = new Map()
  const listeners = new Map()
  const confined = []
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handles.has(channel), false, `invoke duplicato: ${channel}`)
      handles.set(channel, handler)
    },
    on(channel, listener) {
      assert.equal(listeners.has(channel), false, `send duplicato: ${channel}`)
      listeners.set(channel, listener)
    },
  }
  const registration = registerLifecycleBenchmarkIpc({
    ipcMain,
    ...dependencies({
      reliabilityBenchmarkMode: true,
      screenshotCaptureMode: true,
      reliabilityFaultInjectionMode: true,
      confineIpcOneWay(channel, listener) {
        const wrapped = (...args) => listener(...args)
        confined.push([channel, listener, wrapped])
        return wrapped
      },
    }),
  })

  assert.deepEqual(LIFECYCLE_BENCHMARK_INVOKE_CHANNELS, [
    'benchmark:dispatchCommand',
    'benchmark:shutdown',
    'benchmark:captureWindowBounds',
    'benchmark:injectFault',
    'benchmark:probe',
  ])
  assert.deepEqual(LIFECYCLE_BENCHMARK_SEND_CHANNELS, ['lifecycle:closeResponse'])
  assert.deepEqual([...handles.keys()], LIFECYCLE_BENCHMARK_INVOKE_CHANNELS)
  assert.deepEqual([...listeners.keys()], LIFECYCLE_BENCHMARK_SEND_CHANNELS)
  assert.equal(confined.length, 1)
  assert.equal(confined[0][0], 'lifecycle:closeResponse')
  assert.equal(listeners.get('lifecycle:closeResponse'), confined[0][2])
  assert.deepEqual(registration.invokeChannels, LIFECYCLE_BENCHMARK_INVOKE_CHANNELS)
  assert.deepEqual(registration.sendChannels, LIFECYCLE_BENCHMARK_SEND_CHANNELS)
  assert.equal(Object.isFrozen(LIFECYCLE_BENCHMARK_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(LIFECYCLE_BENCHMARK_SEND_CHANNELS), true)
  assert.equal(Object.isFrozen(registration.invokeChannels), true)
  assert.equal(Object.isFrozen(registration), true)
})

test('il gating replica l annidamento reliability screenshot e fault injection', () => {
  const channels = (flags) => [...createLifecycleBenchmarkInvokeHandlers(dependencies(flags)).keys()]

  assert.deepEqual(channels({
    reliabilityBenchmarkMode: false,
    screenshotCaptureMode: true,
    reliabilityFaultInjectionMode: true,
  }), [])
  assert.deepEqual(channels({ reliabilityBenchmarkMode: true }), [
    'benchmark:dispatchCommand',
    'benchmark:shutdown',
  ])
  assert.deepEqual(channels({
    reliabilityBenchmarkMode: true,
    screenshotCaptureMode: true,
  }), [
    'benchmark:dispatchCommand',
    'benchmark:shutdown',
    'benchmark:captureWindowBounds',
  ])
  assert.deepEqual(channels({
    reliabilityBenchmarkMode: true,
    reliabilityFaultInjectionMode: true,
  }), [
    'benchmark:dispatchCommand',
    'benchmark:shutdown',
    'benchmark:injectFault',
    'benchmark:probe',
  ])
})

test('closeResponse ignora sender non trusted e segnala soltanto risposte rifiutate', () => {
  const calls = []
  const event = { sender: { id: 71 } }
  let trusted = true
  let accepted = true
  const listeners = createLifecycleBenchmarkSendListeners(dependencies({
    assertTrustedSender(receivedEvent) {
      calls.push(['guard', receivedEvent])
      if (!trusted) throw new Error('untrusted')
    },
    lifecycleCloseGuard: {
      dispose() {},
      respondRenderer(response) {
        calls.push(['respond', response])
        return accepted
      },
    },
    log: (...args) => calls.push(['log', ...args]),
  }))

  listeners.get('lifecycle:closeResponse')(event, { requestId: 'one', decision: 'save' })
  accepted = false
  listeners.get('lifecycle:closeResponse')(event, { requestId: 'two', decision: 'cancel' })
  trusted = false
  assert.doesNotThrow(() => listeners.get('lifecycle:closeResponse')(
    { sender: { id: 999 } },
    { requestId: 'forged', decision: 'discard' },
  ))
  assert.deepEqual(calls, [
    ['guard', event],
    ['respond', { requestId: 'one', decision: 'save' }],
    ['guard', event],
    ['respond', { requestId: 'two', decision: 'cancel' }],
    ['log', 'warn', 'lifecycle_close_response_rejected'],
    ['guard', { sender: { id: 999 } }],
  ])
})

test('dispatchCommand applica trusted guard e allowlist prima del dispatch', () => {
  const calls = []
  const event = { sender: { id: 73 } }
  const handlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    reliabilityBenchmarkCommands: new Set(['workbench.quickOpen']),
    dispatchApplicationMenuCommand: (command) => calls.push(['dispatch', command]),
  }))

  assert.deepEqual(handlers.get('benchmark:dispatchCommand')(event, 'workbench.quickOpen'), {
    dispatched: true,
  })
  assert.throws(
    () => handlers.get('benchmark:dispatchCommand')(event, 'editor.delete'),
    /Comando benchmark non valido\./,
  )
  assert.deepEqual(calls, [
    ['guard', event],
    ['dispatch', 'workbench.quickOpen'],
    ['guard', event],
  ])
})

test('shutdown condivide la cleanup concorrente, dispone la guardia e differisce quit', async () => {
  const calls = []
  const scheduled = []
  const event = { sender: { id: 75 } }
  const state = { complete: false, promise: null }
  let resolveCleanup
  const cleanup = new Promise((resolve) => { resolveCleanup = resolve })
  const handlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    getQuitCleanupComplete: () => state.complete,
    getQuitCleanupPromise: () => state.promise,
    setQuitCleanupComplete(value) {
      calls.push(['set-complete', value])
      state.complete = value
    },
    setQuitCleanupPromise(value) {
      calls.push(['set-promise', value])
      state.promise = value
    },
    shutdownApplication() {
      calls.push(['shutdown'])
      return cleanup
    },
    lifecycleCloseGuard: {
      respondRenderer: () => true,
      dispose: () => calls.push(['dispose']),
    },
    scheduleImmediate(callback) {
      calls.push(['schedule'])
      scheduled.push(callback)
    },
    quitApplication: () => calls.push(['quit']),
  }))

  const first = handlers.get('benchmark:shutdown')(event)
  const second = handlers.get('benchmark:shutdown')(event)
  assert.equal(calls.filter(([kind]) => kind === 'shutdown').length, 1)
  assert.equal(state.promise instanceof Promise, true)
  resolveCleanup()
  assert.deepEqual(await first, { accepted: true })
  assert.deepEqual(await second, { accepted: true })
  assert.equal(state.complete, true)
  assert.equal(calls.filter(([kind]) => kind === 'dispose').length, 1)
  assert.equal(scheduled.length, 2)
  assert.equal(calls.some(([kind]) => kind === 'quit'), false)
  for (const callback of scheduled) callback()
  assert.equal(calls.filter(([kind]) => kind === 'quit').length, 2)
})

test('shutdown riusa lo stato esistente e propaga una cleanup rifiutata senza quit', async () => {
  const calls = []
  const completeHandlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    getQuitCleanupComplete: () => true,
    shutdownApplication: () => { calls.push('unexpected-shutdown') },
    scheduleImmediate: (callback) => { calls.push('schedule'); callback() },
    quitApplication: () => calls.push('quit'),
  }))
  assert.deepEqual(await completeHandlers.get('benchmark:shutdown')({}), { accepted: true })
  assert.deepEqual(calls, ['schedule', 'quit'])

  const cleanupError = new Error('cleanup failed')
  const state = { complete: false, promise: null }
  let scheduled = false
  let disposed = false
  const rejectedHandlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    getQuitCleanupComplete: () => state.complete,
    getQuitCleanupPromise: () => state.promise,
    setQuitCleanupComplete: (value) => { state.complete = value },
    setQuitCleanupPromise: (value) => { state.promise = value },
    shutdownApplication: () => Promise.reject(cleanupError),
    lifecycleCloseGuard: { respondRenderer: () => true, dispose: () => { disposed = true } },
    scheduleImmediate: () => { scheduled = true },
  }))
  await assert.rejects(
    rejectedHandlers.get('benchmark:shutdown')({}),
    (error) => error === cleanupError,
  )
  assert.equal(state.promise instanceof Promise, true)
  assert.equal(state.complete, false)
  assert.equal(disposed, false)
  assert.equal(scheduled, false)
})

test('captureWindowBounds conserva owner, stato e failure della finestra', () => {
  const event = { sender: { id: 77 } }
  const bounds = { x: 10, y: 20, width: 1440, height: 900 }
  const contentBounds = { x: 10, y: 50, width: 1440, height: 870 }
  const window = {
    isDestroyed: () => false,
    getBounds: () => bounds,
    getContentBounds: () => contentBounds,
    isMaximized: () => false,
    isVisible: () => true,
  }
  const calls = []
  const handlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    screenshotCaptureMode: true,
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    getMainWindow: () => window,
  }))

  assert.deepEqual(handlers.get('benchmark:captureWindowBounds')(event), {
    bounds,
    contentBounds,
    maximized: false,
    visible: true,
  })
  assert.deepEqual(calls, [['guard', event]])

  for (const unavailableWindow of [null, { isDestroyed: () => true }]) {
    const unavailable = createLifecycleBenchmarkInvokeHandlers(dependencies({
      reliabilityBenchmarkMode: true,
      screenshotCaptureMode: true,
      getMainWindow: () => unavailableWindow,
    }))
    assert.throws(
      () => unavailable.get('benchmark:captureWindowBounds')({}),
      /Finestra di cattura non disponibile\./,
    )
  }
})

test('fault injection e probe mantengono guardie, argomenti, risultati ed errori', () => {
  const calls = []
  const event = { sender: { id: 79 } }
  const fault = { target: 'workspace-session', mode: 'corrupt' }
  const injection = { injected: true }
  const probe = { active: true }
  const handlers = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    reliabilityFaultInjectionMode: true,
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    reliabilityFaultInjection: {
      inject(value) { calls.push(['inject', value]); return injection },
      probe() { calls.push(['probe']); return probe },
    },
  }))

  assert.equal(handlers.get('benchmark:injectFault')(event, fault), injection)
  assert.equal(handlers.get('benchmark:probe')(event), probe)
  assert.deepEqual(calls, [
    ['guard', event], ['inject', fault],
    ['guard', event], ['probe'],
  ])

  const expected = new Error('fault injection failed')
  const failing = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    reliabilityFaultInjectionMode: true,
    reliabilityFaultInjection: {
      inject() { throw expected },
      probe: () => undefined,
    },
  }))
  assert.throws(
    () => failing.get('benchmark:injectFault')({}, fault),
    (error) => error === expected,
  )
})

test('le guardie benchmark e gli errori downstream propagano invariati', () => {
  const guardError = new Error('untrusted sender')
  let dispatched = false
  const guarded = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    assertTrustedSender() { throw guardError },
    dispatchApplicationMenuCommand() { dispatched = true },
  }))
  assert.throws(
    () => guarded.get('benchmark:dispatchCommand')({}, 'workbench.quickOpen'),
    (error) => error === guardError,
  )
  assert.equal(dispatched, false)

  const dispatchError = new Error('dispatch failed')
  const failing = createLifecycleBenchmarkInvokeHandlers(dependencies({
    reliabilityBenchmarkMode: true,
    dispatchApplicationMenuCommand() { throw dispatchError },
  }))
  assert.throws(
    () => failing.get('benchmark:dispatchCommand')({}, 'workbench.quickOpen'),
    (error) => error === dispatchError,
  )
})
