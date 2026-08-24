const path = require('node:path')
const { createPublicError, isPublicError } = require('../errors/public-error.cjs')
const { normalizeExitStatus } = require('./shell-session-model.cjs')

const DEFAULT_STOP_GRACE_MS = 750
const DEFAULT_FORCE_STOP_MS = 750

function createDeferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function shellLaunchFailure(error) {
  if (isPublicError(error)) return error
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return createPublicError(
    'SHELL_NOT_AVAILABLE',
    'Non è stata trovata una shell di sistema utilizzabile. Installa o ripristina zsh, bash o sh; le aree che non richiedono il Terminale restano disponibili.',
  )
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return createPublicError(
    'SHELL_NOT_EXECUTABLE',
    'La shell di sistema non può essere avviata. Verifica i permessi della shell e riprova; le altre aree restano disponibili.',
  )
  return error
}

function validateProcess(ptyProcess) {
  const methods = ['write', 'resize', 'kill', 'pause', 'resume', 'onData', 'onExit']
  if (!ptyProcess || typeof ptyProcess !== 'object' || methods.some((method) => typeof ptyProcess[method] !== 'function')) {
    throw new Error('Il processo terminale non è valido.')
  }
  return ptyProcess
}

function disposeSubscription(subscription) {
  try {
    subscription?.dispose?.()
  } catch {
    // La chiusura resta idempotente anche se una subscription nativa è già terminata.
  }
}

function safeKill(ptyProcess) {
  try {
    ptyProcess?.kill()
  } catch {
    // node-pty può aver già rilasciato il processo dopo un exit concorrente.
  }
}

function createShellProcessLifecycle(options = {}) {
  const stopGraceMs = options.stopGraceMs === undefined ? DEFAULT_STOP_GRACE_MS : options.stopGraceMs
  const forceStopMs = options.forceStopMs === undefined ? DEFAULT_FORCE_STOP_MS : options.forceStopMs
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 0 || stopGraceMs > 60_000 || !Number.isSafeInteger(forceStopMs) || forceStopMs < 0 || forceStopMs > 60_000) {
    throw new Error('Timeout arresto terminale non validi.')
  }
  if (typeof options.processFactory !== 'function') throw new Error('Factory processo terminale non valida.')
  if (typeof options.getExecutable !== 'function') throw new Error('Resolver eseguibile shell non valido.')
  if (typeof options.getEnvironment !== 'function') throw new Error('Provider ambiente shell non valido.')
  if (typeof options.isProcessAlive !== 'function') throw new Error('Verifica processo shell non valida.')

  const processFactory = options.processFactory
  const getExecutable = options.getExecutable
  const getEnvironment = options.getEnvironment
  const isProcessAlive = options.isProcessAlive
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const onData = options.onData ?? (() => undefined)
  const onExit = options.onExit ?? (() => undefined)
  const onProcessStopped = options.onProcessStopped ?? (() => undefined)

  function emitExit(payload) {
    try {
      onExit(Object.freeze(payload))
    } catch {
      // Gli eventi non possono compromettere il lifecycle del processo PTY.
    }
  }

  function disposeSubscriptions(session) {
    disposeSubscription(session.dataSubscription)
    disposeSubscription(session.exitSubscription)
    session.dataSubscription = null
    session.exitSubscription = null
  }

  function executableAndEnvironment() {
    const executable = getExecutable()
    if (typeof executable !== 'string' || !executable || executable.includes('\0') || !path.isAbsolute(executable)) {
      throw createPublicError(
        'SHELL_NOT_AVAILABLE',
        'Non è stata trovata una shell di sistema utilizzabile. Installa o ripristina zsh, bash o sh; le aree che non richiedono il Terminale restano disponibili.',
      )
    }
    const environment = getEnvironment()
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      throw new Error('Ambiente shell non valido.')
    }
    return { executable, environment: { ...environment, TERM: 'xterm-256color' } }
  }

  function handleData(session, ptyProcess, generation, data) {
    if (session.process !== ptyProcess || session.generation !== generation || session.status !== 'running') return
    if (typeof data !== 'string' || data.length === 0) return
    onData(session, generation, data)
  }

  function handleExit(session, ptyProcess, generation, event = {}) {
    if (session.process !== ptyProcess || session.generation !== generation) return
    const reason = session.stopReason
    disposeSubscriptions(session)
    session.process = null
    onProcessStopped(session)
    session.status = 'exited'
    session.exitStatus = normalizeExitStatus(event)
    session.processExit?.resolve(session.exitStatus)
    session.processExit = null
    session.stopReason = null
    if (reason !== 'restart') {
      emitExit({
        workspacePath: session.workspacePath,
        sessionId: session.sessionId,
        exitCode: session.exitStatus.exitCode,
        signal: session.exitStatus.signal,
        reason: reason === 'closed' ? 'closed' : 'exit',
      })
    }
  }

  function waitForExit(session, ptyProcess, generation, timeoutMs) {
    if (session.process !== ptyProcess || session.generation !== generation) return Promise.resolve(true)
    const exit = session.processExit
    if (!exit) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (exited) => {
        if (settled) return
        settled = true
        clearTimer(timer)
        resolve(exited)
      }
      const timer = setTimer(() => finish(false), timeoutMs)
      exit.promise.then(() => finish(true))
    })
  }

  function tryKill(ptyProcess, signal) {
    try {
      ptyProcess.kill(signal)
      return true
    } catch {
      return false
    }
  }

  function synthesizeExitIfGone(session, ptyProcess, generation, signal) {
    let alive = null
    try {
      alive = isProcessAlive(ptyProcess.pid)
    } catch {
      // Se la liveness non è determinabile serve comunque la conferma onExit.
    }
    if (alive !== false) return false
    handleExit(session, ptyProcess, generation, { exitCode: null, signal })
    return true
  }

  async function terminate(session, reason) {
    const ptyProcess = session.process
    const generation = session.generation
    if (!ptyProcess) return session.exitStatus
    session.stopReason = reason

    const gracefulRequested = tryKill(ptyProcess)
    if (!gracefulRequested && synthesizeExitIfGone(session, ptyProcess, generation, null)) return session.exitStatus
    if (await waitForExit(session, ptyProcess, generation, stopGraceMs)) return session.exitStatus

    const forceRequested = tryKill(ptyProcess, 'SIGKILL')
    if (!forceRequested && synthesizeExitIfGone(session, ptyProcess, generation, 9)) return session.exitStatus
    if (await waitForExit(session, ptyProcess, generation, forceStopMs)) return session.exitStatus
    if (synthesizeExitIfGone(session, ptyProcess, generation, 9)) return session.exitStatus

    session.stopReason = null
    const error = new Error('La shell non ha confermato l’arresto; l’operazione è stata bloccata per evitare processi orfani.')
    error.code = 'SHELL_STOP_FAILED'
    throw error
  }

  function prepare(session) {
    const { executable, environment } = executableAndEnvironment()
    let ptyProcess
    try {
      ptyProcess = processFactory(executable, ['-l'], {
        name: 'xterm-256color',
        cols: session.cols,
        rows: session.rows,
        cwd: session.workspacePath,
        env: environment,
      })
      validateProcess(ptyProcess)
    } catch (error) {
      // Una factory difettosa può aver già avviato il child prima di restituire
      // un handle incompleto: richiediamo comunque l'arresto prima di scartarlo.
      safeKill(ptyProcess)
      throw shellLaunchFailure(error)
    }
    const generation = session.generation + 1
    const pendingEvents = []
    let activated = false
    let dataSubscription = null
    let exitSubscription = null

    try {
      dataSubscription = ptyProcess.onData((data) => {
        if (!activated) pendingEvents.push({ type: 'data', data })
        else handleData(session, ptyProcess, generation, data)
      })
      exitSubscription = ptyProcess.onExit((event = {}) => {
        if (!activated) pendingEvents.push({ type: 'exit', event })
        else handleExit(session, ptyProcess, generation, event)
      })
    } catch (error) {
      disposeSubscription(dataSubscription)
      disposeSubscription(exitSubscription)
      safeKill(ptyProcess)
      throw error
    }

    return {
      ptyProcess,
      activate() {
        session.generation = generation
        session.process = ptyProcess
        session.processExit = createDeferred()
        session.stopReason = null
        session.dataSubscription = dataSubscription
        session.exitSubscription = exitSubscription
        session.status = 'running'
        session.exitStatus = null
        activated = true
        for (const pending of pendingEvents) {
          if (pending.type === 'data') handleData(session, ptyProcess, generation, pending.data)
          else handleExit(session, ptyProcess, generation, pending.event)
        }
        pendingEvents.length = 0
      },
    }
  }

  function spawn(session) {
    const prepared = prepare(session)
    prepared.activate()
    return prepared.ptyProcess
  }

  return Object.freeze({ disposeSubscriptions, spawn, terminate })
}

module.exports = {
  DEFAULT_FORCE_STOP_MS,
  DEFAULT_STOP_GRACE_MS,
  createShellProcessLifecycle,
}
