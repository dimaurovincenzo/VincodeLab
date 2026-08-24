const { AI_TERMINAL_INVOKE_CHANNELS, AI_TERMINAL_SEND_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

function terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport, sessionId) {
  return createTerminalDiagnosticsReport({
    ...(piSessionController.getStream(sessionId)?.getDiagnostics() ?? {}),
    paste: piSessionController.getInput(sessionId)?.getDiagnostics(),
  })
}

function terminalResumeSnapshot(piSessionController, sessionId) {
  const stream = piSessionController.getStream(sessionId)
  if (!stream) throw new Error('La sessione del Terminale AI non è attiva.')
  return Object.freeze(stream.createResumeSnapshot())
}

function createAiTerminalInvokeHandlers({
  assertTrustedSender,
  chooseTerminalAttachments,
  closePiSession,
  createPiSession,
  createTerminalDiagnosticsReport,
  dialog,
  focusPiSession,
  getMainWindow,
  listPiSessions,
  maxPasteBytes,
  piSessionController,
  prepareTerminalAttachment,
  reloadPi,
  renamePiSession,
  requireActiveWorkspace,
  restartPi,
  startPiConfig,
  stopPiConfig,
  toApplicationError,
  writeFile,
}) {
  return new Map([
    [IPC_CHANNELS.PI_SESSIONS_LIST, (event) => {
      assertTrustedSender(event)
      return listPiSessions()
    }],
    [IPC_CHANNELS.PI_SESSIONS_CREATE, (event) => {
      assertTrustedSender(event)
      return createPiSession()
    }],
    [IPC_CHANNELS.PI_SESSIONS_FOCUS, (event, sessionId) => {
      assertTrustedSender(event)
      return focusPiSession(sessionId)
    }],
    [IPC_CHANNELS.PI_SESSIONS_RENAME, (event, sessionId, title) => {
      assertTrustedSender(event)
      return renamePiSession(sessionId, title)
    }],
    [IPC_CHANNELS.PI_SESSIONS_CLOSE, (event, sessionId) => {
      assertTrustedSender(event)
      return closePiSession(sessionId)
    }],
    [IPC_CHANNELS.PI_RELOAD, (event, sessionId) => {
      assertTrustedSender(event)
      return reloadPi(sessionId)
    }],
    [IPC_CHANNELS.PI_RESTART, (event, sessionId) => {
      assertTrustedSender(event)
      return restartPi(sessionId)
    }],
    [IPC_CHANNELS.TERMINAL_RESUME, (event, sessionId) => {
      assertTrustedSender(event)
      return terminalResumeSnapshot(piSessionController, sessionId)
    }],
    [IPC_CHANNELS.TERMINAL_WRITE_INPUT, (event, sessionId, data) => {
      assertTrustedSender(event)
      const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : 0
      if (typeof data !== 'string' || bytes === 0 || bytes > 65_536) {
        throw toApplicationError(new Error('Input programmatico non valido.'), {
          category: 'validation',
          code: 'TERMINAL_WRITE_INPUT_INVALID',
          domain: 'terminal',
          message: 'Il testo da inviare al Terminale AI non è valido.',
          operation: 'writeInput',
          recoverable: true,
          severity: 'warning',
        })
      }
      if (!piSessionController.write(requireActiveWorkspace(), sessionId, data)) {
        throw toApplicationError(new Error('Il processo del Terminale AI non ha accettato l’input programmatico.'), {
          code: 'TERMINAL_WRITE_INPUT_FAILED',
          domain: 'terminal',
          message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
          operation: 'writeInput',
          recoverable: true,
        })
      }
      return { accepted: true, bytes }
    }],
    [IPC_CHANNELS.TERMINAL_PASTE_START, (event, sessionId, input) => {
      assertTrustedSender(event)
      const inputController = piSessionController.getInput(sessionId)
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
    [IPC_CHANNELS.TERMINAL_PASTE_CHUNK, (event, sessionId, input) => {
      assertTrustedSender(event)
      const inputController = piSessionController.getInput(sessionId)
      if (!inputController) return { accepted: false, reason: 'not-running', sentBytes: 0, totalBytes: 0 }
      return inputController.chunk(input)
    }],
    [IPC_CHANNELS.TERMINAL_PASTE_CANCEL, (event, sessionId, transferId) => {
      assertTrustedSender(event)
      return piSessionController.getInput(sessionId)?.cancel(transferId)
        ?? { cancelled: false, sentBytes: 0, totalBytes: 0 }
    }],
    [IPC_CHANNELS.TERMINAL_DIAGNOSTICS, (event, sessionId) => {
      assertTrustedSender(event)
      return terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport, sessionId)
    }],
    [IPC_CHANNELS.TERMINAL_EXPORT_DIAGNOSTICS, async (event, sessionId) => {
      assertTrustedSender(event)
      const report = terminalDiagnostics(piSessionController, createTerminalDiagnosticsReport, sessionId)
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
  requireActiveWorkspace,
  sanitizeRendererMetrics,
}) {
  const listeners = new Map([
    [IPC_CHANNELS.TERMINAL_READY, (event, sessionId, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream(sessionId)
      if (!stream || !stream.rendererReady(message)) {
        rejectOneWay('TERMINAL_READY_REJECTED', 'Il collegamento renderer non è stato accettato.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_ACK, (event, sessionId, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream(sessionId)
      if (!stream || !stream.ack(message)) {
        rejectOneWay('TERMINAL_ACK_REJECTED', 'La conferma renderer non è stata accettata.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_KEY, (event, sessionId, data) => {
      assertTrustedSender(event)
      if (!piSessionController.write(requireActiveWorkspace(), sessionId, data)) {
        rejectOneWay('TERMINAL_INPUT_REJECTED', 'Il Terminale AI non ha accettato l’input.')
      }
    }],
    [IPC_CHANNELS.TERMINAL_RENDERER_METRICS, (event, sessionId, metrics) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream(sessionId)
      if (stream) stream.updateRendererMetrics(sanitizeRendererMetrics(metrics))
    }],
    [IPC_CHANNELS.TERMINAL_DISCONNECT, (event, sessionId, message) => {
      assertTrustedSender(event)
      const stream = piSessionController.getStream(sessionId)
      if (stream) stream.disconnect(message)
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
    [IPC_CHANNELS.TERMINAL_RESIZE, (event, sessionId, dimensions) => {
      assertTrustedSender(event)
      const cols = Number(dimensions?.cols)
      const rows = Number(dimensions?.rows)
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
        rejectOneWay('TERMINAL_RESIZE_INVALID', 'Dimensioni Terminale AI non valide.')
      }
      if (!piSessionController.resize(requireActiveWorkspace(), sessionId, cols, rows)) {
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
