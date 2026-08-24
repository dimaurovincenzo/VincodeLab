const { IPC_CHANNELS } = require('../../ipc/channels.cjs')
const { createPiSessionController } = require('./pi-session-controller.cjs')
const { safeKillPty } = require('../terminal/pty-lifecycle.cjs')
const { createTerminalInputController } = require('../terminal/terminal-input.cjs')
const { createTerminalStreamController } = require('../terminal/terminal-stream-controller.cjs')

function createPiRuntime({
  attachmentPreparer,
  createPublicError,
  createInputController = createTerminalInputController,
  createSessionController = createPiSessionController,
  createStreamController = createTerminalStreamController,
  environmentForExecutable,
  getHomePath,
  getWindow,
  isProcessAlive,
  log,
  notifyWhenBackground,
  ptyRuntime,
  resolveExecutable,
  resolveLaunchCandidates,
  requireActiveWorkspace,
  sendToRenderer,
  showOpenDialog,
  withCleanupDeadline,
}) {
  if (typeof environmentForExecutable !== 'function') throw new Error('Provider ambiente runtime Pi non valido.')
  if (typeof isProcessAlive !== 'function') throw new Error('Verifica processo runtime Pi non valida.')
  if (typeof resolveExecutable !== 'function') throw new Error('Resolver eseguibile runtime Pi non valido.')
  if (typeof resolveLaunchCandidates !== 'function') throw new Error('Resolver lancio Terminale AI non valido.')
  if (typeof attachmentPreparer !== 'function') throw new Error('Porta allegati Terminale AI non valida.')
  let configProcess
  let configExit

  function handleSessionExit({ exitCode, signal, reason, runtime, piAvailable, sessionId }) {
    const expected = reason !== 'exit' && reason !== 'failure'
    log(expected || (exitCode === 0 && !signal) ? 'info' : 'error', expected ? 'ai_terminal_stopped' : 'ai_terminal_exited', {
      exitCode,
      signal,
      reason,
      runtime,
      sessionId,
    })
    // Stop, restart, cambio workspace e shutdown sono già osservabili dalla
    // rispettiva operazione; soltanto gli exit inattesi cambiano lo stato UI.
    if (expected) return
    sendToRenderer(IPC_CHANNELS.TERMINAL_EXIT, { exitCode, signal, runtime, piAvailable })
    if (exitCode !== 0 || signal) {
      const label = runtime === 'herdr' ? 'Herdr' : 'Pi'
      notifyWhenBackground(
        `VincodeLab · ${label}`,
        signal ? `${label} è stato interrotto (segnale ${signal}).` : `${label} si è chiuso con codice ${exitCode}.`,
      )
    }
  }

  const controller = createSessionController({
    resolveLaunchCandidates,
    isProcessAlive,
    processFactory: (executable, args, options) => ptyRuntime.spawn(executable, args, options),
    createStream: ({ pty: ptyProcess, sessionId }) => createStreamController({
      pty: ptyProcess,
      sessionId,
      sendBlock: (block) => sendToRenderer(IPC_CHANNELS.TERMINAL_OUTPUT, block),
      sendState: (state) => sendToRenderer(IPC_CHANNELS.TERMINAL_STREAM_STATE, state),
    }),
    createInput: ({ stream, getPty }) => createInputController({
      getPty,
      waitForCapacity: (signal) => stream.waitForInputCapacity(signal),
    }),
    onStarted: ({ fallbackReason, pid, runtime, sessionId }) => log('info', 'ai_terminal_started', { fallbackReason, pid, runtime, sessionId }),
    onExit: handleSessionExit,
    onError: ({ source }) => log('error', 'ai_terminal_session_failure', { reason: source }),
  })

  function start(workspacePath) {
    return controller.start(workspacePath)
  }

  function stop(reason = 'stop') {
    return controller.stop(reason)
  }

  async function reload() {
    const result = await controller.reload()
    log('info', result.reloaded ? 'ai_terminal_reload_sent' : 'ai_terminal_reload_skipped', { reason: result.reason, runtime: result.runtime })
    return result
  }

  async function restart(options) {
    const result = await controller.start(requireActiveWorkspace(), options)
    return {
      restarted: true,
      runtime: result.runtime,
      piAvailable: result.piAvailable,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    }
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
    ptyProcess.onData((data) => sendToRenderer(IPC_CHANNELS.PI_CONFIG_DATA, data))
    ptyProcess.onExit(({ exitCode, signal }) => {
      resolveExit()
      if (configProcess !== ptyProcess) return
      configProcess = undefined
      configExit = undefined
      sendToRenderer(IPC_CHANNELS.PI_CONFIG_EXIT, { exitCode, signal })
    })
    return { started: true, reused: false }
  }

  async function stopConfig() {
    const ptyProcess = configProcess
    if (!ptyProcess) return { closed: false }
    const exit = configExit?.process === ptyProcess ? configExit.promise : Promise.resolve()
    safeKillPty(ptyProcess)
    try {
      await withCleanupDeadline(exit, 1_500, 'pi-config-term')
    } catch {
      try {
        ptyProcess.kill('SIGKILL')
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
