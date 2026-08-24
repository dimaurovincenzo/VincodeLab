const assert = require('node:assert/strict')
const test = require('node:test')

const { createPiRuntime } = require('../electron/domains/ai/pi-runtime.cjs')

test('richiede esplicitamente ambiente, resolver e liveness del processo Pi', () => {
  assert.throws(() => createPiRuntime({}), /Provider ambiente runtime Pi non valido/u)
})

function fixture() {
  const deliveries = []
  const logs = []
  const spawned = []
  let sessionOptions
  let streamOptions
  let onData
  let onExit
  const pty = {
    kill() {},
    onData(listener) { onData = listener },
    onExit(listener) { onExit = listener },
  }
  const controller = {
    reload: async () => ({ reloaded: true }),
    getState: () => ({ activeSessionId: 'session-1' }),
    start: async () => ({ started: true }),
    stop: async () => ({ stopped: true }),
  }
  const runtime = createPiRuntime({
    attachmentPreparer: (filePath) => ({ absolutePath: filePath, name: 'allegato' }),
    createPublicError: (code, message) => Object.assign(new Error(message), { code }),
    createSessionController: (options) => { sessionOptions = options; return controller },
    createStreamController: (options) => { streamOptions = options; return { stream: true } },
    deliverPiConfigData: (payload) => deliveries.push(['pi-config-data', payload]),
    deliverPiConfigExit: (payload) => deliveries.push(['pi-config-exit', payload]),
    deliverPiSessionsChanged: (payload) => deliveries.push(['pi-sessions', payload]),
    deliverTerminalExit: (payload) => deliveries.push(['terminal-exit', payload]),
    deliverTerminalOutput: (payload) => deliveries.push(['terminal-output', payload]),
    deliverTerminalStreamState: (payload) => deliveries.push(['terminal-stream-state', payload]),
    environmentForExecutable: () => ({}),
    getHomePath: () => '/home/test',
    getWindow: () => ({}),
    isProcessAlive: () => false,
    log: (...entry) => logs.push(entry),
    notifyWhenBackground() {},
    ptyRuntime: { spawn: (...args) => { spawned.push(args); return pty } },
    resolveExecutable: () => '/usr/local/bin/pi',
    resolveLaunchCandidates: async () => [],
    requireActiveWorkspace: () => '/workspace',
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    withCleanupDeadline: (promise) => promise,
  })
  return {
    controller,
    deliveries,
    emitData: (data) => onData?.(data),
    emitExit: (event) => onExit?.(event),
    getSessionOptions: () => sessionOptions,
    getStreamOptions: () => streamOptions,
    logs,
    runtime,
    spawned,
  }
}

test('Pi config viene riusato e inoltra data ed exit tipizzati', async () => {
  const fixtureValue = fixture()
  const first = fixtureValue.runtime.startConfig()
  const second = fixtureValue.runtime.startConfig()
  fixtureValue.emitData('config')
  fixtureValue.emitExit({ exitCode: 0, signal: null })
  await Promise.resolve()

  assert.deepEqual(first, { started: true, reused: false })
  assert.deepEqual(second, { started: false, reused: true })
  assert.deepEqual(fixtureValue.deliveries, [
    ['pi-config-data', 'config'],
    ['pi-config-exit', { exitCode: 0, signal: null }],
  ])
  assert.equal(fixtureValue.runtime.getConfigProcess(), undefined)
})

test('inoltra output, stato stream ed exit tramite porte semantiche senza alterare i payload', () => {
  const fixtureValue = fixture()
  const sessionOptions = fixtureValue.getSessionOptions()
  const stream = sessionOptions.createStream({ pty: {}, sessionId: 'session-1' })
  const streamOptions = fixtureValue.getStreamOptions()

  assert.deepEqual(stream, { stream: true })
  streamOptions.sendBlock({ sessionId: 'session-1', sequence: 7, data: 'output' })
  streamOptions.sendState({ sessionId: 'session-1', paused: true })
  sessionOptions.onChanged({ activeSessionId: 'session-1', sessions: [] })
  sessionOptions.onExit({
    exitCode: 2,
    signal: null,
    reason: 'exit',
    sessionId: 'session-1',
  })

  assert.deepEqual(fixtureValue.deliveries, [
    ['terminal-output', { sessionId: 'session-1', sequence: 7, data: 'output' }],
    ['terminal-stream-state', { sessionId: 'session-1', paused: true }],
    ['pi-sessions', { activeSessionId: 'session-1', sessions: [] }],
    ['terminal-exit', { exitCode: 2, signal: null, sessionId: 'session-1' }],
  ])
})

test('allegati annullati e stop config assente restano operazioni innocue', async () => {
  const { runtime } = fixture()
  assert.deepEqual(await runtime.chooseAttachments(), [])
  assert.deepEqual(await runtime.stopConfig(), { closed: false })
})

test('reload delega al controller e mantiene il contratto pubblico', async () => {
  const { runtime } = fixture()
  assert.deepEqual(await runtime.reload(), { reloaded: true })
})
