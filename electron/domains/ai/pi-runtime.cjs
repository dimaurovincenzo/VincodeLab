const { createPiSessionController } = require('./pi-session-controller.cjs')
const { environmentForPi, resolvePiExecutable } = require('./pi-executable.cjs')
const { safeKillPty } = require('../terminal/pty-lifecycle.cjs')
const { prepareTerminalAttachment } = require('./terminal-attachments.cjs')
const { createTerminalInputController } = require('../terminal/terminal-input.cjs')
const { createTerminalStreamController } = require('../terminal/terminal-stream-controller.cjs')

function createPiRuntime({
  attachmentPreparer = prepareTerminalAttachment,
  createPublicError,
  createInputController = createTerminalInputController,
  createSessionController = createPiSessionController,
  createStreamController = createTerminalStreamController,
  environmentForExecutable = environmentForPi,
  getHomePath,
  getWindow,
  log,
  notifyWhenBackground,
  ptyRuntime,
  resolveExecutable = resolvePiExecutable,
  requireActiveWorkspace,
  sendToRenderer,
  showOpenDialog,
  withCleanupDeadline,
}) {
  let configProcess
  let configExit

  function handleSessionExit({ exitCode, signal, reason, sessionId }) {
    const expected = reason !== 'exit' && reason !== 'failure'
    log(expected || (exitCode === 0 && !signal) ? 'info' : 'error', expected ? 'pi_stopped' : 'pi_exited', {
      exitCode,
      signal,
      reason,
      sessionId,
    })
    // Stop, restart, cambio workspace e shutdown sono già osservabili dalla
    // rispettiva operazione; soltanto gli exit inattesi cambiano lo stato UI.
    if (expected) return
    sendToRenderer('terminal:exit', { exitCode, signal })
    if (exitCode !== 0 || signal) {
      notifyWhenBackground(
        'VincodeLab · Pi',
        signal ? `La sessione Pi è stata interrotta (segnale ${signal}).` : `Pi si è chiuso con codice ${exitCode}.`,
      )
    }
  }

  const controller = createSessionController({
    resolveExecutable,
    environmentForExecutable,
    processFactory: (executable, args, options) => ptyRuntime.spawn(executable, args, options),
    createStream: ({ pty: ptyProcess, sessionId }) => createStreamController({
      pty: ptyProcess,
      sessionId,
      sendBlock: (block) => sendToRenderer('terminal:output', block),
      sendState: (state) => sendToRenderer('terminal:streamState', state),
    }),
    createInput: ({ stream, getPty }) => createInputController({
      getPty,
      waitForCapacity: (signal) => stream.waitForInputCapacity(signal),
    }),
    onStarted: ({ pid, sessionId }) => log('info', 'pi_started', { pid, sessionId }),
    onExit: handleSessionExit,
    onError: ({ source }) => log('error', 'pi_session_failure', { reason: source }),
  })

  function start(workspacePath) {
    return controller.start(workspacePath)
  }

  function stop(reason = 'stop') {
    return controller.stop(reason)
  }

  async function reload() {
    await controller.reload()
    log('info', 'pi_resources_reloaded')
    return { reloaded: true }
  }

  async function restart() {
    await start(requireActiveWorkspace())
    return { restarted: true }
  }

  async function chooseAttachments() {
    const result = await showOpenDialog(getWindow(), {
      title: 'Allega file a Pi',
      buttonLabel: 'Allega',
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths.map(attachmentPreparer)
  }

  function startConfig() {
    if (configProcess) return { started: false, reused: true }
    const executable = resolveExecutable()
    if (!executable) {
      throw createPublicError(
        'PI_NOT_INSTALLED',
        'Pi Coding Agent non è installato o non è rilevabile. Installa Pi, quindi aggiorna la verifica nelle Impostazioni. Le altre funzioni restano disponibili.',
      )
    }
    const ptyProcess = ptyRuntime.spawn(executable, ['config'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 34,
      cwd: getHomePath(),
      env: { ...environmentForExecutable(executable), TERM: 'xterm-256color' },
    })
    let resolveExit
    const exitPromise = new Promise((resolve) => { resolveExit = resolve })
    configProcess = ptyProcess
    configExit = { process: ptyProcess, promise: exitPromise }
    ptyProcess.onData((data) => sendToRenderer('piConfig:data', data))
    ptyProcess.onExit(({ exitCode, signal }) => {
      resolveExit()
      if (configProcess !== ptyProcess) return
      configProcess = undefined
      configExit = undefined
      sendToRenderer('piConfig:exit', { exitCode, signal })
    })
    return { started: true, reused: false }
  }

  async function stopConfig() {
    const process = configProcess
    if (!process) return { closed: false }
    const exit = configExit?.process === process ? configExit.promise : Promise.resolve()
    safeKillPty(process)
    try {
      await withCleanupDeadline(exit, 1_500, 'pi-config-term')
    } catch {
      try {
        process.kill('SIGKILL')
      } catch {
        // Il processo può essere già terminato; il secondo bounded wait resta
        // autorevole e propaga l'eventuale timeout di cleanup.
      }
      await withCleanupDeadline(exit, 1_000, 'pi-config-kill')
    }
    return { closed: true }
  }

  return Object.freeze({
    chooseAttachments,
    controller,
    getConfigProcess: () => configProcess,
    reload,
    restart,
    start,
    startConfig,
    stop,
    stopConfig,
  })
}

module.exports = { createPiRuntime }
