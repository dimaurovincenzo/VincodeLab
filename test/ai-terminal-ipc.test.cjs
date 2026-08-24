const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AI_TERMINAL_INVOKE_CHANNELS,
  AI_TERMINAL_SEND_CHANNELS,
  createAiTerminalInvokeHandlers,
  createAiTerminalSendListeners,
  registerAiTerminalIpc,
} = require('../electron/ipc/domains/ai-terminal.ipc.cjs')

function oneWayError(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function dependencies(overrides = {}) {
  return {
    assertTrustedSender() {},
    chooseTerminalAttachments: () => [],
    confineIpcOneWay: (_channel, listener) => listener,
    createTerminalDiagnosticsReport: (diagnostics) => ({
      generatedAt: '2026-08-24T10:00:00.000Z',
      ...diagnostics,
    }),
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    getMainWindow: () => null,
    getPiConfigProcess: () => null,
    maxPasteBytes: 5 * 1024 * 1024,
    piSessionController: {
      getInput: () => null,
      getState: () => ({ runtime: 'pi', fallbackReason: null, piAvailable: true }),
      getStream: () => null,
      resize: () => true,
      write: () => true,
    },
    prepareTerminalAttachment: (filePath) => ({ filePath }),
    rejectOneWay: oneWayError,
    reloadPi: () => undefined,
    restartPi: () => undefined,
    sanitizeRendererMetrics: (metrics) => metrics,
    startPiConfig: () => undefined,
    stopPiConfig: async () => undefined,
    toApplicationError: (error) => error,
    writeFile: async () => undefined,
    ...overrides,
  }
}

test('i manifesti registrano 13 invoke e 7 send senza domini estranei', () => {
  const handles = new Map()
  const listeners = new Map()
  const confinement = []
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
  const registration = registerAiTerminalIpc({
    ipcMain,
    ...dependencies({
      confineIpcOneWay(channel, listener) {
        const confined = (...args) => listener(...args)
        confinement.push([channel, listener, confined])
        return confined
      },
    }),
  })

  assert.deepEqual(AI_TERMINAL_INVOKE_CHANNELS, [
    'pi:reload',
    'pi:restart',
    'terminal:resume',
    'terminal:writeInput',
    'terminal:pasteStart',
    'terminal:pasteChunk',
    'terminal:pasteCancel',
    'terminal:diagnostics',
    'terminal:exportDiagnostics',
    'terminal:chooseAttachments',
    'terminal:prepareDroppedAttachments',
    'piConfig:start',
    'piConfig:close',
  ])
  assert.deepEqual(AI_TERMINAL_SEND_CHANNELS, [
    'terminal:ready',
    'terminal:ack',
    'terminal:key',
    'terminal:rendererMetrics',
    'piConfig:input',
    'piConfig:resize',
    'terminal:resize',
  ])
  assert.deepEqual([...handles.keys()], AI_TERMINAL_INVOKE_CHANNELS)
  assert.deepEqual([...listeners.keys()], AI_TERMINAL_SEND_CHANNELS)
  assert.deepEqual(confinement.map(([channel]) => channel), AI_TERMINAL_SEND_CHANNELS)
  for (const [channel, _raw, confined] of confinement) assert.equal(listeners.get(channel), confined)
  assert.deepEqual(registration.invokeChannels, AI_TERMINAL_INVOKE_CHANNELS)
  assert.deepEqual(registration.sendChannels, AI_TERMINAL_SEND_CHANNELS)
  assert.equal(Object.isFrozen(AI_TERMINAL_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(AI_TERMINAL_SEND_CHANNELS), true)
  assert.equal(Object.isFrozen(registration), true)
  assert.equal([...handles.keys(), ...listeners.keys()].some((channel) => channel.startsWith('piSystem:')), false)
  assert.equal([...handles.keys(), ...listeners.keys()].some((channel) => channel.startsWith('shellSessions:')), false)
})

test('Pi lifecycle, resume e Pi Config invoke preservano guardie e return semantics', async () => {
  const calls = []
  const event = { sender: { id: 51 } }
  const snapshot = { generation: 4 }
  const reloadResult = { reloaded: true }
  const restartResult = { restarted: true }
  const startResult = { started: true, reused: false }
  const handlers = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    piSessionController: {
      getInput: () => null,
      getState: () => ({ runtime: 'herdr', fallbackReason: null, piAvailable: true }),
      getStream: () => ({ createResumeSnapshot: () => snapshot }),
      write: () => true,
    },
    reloadPi: () => { calls.push(['reload']); return reloadResult },
    restartPi: (options) => { calls.push(['restart', options]); return restartResult },
    startPiConfig: () => { calls.push(['config-start']); return startResult },
    stopPiConfig: async () => { calls.push(['config-stop']) },
  }))

  assert.equal(handlers.get('pi:reload')(event), reloadResult)
  assert.equal(handlers.get('pi:restart')(event), restartResult)
  assert.deepEqual(handlers.get('terminal:resume')(event), { generation: 4, runtime: 'herdr', piAvailable: true })
  assert.equal(handlers.get('piConfig:start')(event), startResult)
  assert.deepEqual(await handlers.get('piConfig:close')(event), { closed: true })
  assert.deepEqual(calls, [
    ['guard', event], ['reload'],
    ['guard', event], ['restart', undefined],
    ['guard', event],
    ['guard', event], ['config-start'],
    ['guard', event], ['config-stop'],
  ])

  const noSession = createAiTerminalInvokeHandlers(dependencies())
  assert.throws(
    () => noSession.get('terminal:resume')({}),
    /La sessione del Terminale AI non è attiva\./,
  )
  assert.throws(() => handlers.get('pi:restart')(event, { runtime: 'herdr' }), /Opzioni riavvio Terminale AI non valide/u)
  assert.throws(() => handlers.get('pi:restart')(event, {}), /Opzioni riavvio Terminale AI non valide/u)
  assert.equal(handlers.get('pi:restart')(event, { runtime: 'pi' }), restartResult)
})

test('writeInput conserva limiti byte e ApplicationError pubblico per entrambi i failure', () => {
  const calls = []
  let acceptsInput = true
  const event = { sender: { id: 53 } }
  const handlers = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    piSessionController: {
      getInput: () => null,
      getStream: () => null,
      getState: () => ({ runtime: 'pi' }),
      write(data) {
        calls.push(['write', data])
        return acceptsInput
      },
    },
    toApplicationError(cause, options) {
      const error = new Error(`public:${options.code}`)
      error.cause = cause
      error.options = options
      calls.push(['application-error', cause.message, options])
      return error
    },
  }))

  assert.deepEqual(handlers.get('terminal:writeInput')(event, 'è'), { accepted: true, bytes: 2 })

  let invalidError
  try {
    handlers.get('terminal:writeInput')(event, '')
  } catch (error) {
    invalidError = error
  }
  assert.equal(invalidError.message, 'public:TERMINAL_WRITE_INPUT_INVALID')
  assert.equal(invalidError.cause.message, 'Input programmatico non valido.')
  assert.deepEqual(invalidError.options, {
    category: 'validation',
    code: 'TERMINAL_WRITE_INPUT_INVALID',
    domain: 'terminal',
    message: 'Il testo da inviare al Terminale AI non è valido.',
    operation: 'writeInput',
    recoverable: true,
    severity: 'warning',
  })

  acceptsInput = false
  let rejectedError
  try {
    handlers.get('terminal:writeInput')(event, 'continua')
  } catch (error) {
    rejectedError = error
  }
  assert.equal(rejectedError.message, 'public:TERMINAL_WRITE_INPUT_FAILED')
  assert.equal(rejectedError.cause.message, 'Il processo del Terminale AI non ha accettato l’input programmatico.')
  assert.deepEqual(rejectedError.options, {
    code: 'TERMINAL_WRITE_INPUT_FAILED',
    domain: 'terminal',
    message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
    operation: 'writeInput',
    recoverable: true,
  })
  assert.throws(
    () => handlers.get('terminal:writeInput')(event, 'x'.repeat(65_537)),
    /TERMINAL_WRITE_INPUT_INVALID/,
  )

  const herdr = createAiTerminalInvokeHandlers(dependencies({
    piSessionController: {
      getInput: () => null,
      getState: () => ({ runtime: 'herdr' }),
      getStream: () => null,
      write: () => true,
    },
    toApplicationError(cause, options) {
      return Object.assign(new Error(options.message), { cause, options })
    },
  }))
  assert.throws(
    () => herdr.get('terminal:writeInput')(event, 'contesto'),
    (error) => error.options.code === 'HERDR_PROGRAMMATIC_INPUT_DISABLED'
      && error.options.severity === 'info',
  )
})

test('paste start chunk e cancel preservano controller, fallback e limite', () => {
  const calls = []
  const event = { sender: { id: 55 } }
  const startInput = { transferId: 'paste-1', totalBytes: 42 }
  const chunkInput = { transferId: 'paste-1', data: 'copy' }
  const controller = {
    start(input) { calls.push(['start', input]); return { accepted: true, totalBytes: 42 } },
    chunk(input) { calls.push(['chunk', input]); return { accepted: true, sentBytes: 4, totalBytes: 42 } },
    cancel(transferId) { calls.push(['cancel', transferId]); return { cancelled: true, sentBytes: 4, totalBytes: 42 } },
    getDiagnostics: () => undefined,
  }
  const handlers = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    piSessionController: {
      getInput: () => controller,
      getStream: () => null,
      write: () => true,
    },
  }))

  assert.deepEqual(handlers.get('terminal:pasteStart')(event, startInput), { accepted: true, totalBytes: 42 })
  assert.deepEqual(handlers.get('terminal:pasteChunk')(event, chunkInput), { accepted: true, sentBytes: 4, totalBytes: 42 })
  assert.deepEqual(handlers.get('terminal:pasteCancel')(event, 'paste-1'), { cancelled: true, sentBytes: 4, totalBytes: 42 })

  const unavailable = createAiTerminalInvokeHandlers(dependencies({ maxPasteBytes: 1234 }))
  assert.deepEqual(unavailable.get('terminal:pasteStart')(event, { totalBytes: 99 }), {
    accepted: false,
    reason: 'not-running',
    totalBytes: 99,
    limit: 1234,
  })
  assert.deepEqual(unavailable.get('terminal:pasteChunk')(event, chunkInput), {
    accepted: false,
    reason: 'not-running',
    sentBytes: 0,
    totalBytes: 0,
  })
  assert.deepEqual(unavailable.get('terminal:pasteCancel')(event, 'paste-1'), {
    cancelled: false,
    sentBytes: 0,
    totalBytes: 0,
  })
})

test('diagnostica ed export preservano snapshot, dialog, JSON e permessi file', async () => {
  const calls = []
  const event = { sender: { id: 57 } }
  const mainWindow = { id: 'main-window' }
  const report = {
    generatedAt: '2026-08-24T12:34:56.000Z',
    streamState: 'running',
    paste: { active: false },
  }
  const handlers = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    piSessionController: {
      getStream: () => ({ getDiagnostics: () => ({ streamState: 'running' }) }),
      getInput: () => ({ getDiagnostics: () => ({ active: false }) }),
      write: () => true,
    },
    createTerminalDiagnosticsReport: (diagnostics) => {
      calls.push(['report', diagnostics])
      return report
    },
    getMainWindow: () => mainWindow,
    dialog: {
      async showSaveDialog(owner, options) {
        calls.push(['dialog', owner, options])
        return { canceled: false, filePath: '/tmp/terminal-ai.json' }
      },
    },
    async writeFile(...args) { calls.push(['write-file', ...args]) },
  }))

  assert.equal(handlers.get('terminal:diagnostics')(event), report)
  assert.deepEqual(await handlers.get('terminal:exportDiagnostics')(event), {
    exported: true,
    filePath: '/tmp/terminal-ai.json',
  })
  assert.deepEqual(calls.filter(([kind]) => kind === 'report'), [
    ['report', { streamState: 'running', paste: { active: false } }],
    ['report', { streamState: 'running', paste: { active: false } }],
  ])
  assert.deepEqual(calls.find(([kind]) => kind === 'dialog'), ['dialog', mainWindow, {
    title: 'Esporta diagnostica Terminale AI',
    buttonLabel: 'Esporta',
    defaultPath: 'VincodeLab-terminale-ai-2026-08-24.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }])
  assert.deepEqual(calls.find(([kind]) => kind === 'write-file'), [
    'write-file',
    '/tmp/terminal-ai.json',
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  ])

  let writeCalled = false
  const canceled = createAiTerminalInvokeHandlers(dependencies({
    dialog: { showSaveDialog: async () => ({ canceled: true, filePath: '/tmp/ignored.json' }) },
    writeFile: async () => { writeCalled = true },
  }))
  assert.deepEqual(await canceled.get('terminal:exportDiagnostics')({}), { exported: false })
  assert.equal(writeCalled, false)
})

test('allegati scelti e dropped conservano validazione, ordine e risultati', () => {
  const calls = []
  const event = { sender: { id: 59 } }
  const chosen = [{ id: 'chosen' }]
  const handlers = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    chooseTerminalAttachments: () => chosen,
    prepareTerminalAttachment: (filePath) => {
      calls.push(['prepare', filePath])
      return { id: filePath }
    },
  }))

  assert.equal(handlers.get('terminal:chooseAttachments')(event), chosen)
  assert.deepEqual(handlers.get('terminal:prepareDroppedAttachments')(event, ['/a', '/b']), [
    { id: '/a' },
    { id: '/b' },
  ])
  assert.throws(
    () => handlers.get('terminal:prepareDroppedAttachments')(event, 'not-an-array'),
    /Allegati non validi\./,
  )
  assert.throws(
    () => handlers.get('terminal:prepareDroppedAttachments')(event, Array(21).fill('/file')),
    /Allegati non validi\./,
  )
  assert.deepEqual(calls.filter(([kind]) => kind === 'prepare'), [
    ['prepare', '/a'],
    ['prepare', '/b'],
  ])
})

test('ready ack key metrics e resize conservano protocollo e rejection codes', () => {
  const calls = []
  const event = { sender: { id: 61 } }
  let acceptsReady = true
  let acceptsAck = true
  let acceptsWrite = true
  let acceptsResize = true
  const stream = {
    rendererReady(message) { calls.push(['ready', message]); return acceptsReady },
    ack(message) { calls.push(['ack', message]); return acceptsAck },
    updateRendererMetrics(metrics) { calls.push(['metrics', metrics]) },
  }
  const listeners = createAiTerminalSendListeners(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    piSessionController: {
      getStream: () => stream,
      write(data) { calls.push(['key', data]); return acceptsWrite },
      resize(cols, rows) { calls.push(['resize', cols, rows]); return acceptsResize },
    },
    sanitizeRendererMetrics: (metrics) => {
      calls.push(['sanitize', metrics])
      return { sanitized: true }
    },
  }))

  listeners.get('terminal:ready')(event, { generation: 2 })
  listeners.get('terminal:ack')(event, { sequence: 8 })
  listeners.get('terminal:key')(event, 'a')
  listeners.get('terminal:rendererMetrics')(event, { bufferedBytes: 99 })
  listeners.get('terminal:resize')(event, { cols: '90', rows: '30' })
  assert.deepEqual(calls.filter(([kind]) => ['ready', 'ack', 'key', 'sanitize', 'metrics', 'resize'].includes(kind)), [
    ['ready', { generation: 2 }],
    ['ack', { sequence: 8 }],
    ['key', 'a'],
    ['sanitize', { bufferedBytes: 99 }],
    ['metrics', { sanitized: true }],
    ['resize', 90, 30],
  ])

  acceptsReady = false
  assert.throws(
    () => listeners.get('terminal:ready')(event, {}),
    (error) => error.code === 'TERMINAL_READY_REJECTED'
      && error.message === 'Il collegamento renderer non è stato accettato.',
  )
  acceptsAck = false
  assert.throws(
    () => listeners.get('terminal:ack')(event, {}),
    (error) => error.code === 'TERMINAL_ACK_REJECTED'
      && error.message === 'La conferma renderer non è stata accettata.',
  )
  acceptsWrite = false
  assert.throws(
    () => listeners.get('terminal:key')(event, 'x'),
    (error) => error.code === 'TERMINAL_INPUT_REJECTED'
      && error.message === 'Il Terminale AI non ha accettato l’input.',
  )
  acceptsResize = false
  assert.throws(
    () => listeners.get('terminal:resize')(event, { cols: 90, rows: 30 }),
    (error) => error.code === 'TERMINAL_RESIZE_REJECTED'
      && error.message === 'Il Terminale AI non ha accettato il ridimensionamento.',
  )
  assert.throws(
    () => listeners.get('terminal:resize')(event, { cols: 1, rows: 30 }),
    (error) => error.code === 'TERMINAL_RESIZE_INVALID'
      && error.message === 'Dimensioni Terminale AI non valide.',
  )

  let sanitizedWithoutStream = false
  const noStream = createAiTerminalSendListeners(dependencies({
    sanitizeRendererMetrics: () => { sanitizedWithoutStream = true },
  }))
  noStream.get('terminal:rendererMetrics')(event, {})
  assert.equal(sanitizedWithoutStream, false)
})

test('Pi Config one-way valida input e dimensioni prima di usare il processo corrente', () => {
  const calls = []
  const event = { sender: { id: 63 } }
  const process = {
    write(data) { calls.push(['write', data]) },
    resize(cols, rows) { calls.push(['resize', cols, rows]) },
  }
  const listeners = createAiTerminalSendListeners(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    getPiConfigProcess: () => process,
  }))

  listeners.get('piConfig:input')(event, 'configura')
  listeners.get('piConfig:resize')(event, { cols: '100', rows: '40' })
  assert.deepEqual(calls.filter(([kind]) => kind !== 'guard'), [
    ['write', 'configura'],
    ['resize', 100, 40],
  ])
  assert.throws(
    () => listeners.get('piConfig:input')(event, ''),
    (error) => error.code === 'PI_CONFIG_INPUT_INVALID'
      && error.message === 'Input configurazione non valido.',
  )
  assert.throws(
    () => listeners.get('piConfig:input')(event, 'x'.repeat(65_537)),
    (error) => error.code === 'PI_CONFIG_INPUT_INVALID',
  )
  assert.throws(
    () => listeners.get('piConfig:resize')(event, { cols: 501, rows: 40 }),
    (error) => error.code === 'PI_CONFIG_RESIZE_INVALID'
      && error.message === 'Dimensioni configurazione non valide.',
  )

  const stopped = createAiTerminalSendListeners(dependencies())
  assert.throws(
    () => stopped.get('piConfig:input')(event, 'configura'),
    (error) => error.code === 'PI_CONFIG_NOT_RUNNING'
      && error.message === 'La configurazione di Pi non è attiva.',
  )
  assert.throws(
    () => stopped.get('piConfig:resize')(event, { cols: 80, rows: 24 }),
    (error) => error.code === 'PI_CONFIG_NOT_RUNNING',
  )
})

test('guardie ed errori sync e async attraversano il registrar invariati', async () => {
  const guardError = new Error('untrusted sender')
  let reloadCalled = false
  const guarded = createAiTerminalInvokeHandlers(dependencies({
    assertTrustedSender() { throw guardError },
    reloadPi() { reloadCalled = true },
  }))
  assert.throws(() => guarded.get('pi:reload')({}), (error) => error === guardError)
  assert.equal(reloadCalled, false)

  const reloadError = new Error('reload failed')
  const syncFailure = createAiTerminalInvokeHandlers(dependencies({
    reloadPi() { throw reloadError },
  }))
  assert.throws(() => syncFailure.get('pi:reload')({}), (error) => error === reloadError)

  const stopError = new Error('close failed')
  const closeFailure = createAiTerminalInvokeHandlers(dependencies({
    stopPiConfig: async () => { throw stopError },
  }))
  await assert.rejects(closeFailure.get('piConfig:close')({}), (error) => error === stopError)

  const exportError = new Error('dialog failed')
  const exportFailure = createAiTerminalInvokeHandlers(dependencies({
    dialog: { showSaveDialog: async () => { throw exportError } },
  }))
  await assert.rejects(
    exportFailure.get('terminal:exportDiagnostics')({}),
    (error) => error === exportError,
  )

  let oneWayCalled = false
  const guardedSend = createAiTerminalSendListeners(dependencies({
    assertTrustedSender() { throw guardError },
    piSessionController: {
      getStream: () => null,
      write() { oneWayCalled = true },
      resize: () => true,
    },
  }))
  assert.throws(() => guardedSend.get('terminal:key')({}, 'a'), (error) => error === guardError)
  assert.equal(oneWayCalled, false)
})
