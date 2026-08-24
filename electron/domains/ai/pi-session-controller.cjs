const crypto = require('node:crypto')
const path = require('node:path')
const { PI_NOT_RUNNABLE, publicPiFailure } = require('./ai-terminal-launch-policy.cjs')

const DEFAULT_STOP_GRACE_MS = 750
const DEFAULT_FORCE_STOP_MS = 750
const DEFAULT_MAX_PI_SESSIONS = 4
const MAX_KEY_BYTES = 64 * 1024

function createDeferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function disposeSubscription(subscription) {
  try { subscription?.dispose?.() } catch { /* node-pty può aver già liberato la subscription. */ }
}

function disposeResource(resource) {
  try { resource?.dispose?.() } catch { /* Il cleanup deve restare idempotente. */ }
}

function validateWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.length > 4_096 || workspacePath.includes('\0') || !path.isAbsolute(workspacePath)) {
    throw new Error('Percorso workspace non valido per il Terminale AI.')
  }
  return path.resolve(workspacePath)
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length < 8 || sessionId.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(sessionId)) {
    throw new Error('ID sessione Pi non valido.')
  }
  return sessionId
}

function normalizeTitle(title) {
  if (typeof title !== 'string') throw new Error('Nome sessione Pi non valido.')
  const normalized = title.replace(/\p{Cc}+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!normalized || normalized.length > 64) throw new Error('Il nome della sessione Pi deve contenere da 1 a 64 caratteri.')
  return normalized
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
  const executable = candidate?.executable
  const args = candidate?.args
  const options = candidate?.options
  if (candidate?.runtime !== 'pi') throw new Error('Runtime Terminale AI non valido.')
  if (typeof executable !== 'string' || !executable || executable.length > 4_096 || executable.includes('\0')) throw new Error('Eseguibile Terminale AI non valido.')
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) throw new Error('Argomenti Terminale AI non validi.')
  if (!options || typeof options !== 'object' || Array.isArray(options) || options.cwd !== workspacePath) throw new Error('Opzioni Terminale AI non valide.')
  if (!options.env || typeof options.env !== 'object' || Array.isArray(options.env)) throw new Error('Ambiente Terminale AI non valido.')
  if (!Number.isSafeInteger(candidate.startupWindowMs) || candidate.startupWindowMs < 0 || candidate.startupWindowMs > 10_000) throw new Error('Finestra di avvio Terminale AI non valida.')
  return candidate
}

function publicSession(session, activeSessionId) {
  return Object.freeze({
    sessionId: session.sessionId,
    title: session.title,
    status: session.status,
    activity: session.activity,
    active: session.sessionId === activeSessionId,
    createdAt: session.createdAt,
    lastFocusedAt: session.lastFocusedAt,
    pid: Number.isInteger(session.pty?.pid) ? session.pty.pid : null,
    exitStatus: session.exitStatus ? Object.freeze({ ...session.exitStatus }) : null,
  })
}

function createPiSessionController(options = {}) {
  if (typeof options.resolveLaunchCandidates !== 'function') throw new Error('Resolver candidati Terminale AI non valido.')
  if (typeof options.processFactory !== 'function') throw new Error('Factory processo Pi non valida.')
  if (typeof options.createStream !== 'function') throw new Error('Factory stream Pi non valida.')
  if (typeof options.createInput !== 'function') throw new Error('Factory input Pi non valida.')
  if (typeof options.isProcessAlive !== 'function') throw new Error('Verifica processo Pi non valida.')

  const maxSessions = options.maxSessions ?? DEFAULT_MAX_PI_SESSIONS
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 8) throw new Error('Limite sessioni Pi non valido.')
  const resolveLaunchCandidates = options.resolveLaunchCandidates
  const processFactory = options.processFactory
  const createStream = options.createStream
  const createInput = options.createInput
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
  const onStarted = options.onStarted ?? (() => undefined)
  const onExit = options.onExit ?? (() => undefined)
  const onChanged = options.onChanged ?? (() => undefined)
  const onError = options.onError ?? (() => undefined)
  const isProcessAlive = options.isProcessAlive
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
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 0 || !Number.isSafeInteger(forceStopMs) || forceStopMs < 0) throw new Error('Timeout arresto Pi non validi.')

  let workspacePath = null
  let activeSessionId = null
  let nextOrdinal = 1
  let focusSequence = 0
  let operationTail = Promise.resolve()
  const sessions = new Map()
  const issuedSessionIds = new Set()

  function emit(listener, payload) {
    try { listener(Object.freeze(payload)) } catch { /* Gli observer non possiedono il lifecycle. */ }
  }

  function publicState() {
    return Object.freeze({
      workspacePath,
      activeSessionId,
      sessions: Object.freeze([...sessions.values()].map((session) => publicSession(session, activeSessionId))),
    })
  }

  function emitChanged() { emit(onChanged, publicState()) }

  function enqueue(operation) {
    const result = operationTail.then(operation, operation)
    operationTail = result.catch(() => { /* La coda resta disponibile dopo un failure osservato dal chiamante. */ })
    return result
  }

  function nextSessionId() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sessionId = createId()
      if (typeof sessionId === 'string' && sessionId.length >= 8 && sessionId.length <= 128 && /^[A-Za-z0-9_-]+$/u.test(sessionId) && !issuedSessionIds.has(sessionId)) {
        issuedSessionIds.add(sessionId)
        return sessionId
      }
    }
    throw new Error('Impossibile generare un ID sessione Pi sicuro.')
  }

  function requireWorkspace(requestedWorkspacePath) {
    const requested = validateWorkspacePath(requestedWorkspacePath)
    if (!workspacePath || requested !== workspacePath) throw new Error('Il workspace non possiede queste sessioni Pi.')
    return requested
  }

  function requireSession(requestedWorkspacePath, sessionId) {
    requireWorkspace(requestedWorkspacePath)
    const session = sessions.get(validateSessionId(sessionId))
    if (!session) throw new Error('Sessione Pi non trovata per questo workspace.')
    return session
  }

  function allocateSession() {
    if (!workspacePath) throw new Error('Nessun workspace attivo per Pi.')
    if (sessions.size >= maxSessions) throw new Error(`Ogni workspace può avere al massimo ${maxSessions} sessioni Pi.`)
    const timestamp = now()
    const session = {
      sessionId: nextSessionId(), workspacePath, title: `Agente ${nextOrdinal++}`,
      status: 'starting', activity: 'ready', createdAt: timestamp, lastFocusedAt: timestamp,
      focusSequence: ++focusSequence, pty: null, stream: null, input: null,
      dataSubscription: null, exitSubscription: null, exit: createDeferred(), exitStatus: null,
      stopReason: null, suppressExitEvent: false, finalized: false, recoveryScheduled: false,
    }
    sessions.set(session.sessionId, session)
    activeSessionId = session.sessionId
    emitChanged()
    return session
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
    try { session.stream?.end(session.exitStatus) } catch (error) { emit(onError, { source: 'stream-end', error, workspacePath: session.workspacePath, sessionId: session.sessionId }) }
    session.pty = null
    session.status = 'exited'
    session.activity = 'unknown'
    session.exit.resolve(session.exitStatus)
    if (!session.suppressExitEvent) emit(onExit, { workspacePath: session.workspacePath, sessionId: session.sessionId, exitCode: session.exitStatus.exitCode, signal: session.exitStatus.signal, reason })
    emitChanged()
    return true
  }

  function discardSession(session) {
    disposeProcessSubscriptions(session)
    disposeResource(session.input)
    disposeResource(session.stream)
    session.input = null
    session.stream = null
    session.pty = null
  }

  function waitForExit(session, timeoutMs) {
    if (session.finalized) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (exited) => { if (!settled) { settled = true; clearTimer(timer); resolve(exited) } }
      const timer = setTimer(() => finish(false), timeoutMs)
      session.exit.promise.then(() => finish(true))
    })
  }

  function tryKill(session, signal) {
    try { session.pty?.kill(signal); return true } catch (error) {
      emit(onError, { source: signal ? 'force-stop' : 'stop', error, workspacePath: session.workspacePath, sessionId: session.sessionId })
      return false
    }
  }

  function synthesizeExitIfGone(session, reason) {
    const pid = session.pty?.pid
    let alive = null
    try { alive = Number.isInteger(pid) ? isProcessAlive(pid) : false } catch (error) { emit(onError, { source: 'liveness-check', error, workspacePath: session.workspacePath, sessionId: session.sessionId }) }
    if (alive !== false) return false
    finishSession(session, { exitCode: null, signal: reason === 'force-stop' ? 9 : null })
    return true
  }

  async function terminateSession(session, reason) {
    if (session.finalized || !session.pty) return session.exitStatus
    session.stopReason = reason
    const gracefulRequested = tryKill(session)
    if (!gracefulRequested && synthesizeExitIfGone(session, 'stop')) return session.exitStatus
    if (await waitForExit(session, stopGraceMs)) return session.exitStatus
    const forceRequested = tryKill(session, 'SIGKILL')
    if (!forceRequested && synthesizeExitIfGone(session, 'force-stop')) return session.exitStatus
    if (await waitForExit(session, forceStopMs)) return session.exitStatus
    if (synthesizeExitIfGone(session, 'force-stop')) return session.exitStatus
    session.stopReason = null
    const error = new Error('Pi non ha confermato l’arresto; l’operazione è stata bloccata per evitare un processo orfano.')
    error.code = 'PI_STOP_FAILED'
    throw error
  }

  async function cleanSpawnFailure(ptyProcess, subscriptions, session, originalError) {
    subscriptions.forEach(disposeSubscription)
    session.pty = ptyProcess
    session.exit = createDeferred()
    session.finalized = false
    session.stopReason = 'start-failed'
    try { session.exitSubscription = ptyProcess.onExit((event = {}) => finishSession(session, event, 'start-failed')) } catch { /* La liveness resta disponibile. */ }
    try { await terminateSession(session, 'start-failed') } catch (cleanupError) {
      emit(onError, { source: 'start-cleanup', error: cleanupError, workspacePath: session.workspacePath, sessionId: session.sessionId })
      const error = new Error('Pi non è stato inizializzato e il processo avviato non ha confermato l’arresto.')
      error.code = 'PI_START_CLEANUP_FAILED'
      error.cause = originalError
      throw error
    }
  }

  function scheduleRecovery(session, source, error) {
    emit(onError, { source, error, workspacePath: session.workspacePath, sessionId: session.sessionId })
    if (session.recoveryScheduled || session.finalized) return
    session.recoveryScheduled = true
    void enqueue(async () => {
      if (!sessions.has(session.sessionId) || session.finalized) return
      try { await terminateSession(session, 'failure'); session.status = 'error'; session.activity = 'unknown'; emitChanged() } catch (stopError) {
        session.recoveryScheduled = false
        emit(onError, { source: 'recovery-stop', error: stopError, workspacePath: session.workspacePath, sessionId: session.sessionId })
      }
    })
  }

  async function spawnSession(session) {
    Object.assign(session, { status: 'starting', activity: 'ready', exitStatus: null, stopReason: null, finalized: false, recoveryScheduled: false, suppressExitEvent: false, exit: createDeferred() })
    emitChanged()
    let candidates
    try { candidates = await resolveLaunchCandidates(session.workspacePath, { sessionId: session.sessionId }) } catch (error) { throw publicPiFailure(PI_NOT_RUNNABLE, error) }
    if (!Array.isArray(candidates) || candidates.length !== 1) throw publicPiFailure(PI_NOT_RUNNABLE, new Error('Piano di lancio Terminale AI non valido.'))
    const candidate = validateLaunchDescriptor(candidates[0], session.workspacePath)
    let ptyProcess
    try { ptyProcess = validatePtyProcess(processFactory(candidate.executable, candidate.args, candidate.options)) } catch (error) {
      emit(onError, { source: 'pi-spawn', error, workspacePath: session.workspacePath, sessionId: session.sessionId })
      throw publicPiFailure(PI_NOT_RUNNABLE, error)
    }

    const pendingEvents = []
    const subscriptions = []
    const startupSignal = createDeferred()
    let activated = false
    let producedOutput = false
    try {
      const dataSubscription = ptyProcess.onData((data) => {
        if (!activated) {
          if (typeof data === 'string' && data.length > 0) { producedOutput = true; pendingEvents.push({ type: 'data', data }); startupSignal.resolve('output') }
          return
        }
        if (session.pty !== ptyProcess || session.finalized || typeof data !== 'string' || data.length === 0) return
        try { session.stream.push(data) } catch (error) { scheduleRecovery(session, 'stream-data', error) }
      })
      subscriptions.push(dataSubscription)
      session.dataSubscription = dataSubscription
      const exitSubscription = ptyProcess.onExit((event = {}) => {
        if (!activated) { pendingEvents.push({ type: 'exit', event }); startupSignal.resolve('exit'); return }
        if (session.pty === ptyProcess) finishSession(session, event)
      })
      subscriptions.push(exitSubscription)
      session.exitSubscription = exitSubscription
    } catch (error) {
      await cleanSpawnFailure(ptyProcess, subscriptions, session, error)
      emit(onError, { source: 'pi-attach', error, workspacePath: session.workspacePath, sessionId: session.sessionId })
      throw error
    }

    const startupOutcome = await Promise.race([startupSignal.promise, waitForStartupWindow(candidate.startupWindowMs).then(() => 'window')])
    if (startupOutcome === 'exit') await drainStartupEvents()
    if (startupOutcome === 'exit' && !producedOutput) {
      subscriptions.forEach(disposeSubscription)
      session.dataSubscription = null
      session.exitSubscription = null
      const exitStatus = normalizeExitStatus(pendingEvents.find((event) => event.type === 'exit')?.event ?? {})
      const detail = exitStatus.signal ? `segnale ${exitStatus.signal}` : `codice ${exitStatus.exitCode ?? 'sconosciuto'}`
      throw publicPiFailure(PI_NOT_RUNNABLE, Object.assign(new Error(`Pi è terminato durante l’avvio (${detail}).`), { code: 'AI_TERMINAL_EARLY_EXIT', exitStatus }))
    }

    try {
      session.pty = ptyProcess
      session.stream = createStream({ pty: ptyProcess, sessionId: session.sessionId })
      session.input = createInput({ pty: ptyProcess, stream: session.stream, getPty: () => session.pty === ptyProcess && !session.finalized ? ptyProcess : undefined })
      activated = true
      session.status = 'running'
      for (const pending of pendingEvents) if (pending.type === 'data') session.stream.push(pending.data)
      const pendingExit = pendingEvents.findLast((pending) => pending.type === 'exit')
      if (pendingExit) { session.suppressExitEvent = true; finishSession(session, pendingExit.event, 'start-failed') }
      pendingEvents.length = 0
    } catch (error) {
      disposeResource(session.input)
      disposeResource(session.stream)
      session.input = null
      session.stream = null
      session.pty = null
      await cleanSpawnFailure(ptyProcess, subscriptions, session, error)
      emit(onError, { source: 'pi-initialize', error, workspacePath: session.workspacePath, sessionId: session.sessionId })
      throw error
    }
    if (session.finalized) throw publicPiFailure(PI_NOT_RUNNABLE)
    emit(onStarted, { workspacePath: session.workspacePath, sessionId: session.sessionId, pid: Number.isInteger(ptyProcess.pid) ? ptyProcess.pid : null })
    emitChanged()
    return publicSession(session, activeSessionId)
  }

  async function createOperation(requestedWorkspacePath) {
    requireWorkspace(requestedWorkspacePath)
    const session = allocateSession()
    try { return await spawnSession(session) } catch (error) {
      session.status = 'error'; session.activity = 'unknown'; session.exitStatus = error?.cause?.exitStatus ?? null; emitChanged(); throw error
    }
  }

  async function closeAllOperation(reason) {
    if (!workspacePath || sessions.size === 0) { workspacePath = null; activeSessionId = null; return Object.freeze({ closed: 0 }) }
    const root = workspacePath
    const settlements = await Promise.allSettled([...sessions.values()].map(async (session) => {
      await terminateSession(session, reason)
      sessions.delete(session.sessionId)
      issuedSessionIds.delete(session.sessionId)
      discardSession(session)
      return true
    }))
    const failure = settlements.find((settlement) => settlement.status === 'rejected')
    if (sessions.size === 0) { workspacePath = null; activeSessionId = null; nextOrdinal = 1 }
    else if (!sessions.has(activeSessionId)) selectFallbackSession()
    emitChanged()
    if (failure) throw failure.reason
    return Object.freeze({ closed: settlements.filter((settlement) => settlement.status === 'fulfilled').length, workspacePath: root })
  }

  function start(requestedWorkspacePath) {
    return enqueue(async () => {
      await closeAllOperation('workspace-change')
      workspacePath = validateWorkspacePath(requestedWorkspacePath)
      activeSessionId = null
      nextOrdinal = 1
      const session = allocateSession()
      try { const created = await spawnSession(session); return Object.freeze({ started: true, sessionId: created.sessionId }) } catch (error) {
        session.status = 'error'; session.activity = 'unknown'; emitChanged(); throw error
      }
    })
  }

  function create(requestedWorkspacePath) { return enqueue(() => createOperation(requestedWorkspacePath)) }

  function list(requestedWorkspacePath) {
    const requested = validateWorkspacePath(requestedWorkspacePath)
    if (!workspacePath) return Object.freeze({ workspacePath: requested, activeSessionId: null, sessions: Object.freeze([]) })
    requireWorkspace(requested)
    return publicState()
  }

  function focus(requestedWorkspacePath, sessionId) {
    const session = requireSession(requestedWorkspacePath, sessionId)
    activeSessionId = session.sessionId
    session.lastFocusedAt = now()
    session.focusSequence = ++focusSequence
    emitChanged()
    return publicSession(session, activeSessionId)
  }

  function rename(requestedWorkspacePath, sessionId, title) {
    const session = requireSession(requestedWorkspacePath, sessionId)
    session.title = normalizeTitle(title)
    emitChanged()
    return publicSession(session, activeSessionId)
  }

  function reportActivity(sessionId, activity) {
    if (!['ready', 'working', 'completed'].includes(activity)) return false
    const session = sessions.get(sessionId)
    if (!session || session.status !== 'running' || session.activity === activity) return false
    session.activity = activity
    emitChanged()
    return true
  }

  function restart(requestedWorkspacePath, sessionId) {
    return enqueue(async () => {
      const session = requireSession(requestedWorkspacePath, sessionId)
      await terminateSession(session, 'restart')
      discardSession(session)
      session.finalized = false
      session.exitStatus = null
      try { return await spawnSession(session) } catch (error) { session.status = 'error'; session.activity = 'unknown'; emitChanged(); throw error }
    })
  }

  function reload(requestedWorkspacePath, sessionId) {
    return enqueue(async () => {
      const session = requireSession(requestedWorkspacePath, sessionId)
      if (!session.pty || session.finalized || session.status !== 'running') throw new Error('La sessione Pi non è attiva.')
      try { session.pty.write('/reload\r') } catch (error) {
        emit(onError, { source: 'reload', error, workspacePath: session.workspacePath, sessionId: session.sessionId })
        try { await terminateSession(session, 'failure') } catch (cleanupError) { emit(onError, { source: 'recovery-stop', error: cleanupError, workspacePath: session.workspacePath, sessionId: session.sessionId }) }
        session.status = 'error'; session.activity = 'unknown'; emitChanged(); throw error
      }
      return Object.freeze({ reloaded: true })
    })
  }

  function selectFallbackSession() {
    let fallback = null
    for (const session of sessions.values()) if (!fallback || session.focusSequence > fallback.focusSequence) fallback = session
    activeSessionId = fallback?.sessionId ?? null
  }

  async function closeOperation(requestedWorkspacePath, sessionId, reason = 'closed') {
    const session = requireSession(requestedWorkspacePath, sessionId)
    await terminateSession(session, reason)
    sessions.delete(session.sessionId)
    issuedSessionIds.delete(session.sessionId)
    discardSession(session)
    if (activeSessionId === session.sessionId) selectFallbackSession()
    emitChanged()
    return Object.freeze({ closed: true, activeSessionId })
  }

  function close(requestedWorkspacePath, sessionId) { return enqueue(() => closeOperation(requestedWorkspacePath, sessionId)) }

  function stop(reason = 'stop') {
    return enqueue(async () => { const result = await closeAllOperation(reason); return Object.freeze({ stopped: result.closed > 0, closed: result.closed }) })
  }

  function write(requestedWorkspacePath, sessionId, data) {
    if (typeof data !== 'string' || !data || Buffer.byteLength(data, 'utf8') > MAX_KEY_BYTES) return false
    const session = requireSession(requestedWorkspacePath, sessionId)
    if (!session.pty || session.finalized || session.status !== 'running') return false
    try { session.pty.write(data); return true } catch (error) { scheduleRecovery(session, 'write', error); return false }
  }

  function resize(requestedWorkspacePath, sessionId, cols, rows) {
    const session = requireSession(requestedWorkspacePath, sessionId)
    if (!session.pty || session.finalized || session.status !== 'running') return false
    try { session.pty.resize(cols, rows); return true } catch (error) { scheduleRecovery(session, 'resize', error); return false }
  }

  function getSession(sessionId = activeSessionId) { return sessionId ? sessions.get(sessionId) : undefined }
  function getProcess(sessionId) { const session = getSession(sessionId); return session && !session.finalized ? session.pty ?? undefined : undefined }
  function getStream(sessionId) { return getSession(sessionId)?.stream ?? undefined }
  function getInput(sessionId) { const session = getSession(sessionId); return session && !session.finalized ? session.input ?? undefined : undefined }
  function getState() {
    const active = getSession()
    if (!active) return Object.freeze({ status: 'idle', workspacePath, pid: null, activeSessionId })
    return Object.freeze({ status: active.status === 'running' ? 'running' : active.status, workspacePath, pid: Number.isInteger(active.pty?.pid) ? active.pty.pid : null, activeSessionId, exitStatus: active.exitStatus })
  }

  return Object.freeze({ close, create, focus, getInput, getProcess, getState, getStream, list, reload, rename, reportActivity, resize, restart, start, stop, write })
}

module.exports = { DEFAULT_FORCE_STOP_MS, DEFAULT_MAX_PI_SESSIONS, DEFAULT_STOP_GRACE_MS, createPiSessionController }
