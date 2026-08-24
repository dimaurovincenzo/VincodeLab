const { AI_TERMINAL_INVOKE_CHANNELS, AI_TERMINAL_SEND_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

function terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport) {
  return createTerminalDiagnosticsReport({
    ...(piSessionController.getStream()?.getDiagnostics() ?? {}),
    paste: piSessionController.getInput()?.getDiagnostics(),
  })
}

function terminalResumeSnapshot(piSessionController) {
  const stream = piSessionController.getStream()
  if (!stream) throw new Error('La sessione del Terminale AI non è attiva.')
  const state = piSessionController.getState()
  return Object.freeze({
    ...stream.createResumeSnapshot(),
    runtime: state.runtime,
    piAvailable: state.piAvailable,
    ...(state.fallbackReason ? { fallbackReason: state.fallbackReason } : {}),
  })
}

function createAiTerminalInvokeHandlers({
  assertTrustedSender,
  chooseTerminalAttachments,
  createTerminalDiagnosticsReport,
  dialog,
  getMainWindow,
  maxPasteBytes,
  piSessionController,
  prepareTerminalAttachment,
  reloadPi,
  restartPi,
  startPiConfig,
  stopPiConfig,
  toApplicationError,
  writeFile,
}) {
  return new Map([
    [IPC_CHANNELS.PI_RELOAD, (event) => {
      assertTrustedSender(event)
      return reloadPi()
    }],
    [IPC_CHANNELS.PI_RESTART, (event, options) => {
      assertTrustedSender(event)
      if (options !== undefined && (
        !options
        || typeof options !== 'object'
        || Array.isArray(options)
        || Object.keys(options).some((key) => key !== 'runtime')
        || options.runtime !== 'pi'
      )) throw new Error('Opzioni riavvio Terminale AI non valide.')
      return restartPi(options)
    }],
    [IPC_CHANNELS.TERMINAL_RESUME, (event) => {
      assertTrustedSender(event)
      return terminalResumeSnapshot(piSessionController)
    }],
    [IPC_CHANNELS.TERMINAL_WRITE_INPUT, (event, data) => {
      assertTrustedSender(event)
      const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : 0
      if (typeof data !== 'string' || bytes === 0 || bytes > 65_536) {
        throw toApplicationError(new Error('Input programmatico non valido.'), {
          category: 'validation',
          channel: IPC_CHANNELS.TERMINAL_WRITE_INPUT,
          code: 'TERMINAL_WRITE_INPUT_INVALID',
          domain: 'terminal',
          message: 'Il testo da inviare al Terminale AI non è valido.',
          operation: 'writeInput',
          recoverable: true,
          severity: 'warning',
        })
      }
      if (piSessionController.getState().runtime === 'herdr') {
        throw toApplicationError(new Error('Programmatic input disabled for shared Herdr session.'), {
          category: 'validation',
          channel: IPC_CHANNELS.TERMINAL_WRITE_INPUT,
          code: 'HERDR_PROGRAMMATIC_INPUT_DISABLED',
          domain: 'terminal',
          message: 'L’invio automatico è disattivato in Herdr. Seleziona il pane Pi desiderato e inserisci il contenuto direttamente.',
          operation: 'writeInput',
          recoverable: true,
          severity: 'info',
        })
      }
      if (!piSessionController.write(data)) {
        throw toApplicationError(new Error('Il processo del Terminale AI non ha accettato l’input programmatico.'), {
          channel: IPC_CHANNELS.TERMINAL_WRITE_INPUT,
          code: 'TERMINAL_WRITE_INPUT_FAILED',
          domain: 'terminal',
          message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
          operation: 'writeInput',
          recoverable: true,
        })
      }
      return { accepted: true, bytes }
    }],
    [IPC_CHANNELS.TERMINAL_PASTE_START, (event, input) => {
      assertTrustedSender(event)
      const inputController = piSessionController.getInput()
      if (!inputController) {
        return {
          accepted: false,
          reason: 'not-running',
          totalBytes: input?.totalBytes,
          limit: maxPasteBytes,
        }
      }
      return inputController.start(input)
    }],
    [IPC_CHANNELS.TERMINAL_PASTE_CHUNK, (event, input) => {
      assertTrustedSender(event)
      const inputController = piSessionController.getInput()
      if (!inputController) return { accepted: false, reason: 'not-running', sentBytes: 0, totalBytes: 0 }
      return inputController.chunk(input)
    }],
    [IPC_CHANNELS.TERMINAL_PASTE_CANCEL, (event, transferId) => {
      assertTrustedSender(event)
      return piSessionController.getInput()?.cancel(transferId)
        ?? { cancelled: false, sentBytes: 0, totalBytes: 0 }
    }],
    [IPC_CHANNELS.TERMINAL_DIAGNOSTICS, (event) => {
      assertTrustedSender(event)
      return terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport)
    }],
    [IPC_CHANNELS.TERMINAL_EXPORT_DIAGNOSTICS, async (event) => {
      assertTrustedSender(event)
      const report = terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport)
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Esporta diagnostica Terminale AI',
        buttonLabel: 'Esporta',
        defaultPath: `VincodeLab-terminale-ai-${report.generatedAt.slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return { exported: false }
      await writeFile(result.filePath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      return { exported: true, filePath: result.filePath }
    }],
    [IPC_CHANNELS.TERMINAL_CHOOSE_ATTACHMENTS, (event) => {
      assertTrustedSender(event)
      return chooseTerminalAttachments()
    }],
    [IPC_CHANNELS.TERMINAL_PREPARE_DROPPED_ATTACHMENTS, (event, filePaths) => {
      assertTrustedSender(event)
      if (!Array.isArray(filePaths) || filePaths.length > 20) throw new Error('Allegati non validi.')
      return filePaths.map(prepareTerminalAttachment)
    }],
    [IPC_CHANNELS.PI_CONFIG_START, (event) => {
      assertTrustedSender(event)
      return startPiConfig()
    }],
    [IPC_CHANNELS.PI_CONFIG_CLOSE, async (event) => {
      assertTrustedSender(event)
      await stopPiConfig()
      return { closed: true }
    }],
  ])
}

function createAiTerminalSendListeners({
  assertTrustedSender,
  confineIpcOneWay,
  getPiConfigProcess,
  piSessionController,
  rejectOneWay,
  sanitizeRendererMetrics,
}) {
  const listeners = new Map([
    [IPC_CHANNELS.TERMINAL_READY, (event, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (!stream || !stream.rendererReady(message)) {
        rejectOneWay('TERMINAL_READY_REJECTED', 'Il collegamento renderer non è stato accettato.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_ACK, (event, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (!stream || !stream.ack(message)) {
        rejectOneWay('TERMINAL_ACK_REJECTED', 'La conferma renderer non è stata accettata.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_KEY, (event, data) => {
      assertTrustedSender(event)
      if (!piSessionController.write(data)) {
        rejectOneWay('TERMINAL_INPUT_REJECTED', 'Il Terminale AI non ha accettato l’input.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_RENDERER_METRICS, (event, metrics) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (stream) stream.updateRendererMetrics(sanitizeRendererMetrics(metrics))
    }],
    [IPC_CHANNELS.PI_CONFIG_INPUT, (event, data) => {
      assertTrustedSender(event)
      if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data, 'utf8') > 65_536) {
        rejectOneWay('PI_CONFIG_INPUT_INVALID', 'Input configurazione non valido.')
      }
      const piConfigProcess = getPiConfigProcess()
      if (!piConfigProcess) rejectOneWay('PI_CONFIG_NOT_RUNNING', 'La configurazione di Pi non è attiva.')
      piConfigProcess.write(data)
    }],
    [IPC_CHANNELS.PI_CONFIG_RESIZE, (event, dimensions) => {
      assertTrustedSender(event)
      const cols = Number(dimensions?.cols)
      const rows = Number(dimensions?.rows)
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
        rejectOneWay('PI_CONFIG_RESIZE_INVALID', 'Dimensioni configurazione non valide.')
      }
      const piConfigProcess = getPiConfigProcess()
      if (!piConfigProcess) rejectOneWay('PI_CONFIG_NOT_RUNNING', 'La configurazione di Pi non è attiva.')
      piConfigProcess.resize(cols, rows)
    }],
    [IPC_CHANNELS.TERMINAL_RESIZE, (event, dimensions) => {
      assertTrustedSender(event)
      const cols = Number(dimensions?.cols)
      const rows = Number(dimensions?.rows)
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
        rejectOneWay('TERMINAL_RESIZE_INVALID', 'Dimensioni Terminale AI non valide.')
      }
      if (!piSessionController.resize(cols, rows)) {
        rejectOneWay('TERMINAL_RESIZE_REJECTED', 'Il Terminale AI non ha accettato il ridimensionamento.')
      }
    }],
  ])

  return new Map([...listeners].map(([channel, listener]) => [
    channel,
    confineIpcOneWay(channel, listener),
  ]))
}

function registerAiTerminalIpc({ ipcMain, ...dependencies }) {
  const invokeHandlers = createAiTerminalInvokeHandlers(dependencies)
  const sendListeners = createAiTerminalSendListeners(dependencies)
  for (const [channel, handler] of invokeHandlers) ipcMain.handle(channel, handler)
  for (const [channel, listener] of sendListeners) ipcMain.on(channel, listener)
  return Object.freeze({
    invokeChannels: AI_TERMINAL_INVOKE_CHANNELS,
    sendChannels: AI_TERMINAL_SEND_CHANNELS,
  })
}

module.exports = {
  AI_TERMINAL_INVOKE_CHANNELS,
  AI_TERMINAL_SEND_CHANNELS,
  createAiTerminalInvokeHandlers,
  createAiTerminalSendListeners,
  registerAiTerminalIpc,
  terminalResumeSnapshot,
}
