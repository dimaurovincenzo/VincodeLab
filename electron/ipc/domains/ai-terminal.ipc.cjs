const AI_TERMINAL_INVOKE_CHANNELS = Object.freeze([
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

const AI_TERMINAL_SEND_CHANNELS = Object.freeze([
  'terminal:ready',
  'terminal:ack',
  'terminal:key',
  'terminal:rendererMetrics',
  'piConfig:input',
  'piConfig:resize',
  'terminal:resize',
])

function terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport) {
  return createTerminalDiagnosticsReport({
    ...(piSessionController.getStream()?.getDiagnostics() ?? {}),
    paste: piSessionController.getInput()?.getDiagnostics(),
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
    ['pi:reload', (event) => {
      assertTrustedSender(event)
      return reloadPi()
    }],
    ['pi:restart', (event) => {
      assertTrustedSender(event)
      return restartPi()
    }],
    ['terminal:resume', (event) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (!stream) throw new Error('La sessione Pi non è attiva.')
      return stream.createResumeSnapshot()
    }],
    ['terminal:writeInput', (event, data) => {
      assertTrustedSender(event)
      const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : 0
      if (typeof data !== 'string' || bytes === 0 || bytes > 65_536) {
        throw toApplicationError(new Error('Input programmatico non valido.'), {
          category: 'validation',
          channel: 'terminal:writeInput',
          code: 'TERMINAL_WRITE_INPUT_INVALID',
          domain: 'terminal',
          message: 'Il testo da inviare al Terminale AI non è valido.',
          operation: 'writeInput',
          recoverable: true,
          severity: 'warning',
        })
      }
      if (!piSessionController.write(data)) {
        throw toApplicationError(new Error('Il processo Pi non ha accettato l’input programmatico.'), {
          channel: 'terminal:writeInput',
          code: 'TERMINAL_WRITE_INPUT_FAILED',
          domain: 'terminal',
          message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
          operation: 'writeInput',
          recoverable: true,
        })
      }
      return { accepted: true, bytes }
    }],
    ['terminal:pasteStart', (event, input) => {
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
    ['terminal:pasteChunk', (event, input) => {
      assertTrustedSender(event)
      const inputController = piSessionController.getInput()
      if (!inputController) return { accepted: false, reason: 'not-running', sentBytes: 0, totalBytes: 0 }
      return inputController.chunk(input)
    }],
    ['terminal:pasteCancel', (event, transferId) => {
      assertTrustedSender(event)
      return piSessionController.getInput()?.cancel(transferId)
        ?? { cancelled: false, sentBytes: 0, totalBytes: 0 }
    }],
    ['terminal:diagnostics', (event) => {
      assertTrustedSender(event)
      return terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport)
    }],
    ['terminal:exportDiagnostics', async (event) => {
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
    ['terminal:chooseAttachments', (event) => {
      assertTrustedSender(event)
      return chooseTerminalAttachments()
    }],
    ['terminal:prepareDroppedAttachments', (event, filePaths) => {
      assertTrustedSender(event)
      if (!Array.isArray(filePaths) || filePaths.length > 20) throw new Error('Allegati non validi.')
      return filePaths.map(prepareTerminalAttachment)
    }],
    ['piConfig:start', (event) => {
      assertTrustedSender(event)
      return startPiConfig()
    }],
    ['piConfig:close', async (event) => {
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
    ['terminal:ready', (event, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (!stream || !stream.rendererReady(message)) {
        rejectOneWay('TERMINAL_READY_REJECTED', 'Il collegamento renderer non è stato accettato.')
      }
    }],
    ['terminal:ack', (event, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (!stream || !stream.ack(message)) {
        rejectOneWay('TERMINAL_ACK_REJECTED', 'La conferma renderer non è stata accettata.')
      }
    }],
    ['terminal:key', (event, data) => {
      assertTrustedSender(event)
      if (!piSessionController.write(data)) {
        rejectOneWay('TERMINAL_INPUT_REJECTED', 'Il processo Pi non ha accettato l’input.')
      }
    }],
    ['terminal:rendererMetrics', (event, metrics) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream()
      if (stream) stream.updateRendererMetrics(sanitizeRendererMetrics(metrics))
    }],
    ['piConfig:input', (event, data) => {
      assertTrustedSender(event)
      if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data, 'utf8') > 65_536) {
        rejectOneWay('PI_CONFIG_INPUT_INVALID', 'Input configurazione non valido.')
      }
      const piConfigProcess = getPiConfigProcess()
      if (!piConfigProcess) rejectOneWay('PI_CONFIG_NOT_RUNNING', 'La configurazione di Pi non è attiva.')
      piConfigProcess.write(data)
    }],
    ['piConfig:resize', (event, dimensions) => {
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
    ['terminal:resize', (event, dimensions) => {
      assertTrustedSender(event)
      const cols = Number(dimensions?.cols)
      const rows = Number(dimensions?.rows)
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
        rejectOneWay('TERMINAL_RESIZE_INVALID', 'Dimensioni Terminale AI non valide.')
      }
      if (!piSessionController.resize(cols, rows)) {
        rejectOneWay('TERMINAL_RESIZE_REJECTED', 'Il processo Pi non ha accettato il ridimensionamento.')
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
}
