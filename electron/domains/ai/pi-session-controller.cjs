const {
  HERDR_NOT_RUNNABLE,
  HERDR_SESSION_ENDED_DURING_STARTUP,
  HERDR_SESSION_ENDED_WITHOUT_FALLBACK,
  PI_NOT_INSTALLED,
  PI_NOT_RUNNABLE,
  publicPiFailure,
} = require('./ai-terminal-launch-policy.cjs')

const DEFAULT_STOP_GRACE_MS = 750
const DEFAULT_FORCE_STOP_MS = 750
const MAX_KEY_BYTES = 64 * 1024

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

function validateLaunchDescriptor(candidate, workspacePath) {
  const runtime = candidate?.runtime
  const executable = candidate?.executable
  const args = candidate?.args
  const options = candidate?.options
  const startupWindowMs = candidate?.startupWindowMs
  if (runtime !== 'herdr' && runtime !== 'pi') throw new Error('Runtime Terminale AI non valido.')
  if (typeof executable !== 'string' || executable.length === 0 || executable.length > 4_096 || executable.includes('\0')) {
    throw new Error('Eseguibile Terminale AI non valido.')
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) {
    throw new Error('Argomenti Terminale AI non validi.')
  }
  if (!options || typeof options !== 'object' || Array.isArray(options) || options.cwd !== workspacePath) {
    throw new Error('Opzioni Terminale AI non valide.')
  }
  if (!options.env || typeof options.env !== 'object' || Array.isArray(options.env)) throw new Error('Ambiente Terminale AI non valido.')
  if (!Number.isSafeInteger(startupWindowMs) || startupWindowMs < 0 || startupWindowMs > 10_000) {
    throw new Error('Finestra di avvio Terminale AI non valida.')
  }
  if (runtime === 'herdr') {
    if (typeof candidate.herdrSessionName !== 'string' || !/^vincodelab-[a-f0-9]{16}$/u.test(candidate.herdrSessionName)) throw new Error('Sessione Herdr non valida.')
    if (candidate.bootstrapPi !== true && candidate.bootstrapPi !== false) throw new Error('Bootstrap Pi Herdr non valido.')
  } else if (candidate.herdrSessionName !== undefined || candidate.bootstrapPi !== undefined) {
    throw new Error('Metadati Herdr non validi per Pi diretto.')
  }
  if (candidate.terminalFailure !== undefined && candidate.terminalFailure !== PI_NOT_INSTALLED.code && candidate.terminalFailure !== PI_NOT_RUNNABLE.code && candidate.terminalFailure !== HERDR_NOT_RUNNABLE.code) {
    throw new Error('Failure terminale Terminale AI non valido.')
  }
  return candidate
}

function terminalFailureFor(candidate) {
  if (candidate?.terminalFailure === PI_NOT_INSTALLED.code) return PI_NOT_INSTALLED
  if (candidate?.terminalFailure === HERDR_NOT_RUNNABLE.code) return HERDR_NOT_RUNNABLE
  return PI_NOT_RUNNABLE
}

function createPiSessionController(options = {}) {
  if (typeof options.resolveLaunchCandidates !== 'function') throw new Error('Resolver candidati Terminale AI non valido.')
  if (typeof options.processFactory !== 'function') throw new Error('Factory processo Pi non valida.')
  if (typeof options.createStream !== 'function') throw new Error('Factory stream Pi non valida.')
  if (typeof options.createInput !== 'function') throw new Error('Factory input Pi non valida.')
  if (typeof options.isProcessAlive !== 'function') throw new Error('Verifica processo Pi non valida.')

  const resolveLaunchCandidates = options.resolveLaunchCandidates
  const initializeHerdr = options.initializeHerdr ?? (async () => undefined)
  const processFactory = options.processFactory
  const createStream = options.createStream
  const createInput = options.createInput
  const createId = options.createId ?? (() => require('node:crypto').randomUUID())
  const onStarted = options.onStarted ?? (() => undefined)
  const onExit = options.onExit ?? (() => undefined)
  const onError = options.onError ?? (() => undefined)
  const isProcessAlive = options.isProcessAlive
  if (typeof initializeHerdr !== 'function') throw new Error('Inizializzatore workspace Herdr non valido.')
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const scheduleStartCheck = options.scheduleStartCheck ?? setImmediate
  const drainStartupEvents = options.drainStartupEvents ?? (() => new Promise((resolve) => scheduleStartCheck(resolve)))
  const waitForStartupWindow = options.waitForStartupWindow ?? ((milliseconds) => new Promise((resolve) => {
    if (milliseconds === 0) scheduleStartCheck(resolve)
    else setTimer(resolve, milliseconds)
  }))
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
    if (!session.suppressExitEvent) {
      emit(onExit, {
        workspacePath: session.workspacePath,
        sessionId: session.sessionId,
        exitCode: session.exitStatus.exitCode,
        signal: session.exitStatus.signal,
        reason,
        runtime: session.runtime,
        piAvailable: session.piAvailable,
        fallbackReason: session.fallbackReason,
      })
    }
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
    const error = new Error('Il Terminale AI non ha confermato l’arresto; il nuovo avvio è stato bloccato per evitare una sessione duplicata.')
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
      runtime: null,
      fallbackReason: null,
      suppressExitEvent: true,
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
      const error = new Error('Il Terminale AI non è stato inizializzato e il processo avviato non ha confermato l’arresto.')
      error.code = 'PI_START_CLEANUP_FAILED'
      error.cause = originalError
      throw error
    } finally {
      disposeSubscription(exitSubscription)
    }
  }

  async function startOperation(workspacePath, launchOptions) {
    if (typeof workspacePath !== 'string' || workspacePath.length === 0 || workspacePath.length > 4_096 || workspacePath.includes('\0')) {
      throw new Error('Percorso workspace non valido per il Terminale AI.')
    }

    let candidates
    try {
      candidates = await resolveLaunchCandidates(workspacePath, launchOptions)
    } catch (error) {
      emit(onError, { source: 'resolve-launch-candidates', error, workspacePath })
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 2) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Piano di lancio Terminale AI non valido.'))
    }
    const launchCandidates = candidates.map((candidate) => validateLaunchDescriptor(candidate, workspacePath))
    if (launchCandidates.length === 2 && (launchCandidates[0].runtime !== 'herdr' || launchCandidates[1].runtime !== 'pi')) {
      throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Ordine candidati Terminale AI non valido.'))
    }
    if (currentSession) await stopCurrent('restart')

    let dynamicFallbackReason = null
    for (let index = 0; index < launchCandidates.length; index += 1) {
      const candidate = launchCandidates[index]
      const hasFallback = index + 1 < launchCandidates.length
      let ptyProcess
      try {
        ptyProcess = validatePtyProcess(processFactory(candidate.executable, candidate.args, candidate.options))
      } catch (error) {
        emit(onError, { source: `${candidate.runtime}-spawn`, error, workspacePath })
        if (candidate.runtime === 'herdr' && hasFallback) {
          dynamicFallbackReason = 'spawn-failed'
          continue
        }
        throw publicPiFailure(terminalFailureFor(candidate), error)
      }

      const sessionId = createId()
      if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 128) {
        await cleanSpawnFailure(ptyProcess, [], workspacePath, new Error('ID sessione Terminale AI non valido.'))
        throw new Error('ID sessione Terminale AI non valido.')
      }
      const session = {
        sessionId,
        workspacePath,
        runtime: candidate.runtime,
        piAvailable: candidate.runtime === 'pi' || !candidate.terminalFailure,
        fallbackReason: candidate.runtime === 'pi' ? dynamicFallbackReason ?? candidate.fallbackReason ?? null : null,
        pty: ptyProcess,
        stream: null,
        input: null,
        dataSubscription: null,
        exitSubscription: null,
        exit: createDeferred(),
        exitStatus: null,
        stopReason: null,
        suppressExitEvent: false,
        finalized: false,
        recoveryScheduled: false,
      }
      const pendingEvents = []
      const subscriptions = []
      const startupSignal = createDeferred()
      let activated = false
      let producedOutput = false

      try {
        const dataSubscription = ptyProcess.onData((data) => {
          if (!activated) {
            if (typeof data === 'string' && data.length > 0) {
              producedOutput = true
              pendingEvents.push({ type: 'data', data })
              startupSignal.resolve('output')
            }
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
            startupSignal.resolve('exit')
            return
          }
          if (currentSession === session) finishSession(session, event)
        })
        subscriptions.push(exitSubscription)
        session.exitSubscription = exitSubscription
      } catch (error) {
        await cleanSpawnFailure(ptyProcess, subscriptions, workspacePath, error)
        emit(onError, { source: `${candidate.runtime}-attach`, error, workspacePath })
        if (candidate.runtime === 'herdr' && hasFallback && !producedOutput) {
          dynamicFallbackReason = 'spawn-failed'
          continue
        }
        throw error
      }

      const startupOutcome = await Promise.race([
        startupSignal.promise,
        waitForStartupWindow(candidate.startupWindowMs).then(() => 'window'),
      ])
      if (startupOutcome === 'exit') await drainStartupEvents()
      if (startupOutcome === 'exit' && !producedOutput) {
        subscriptions.forEach(disposeSubscription)
        const exitEvent = pendingEvents.find((event) => event.type === 'exit')?.event ?? {}
        const exitStatus = normalizeExitStatus(exitEvent)
        emit(onError, {
          source: `${candidate.runtime}-early-exit`,
          error: Object.assign(new Error('Il Terminale AI è terminato prima di produrre output.'), { exitStatus }),
          workspacePath,
        })
        if (candidate.runtime === 'herdr' && hasFallback) {
          dynamicFallbackReason = 'early-exit'
          continue
        }
        const detail = exitStatus.signal ? `segnale ${exitStatus.signal}` : `codice ${exitStatus.exitCode ?? 'sconosciuto'}`
        throw publicPiFailure(terminalFailureFor(candidate), Object.assign(new Error(`Il Terminale AI è terminato durante l’avvio (${detail}).`), { code: 'AI_TERMINAL_EARLY_EXIT' }))
      }

      if (candidate.runtime === 'herdr') {
        try {
          await initializeHerdr({
            bootstrapPi: candidate.bootstrapPi,
            environment: candidate.options.env,
            executable: candidate.executable,
            sessionName: candidate.herdrSessionName,
            workspacePath,
          })
        } catch (error) {
          await cleanSpawnFailure(ptyProcess, subscriptions, workspacePath, error)
          emit(onError, { source: 'herdr-bootstrap', error, workspacePath })
          if (hasFallback) {
            dynamicFallbackReason = 'bootstrap-failed'
            continue
          }
          throw publicPiFailure(terminalFailureFor(candidate), error)
        }
      }

      try {
        session.stream = createStream({ pty: ptyProcess, sessionId: session.sessionId })
        session.input = createInput({
          pty: ptyProcess,
          stream: session.stream,
          getPty: () => currentSession === session && !session.finalized ? ptyProcess : undefined,
        })
        currentSession = session
        activated = true

        for (const pending of pendingEvents) {
          if (pending.type === 'data') session.stream.push(pending.data)
        }
        const pendingExit = pendingEvents.findLast((pending) => pending.type === 'exit')
        if (pendingExit) {
          // Il fallimento appartiene ancora all'operazione di startup, che
          // produrrà la sola superficie utente e la sola notifica. Lo stream
          // viene comunque finalizzato, senza pubblicare anche TERMINAL_EXIT.
          session.suppressExitEvent = true
          finishSession(session, pendingExit.event, 'start-failed')
        }
        pendingEvents.length = 0
      } catch (error) {
        disposeResource(session.input)
        disposeResource(session.stream)
        if (currentSession === session) currentSession = null
        await cleanSpawnFailure(ptyProcess, subscriptions, workspacePath, error)
        emit(onError, { source: `${candidate.runtime}-initialize`, error, workspacePath })
        throw error
      }

      if (session.finalized) {
        if (session.runtime === 'herdr') {
          throw publicPiFailure(session.piAvailable ? HERDR_SESSION_ENDED_DURING_STARTUP : HERDR_SESSION_ENDED_WITHOUT_FALLBACK)
        }
        throw publicPiFailure(PI_NOT_RUNNABLE)
      }

      emit(onStarted, {
        workspacePath,
        sessionId: session.sessionId,
        pid: Number.isInteger(ptyProcess.pid) ? ptyProcess.pid : null,
        runtime: session.runtime,
        piAvailable: session.piAvailable,
        fallbackReason: session.fallbackReason,
      })
      return Object.freeze({
        started: true,
        sessionId: session.sessionId,
        runtime: session.runtime,
        piAvailable: session.piAvailable,
        ...(session.fallbackReason ? { fallbackReason: session.fallbackReason } : {}),
      })
    }

    throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Nessun candidato Terminale AI avviabile.'))
  }

  function start(workspacePath, launchOptions) {
    return enqueue(() => startOperation(workspacePath, launchOptions))
  }

  function stop(reason = 'stop') {
    return enqueue(() => stopCurrent(reason))
  }

  function reload() {
    return enqueue(async () => {
      const session = currentSession
      if (!session || session.finalized) throw new Error('Il Terminale AI non è attivo.')
      if (session.runtime === 'herdr') {
        return Object.freeze({ reloaded: false, runtime: 'herdr', reason: 'active-pane-ambiguous' })
      }
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
      return Object.freeze({ reloaded: true, runtime: 'pi' })
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
    if (!currentSession) return Object.freeze({ status: 'idle', workspacePath: null, pid: null, runtime: null, fallbackReason: null })
    return Object.freeze({
      status: currentSession.finalized ? 'exited' : currentSession.stopReason ? 'stopping' : 'running',
      workspacePath: currentSession.workspacePath,
      pid: Number.isInteger(currentSession.pty.pid) ? currentSession.pty.pid : null,
      exitStatus: currentSession.exitStatus,
      runtime: currentSession.runtime,
      piAvailable: currentSession.piAvailable,
      fallbackReason: currentSession.fallbackReason,
    })
  }

  return Object.freeze({ getInput, getProcess, getState, getStream, reload, resize, start, stop, write })
}

module.exports = {
  DEFAULT_FORCE_STOP_MS,
  DEFAULT_STOP_GRACE_MS,
  createPiSessionController,
}
