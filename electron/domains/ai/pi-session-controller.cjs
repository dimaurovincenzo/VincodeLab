const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const DEFAULT_STOP_GRACE_MS = 750
const DEFAULT_FORCE_STOP_MS = 750
const MAX_KEY_BYTES = 64 * 1024

const PI_NOT_INSTALLED = Object.freeze({
  code: 'PI_NOT_INSTALLED',
  message: 'Pi Coding Agent non è installato. Installalo oppure configura il percorso dell’eseguibile.',
})
const PI_NOT_RUNNABLE = Object.freeze({
  code: 'PI_NOT_RUNNABLE',
  message: 'Pi Coding Agent è presente ma non può essere avviato. Verifica installazione e permessi, quindi riprova.',
})

function publicPiFailure(definition, cause) {
  if (isPublicError(cause)) return cause
  const error = createPublicError(definition.code, definition.message)
  if (cause) {
    try {
      Object.defineProperty(error, 'cause', { value: cause })
    } catch {
      // Il messaggio pubblico resta valido anche se non è possibile conservare la cause.
    }
  }
  return error
}

function createDeferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function disposeSubscription(subscription) {
  try {
    subscription?.dispose?.()
  } catch {
    // Una subscription node-pty può essere già stata liberata dall'exit nativo.
  }
}

function disposeResource(resource) {
  try {
    resource?.dispose?.()
  } catch {
    // Il cleanup deve restare idempotente anche dopo un errore del PTY.
  }
}

function validatePtyProcess(ptyProcess) {
  const methods = ['kill', 'onData', 'onExit', 'pause', 'resume', 'resize', 'write']
  if (!ptyProcess || typeof ptyProcess !== 'object' || methods.some((method) => typeof ptyProcess[method] !== 'function')) {
    throw new Error('Pi ha restituito un processo terminale non valido.')
  }
  return ptyProcess
}

function normalizeExitStatus(event = {}) {
  return Object.freeze({
    exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
    signal: Number.isInteger(event.signal) || typeof event.signal === 'string' ? event.signal : null,
  })
}

function createPiSessionController(options = {}) {
  if (typeof options.resolveExecutable !== 'function') throw new Error('Resolver eseguibile Pi non valido.')
  if (typeof options.environmentForExecutable !== 'function') throw new Error('Provider ambiente Pi non valido.')
  if (typeof options.processFactory !== 'function') throw new Error('Factory processo Pi non valida.')
  if (typeof options.createStream !== 'function') throw new Error('Factory stream Pi non valida.')
  if (typeof options.createInput !== 'function') throw new Error('Factory input Pi non valida.')
  if (typeof options.isProcessAlive !== 'function') throw new Error('Verifica processo Pi non valida.')

  const resolveExecutable = options.resolveExecutable
  const environmentForExecutable = options.environmentForExecutable
  const processFactory = options.processFactory
  const createStream = options.createStream
  const createInput = options.createInput
  const createId = options.createId ?? (() => require('node:crypto').randomUUID())
  const onStarted = options.onStarted ?? (() => undefined)
  const onExit = options.onExit ?? (() => undefined)
  const onError = options.onError ?? (() => undefined)
  const isProcessAlive = options.isProcessAlive
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const scheduleStartCheck = options.scheduleStartCheck ?? setImmediate
  const stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS
  const forceStopMs = options.forceStopMs ?? DEFAULT_FORCE_STOP_MS
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 0 || !Number.isSafeInteger(forceStopMs) || forceStopMs < 0) {
    throw new Error('Timeout arresto Pi non validi.')
  }

  let currentSession = null
  let operationTail = Promise.resolve()

  function emit(listener, payload) {
    try {
      listener(Object.freeze(payload))
    } catch {
      // Telemetria e notifiche non possono compromettere il lifecycle del PTY.
    }
  }

  function enqueue(operation) {
    const result = operationTail.then(operation, operation)
    operationTail = result.catch(() => {
      // `result` propaga il failure all'owner UI; la coda interna deve restare
      // utilizzabile per un restart successivo.
    })
    return result
  }

  function waitForExit(session, timeoutMs) {
    if (session.finalized) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (exited) => {
        if (settled) return
        settled = true
        clearTimer(timer)
        resolve(exited)
      }
      const timer = setTimer(() => finish(false), timeoutMs)
      session.exit.promise.then(() => finish(true))
    })
  }

  function disposeProcessSubscriptions(session) {
    disposeSubscription(session.dataSubscription)
    disposeSubscription(session.exitSubscription)
    session.dataSubscription = null
    session.exitSubscription = null
  }

  function finishSession(session, event = {}, explicitReason) {
    if (session.finalized) return false
    session.finalized = true
    session.exitStatus = normalizeExitStatus(event)
    const reason = explicitReason ?? session.stopReason ?? 'exit'
    disposeProcessSubscriptions(session)
    disposeResource(session.input)
    session.input = null
    try {
      session.stream?.end(session.exitStatus)
    } catch (error) {
      emit(onError, { source: 'stream-end', error, workspacePath: session.workspacePath })
    }
    session.exit.resolve(session.exitStatus)
    emit(onExit, {
      workspacePath: session.workspacePath,
      sessionId: session.sessionId,
      exitCode: session.exitStatus.exitCode,
      signal: session.exitStatus.signal,
      reason,
    })
    return true
  }

  function discardSession(session) {
    disposeProcessSubscriptions(session)
    disposeResource(session.input)
    disposeResource(session.stream)
    session.input = null
    session.stream = null
    if (currentSession === session) currentSession = null
  }

  function tryKill(session, signal) {
    try {
      session.pty.kill(signal)
      return true
    } catch (error) {
      emit(onError, {
        source: signal ? 'force-stop' : 'stop',
        error,
        workspacePath: session.workspacePath,
      })
      return false
    }
  }

  function synthesizeExitIfGone(session, reason) {
    let alive = null
    try {
      alive = isProcessAlive(session.pty.pid)
    } catch (error) {
      emit(onError, { source: 'liveness-check', error, workspacePath: session.workspacePath })
    }
    if (alive !== false) return false
    finishSession(session, { exitCode: null, signal: reason === 'force-stop' ? 9 : null })
    return true
  }

  async function terminateSession(session, reason) {
    if (session.finalized) return session.exitStatus
    session.stopReason = reason

    const gracefulRequested = tryKill(session)
    if (!gracefulRequested && synthesizeExitIfGone(session, 'stop')) return session.exitStatus
    if (await waitForExit(session, stopGraceMs)) return session.exitStatus

    const forceRequested = tryKill(session, 'SIGKILL')
    if (!forceRequested && synthesizeExitIfGone(session, 'force-stop')) return session.exitStatus
    if (await waitForExit(session, forceStopMs)) return session.exitStatus
    if (synthesizeExitIfGone(session, 'force-stop')) return session.exitStatus

    session.stopReason = null
    const error = new Error('Il processo Pi non ha confermato l’arresto; il nuovo avvio è stato bloccato per evitare una sessione duplicata.')
    error.code = 'PI_STOP_FAILED'
    throw error
  }

  async function stopCurrent(reason) {
    const session = currentSession
    if (!session) return Object.freeze({ stopped: false })
    await terminateSession(session, reason)
    discardSession(session)
    return Object.freeze({ stopped: true })
  }

  function scheduleRecovery(session, source, error) {
    emit(onError, { source, error, workspacePath: session.workspacePath })
    if (session.recoveryScheduled || session.finalized) return
    session.recoveryScheduled = true
    void enqueue(async () => {
      if (currentSession !== session || session.finalized) return
      try {
        await terminateSession(session, 'failure')
        discardSession(session)
      } catch (stopError) {
        session.recoveryScheduled = false
        emit(onError, { source: 'recovery-stop', error: stopError, workspacePath: session.workspacePath })
      }
    })
  }

  async function cleanSpawnFailure(ptyProcess, subscriptions, workspacePath, originalError) {
    subscriptions.forEach(disposeSubscription)
    const exit = createDeferred()
    let exitSubscription
    try {
      exitSubscription = ptyProcess.onExit(() => exit.resolve())
    } catch {
      // La verifica del PID resta disponibile anche se il binding non accetta listener.
    }

    const temporarySession = {
      pty: ptyProcess,
      workspacePath,
      finalized: false,
      exitStatus: null,
      stopReason: 'start-failed',
      exit,
      dataSubscription: null,
      exitSubscription,
      input: null,
      stream: null,
    }
    try {
      await terminateSession(temporarySession, 'start-failed')
    } catch (cleanupError) {
      emit(onError, { source: 'start-cleanup', error: cleanupError, workspacePath })
      const error = new Error('Pi non è stato inizializzato e il processo avviato non ha confermato l’arresto.')
      error.code = 'PI_START_CLEANUP_FAILED'
      error.cause = originalError
      throw error
    } finally {
      disposeSubscription(exitSubscription)
    }
  }

  async function startOperation(workspacePath) {
    if (typeof workspacePath !== 'string' || workspacePath.length === 0 || workspacePath.length > 4_096 || workspacePath.includes('\0')) {
      throw new Error('Percorso workspace non valido per Pi.')
    }

    let executable
    try {
      executable = resolveExecutable()
    } catch (error) {
      emit(onError, { source: 'resolve-executable', error, workspacePath })
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (typeof executable !== 'string' || executable.length === 0) {
      throw publicPiFailure(PI_NOT_INSTALLED)
    }
    let environment
    try {
      environment = environmentForExecutable(executable)
    } catch (error) {
      emit(onError, { source: 'environment', error, workspacePath })
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Ambiente di esecuzione Pi non valido.'))
    }
    const sessionId = createId()
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
      throw new Error('ID sessione Pi non valido.')
    }

    if (currentSession) await stopCurrent('restart')

    let ptyProcess
    try {
      ptyProcess = validatePtyProcess(processFactory(executable, [], {
        name: 'xterm-256color',
        cols: 120,
        rows: 34,
        cwd: workspacePath,
        env: { ...environment, TERM: 'xterm-256color' },
      }))
    } catch (error) {
      emit(onError, { source: 'spawn', error, workspacePath })
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }

    const session = {
      sessionId,
      workspacePath,
      pty: ptyProcess,
      stream: null,
      input: null,
      dataSubscription: null,
      exitSubscription: null,
      exit: createDeferred(),
      exitStatus: null,
      stopReason: null,
      finalized: false,
      recoveryScheduled: false,
    }
    const pendingEvents = []
    const subscriptions = []
    let activated = false

    try {
      const dataSubscription = ptyProcess.onData((data) => {
        if (!activated) {
          pendingEvents.push({ type: 'data', data })
          return
        }
        if (currentSession !== session || session.finalized || typeof data !== 'string' || data.length === 0) return
        try {
          session.stream.push(data)
        } catch (error) {
          scheduleRecovery(session, 'stream-data', error)
        }
      })
      subscriptions.push(dataSubscription)
      session.dataSubscription = dataSubscription

      const exitSubscription = ptyProcess.onExit((event = {}) => {
        if (!activated) {
          pendingEvents.push({ type: 'exit', event })
          return
        }
        if (currentSession === session) finishSession(session, event)
      })
      subscriptions.push(exitSubscription)
      session.exitSubscription = exitSubscription

      session.stream = createStream({ pty: ptyProcess, sessionId: session.sessionId })
      session.input = createInput({
        pty: ptyProcess,
        stream: session.stream,
        getPty: () => currentSession === session && !session.finalized ? ptyProcess : undefined,
      })
      currentSession = session
      activated = true

      for (const pending of pendingEvents) {
        if (pending.type === 'exit') finishSession(session, pending.event)
        else if (!session.finalized && typeof pending.data === 'string' && pending.data.length > 0) session.stream.push(pending.data)
      }
      pendingEvents.length = 0
    } catch (error) {
      disposeResource(session.input)
      disposeResource(session.stream)
      if (currentSession === session) currentSession = null
      await cleanSpawnFailure(ptyProcess, subscriptions, workspacePath, error)
      emit(onError, { source: 'attach', error, workspacePath })
      throw error
    }

    // node-pty non espone un evento "ready": un turno del loop distingue uno
    // spawn utilizzabile da un child che termina appena il binding ha agganciato exit.
    await new Promise((resolve) => scheduleStartCheck(resolve))
    if (session.finalized) {
      const { exitCode, signal } = session.exitStatus
      const detail = signal ? `segnale ${signal}` : `codice ${exitCode ?? 'sconosciuto'}`
      const error = new Error(`Pi è terminato durante l’avvio (${detail}).`)
      error.code = 'PI_EARLY_EXIT'
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }

    emit(onStarted, { workspacePath, sessionId: session.sessionId, pid: Number.isInteger(ptyProcess.pid) ? ptyProcess.pid : null })
    return Object.freeze({ started: true, sessionId: session.sessionId })
  }

  function start(workspacePath) {
    return enqueue(() => startOperation(workspacePath))
  }

  function stop(reason = 'stop') {
    return enqueue(() => stopCurrent(reason))
  }

  function reload() {
    return enqueue(async () => {
      const session = currentSession
      if (!session || session.finalized) throw new Error('La sessione Pi non è attiva.')
      try {
        session.pty.write('/reload\r')
      } catch (error) {
        emit(onError, { source: 'reload', error, workspacePath: session.workspacePath })
        try {
          await terminateSession(session, 'failure')
          discardSession(session)
        } catch (cleanupError) {
          emit(onError, { source: 'recovery-stop', error: cleanupError, workspacePath: session.workspacePath })
        }
        throw error
      }
      return Object.freeze({ reloaded: true })
    })
  }

  function write(data) {
    if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_KEY_BYTES) return false
    const session = currentSession
    if (!session || session.finalized) return false
    try {
      session.pty.write(data)
      return true
    } catch (error) {
      scheduleRecovery(session, 'write', error)
      return false
    }
  }

  function resize(cols, rows) {
    const session = currentSession
    if (!session || session.finalized) return false
    try {
      session.pty.resize(cols, rows)
      return true
    } catch (error) {
      scheduleRecovery(session, 'resize', error)
      return false
    }
  }

  function getProcess() {
    return currentSession && !currentSession.finalized ? currentSession.pty : undefined
  }

  function getStream() {
    return currentSession?.stream ?? undefined
  }

  function getInput() {
    return currentSession && !currentSession.finalized ? currentSession.input ?? undefined : undefined
  }

  function getState() {
    if (!currentSession) return Object.freeze({ status: 'idle', workspacePath: null, pid: null })
    return Object.freeze({
      status: currentSession.finalized ? 'exited' : currentSession.stopReason ? 'stopping' : 'running',
      workspacePath: currentSession.workspacePath,
      pid: Number.isInteger(currentSession.pty.pid) ? currentSession.pty.pid : null,
      exitStatus: currentSession.exitStatus,
    })
  }

  return Object.freeze({ getInput, getProcess, getState, getStream, reload, resize, start, stop, write })
}

module.exports = {
  DEFAULT_FORCE_STOP_MS,
  DEFAULT_STOP_GRACE_MS,
  createPiSessionController,
}
