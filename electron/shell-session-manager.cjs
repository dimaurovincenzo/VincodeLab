const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_SESSIONS = 8
const MAX_CONFIGURABLE_SESSIONS = 32
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 34
const MAX_INPUT_LENGTH = 65_536
const DEFAULT_SHELL_OUTPUT_HISTORY_BYTES = 4 * 1024 * 1024
const MAX_SHELL_OUTPUT_HISTORY_BYTES = 64 * 1024 * 1024
const SHELL_OUTPUT_BLOCK_BYTES = 64 * 1024
const DEFAULT_SHELL_OUTPUT_PAUSE_BYTES = 4 * 1024 * 1024
const DEFAULT_SHELL_OUTPUT_RESUME_BYTES = 1 * 1024 * 1024
const DEFAULT_SHELL_OUTPUT_STALL_MS = 2_000
const DEFAULT_STOP_GRACE_MS = 750
const DEFAULT_FORCE_STOP_MS = 750
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

function createDeferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function defaultProcessFactory(executable, args, options) {
  return require('node-pty').spawn(executable, args, options)
}

function validateWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.length > 4_096 || workspacePath.includes('\0') || !path.isAbsolute(workspacePath)) {
    throw new Error('Percorso workspace non valido.')
  }
  return path.resolve(workspacePath)
}

function validateSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('ID sessione terminale non valido.')
  }
  return sessionId
}

function validateDimensions(dimensions) {
  const cols = Number(dimensions?.cols)
  const rows = Number(dimensions?.rows)
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 1 || rows <= 1 || cols > 500 || rows > 500) {
    throw new Error('Dimensioni terminale non valide.')
  }
  return { cols, rows }
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

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'ESRCH' ? false : null
  }
}

function normalizeExitStatus(event = {}) {
  return Object.freeze({
    exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
    signal: Number.isInteger(event.signal) || typeof event.signal === 'string' ? event.signal : null,
  })
}

function splitUtf8Output(data, maxBytes) {
  const totalBytes = Buffer.byteLength(data, 'utf8')
  if (totalBytes <= maxBytes) return [{ data, bytes: totalBytes }]
  const blocks = []
  let characters = []
  let bytes = 0
  for (const character of data) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (characters.length > 0 && bytes + characterBytes > maxBytes) {
      blocks.push({ data: characters.join(''), bytes })
      characters = []
      bytes = 0
    }
    characters.push(character)
    bytes += characterBytes
  }
  if (characters.length > 0) blocks.push({ data: characters.join(''), bytes })
  return blocks
}

function createShellSessionManager(options = {}) {
  const maxSessions = options.maxSessions === undefined ? DEFAULT_MAX_SESSIONS : options.maxSessions
  const maxHistoryBytes = options.maxHistoryBytes === undefined ? DEFAULT_SHELL_OUTPUT_HISTORY_BYTES : options.maxHistoryBytes
  const pauseBytes = options.pauseBytes === undefined ? DEFAULT_SHELL_OUTPUT_PAUSE_BYTES : options.pauseBytes
  const resumeBytes = options.resumeBytes === undefined ? DEFAULT_SHELL_OUTPUT_RESUME_BYTES : options.resumeBytes
  const stallMs = options.stallMs === undefined ? DEFAULT_SHELL_OUTPUT_STALL_MS : options.stallMs
  const stopGraceMs = options.stopGraceMs === undefined ? DEFAULT_STOP_GRACE_MS : options.stopGraceMs
  const forceStopMs = options.forceStopMs === undefined ? DEFAULT_FORCE_STOP_MS : options.forceStopMs
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_CONFIGURABLE_SESSIONS) {
    throw new Error('Limite sessioni terminale non valido.')
  }
  if (!Number.isSafeInteger(maxHistoryBytes) || maxHistoryBytes < 4 || maxHistoryBytes > MAX_SHELL_OUTPUT_HISTORY_BYTES) {
    throw new Error('Limite storico terminale non valido.')
  }
  if (!Number.isSafeInteger(pauseBytes) || pauseBytes < SHELL_OUTPUT_BLOCK_BYTES || pauseBytes > MAX_SHELL_OUTPUT_HISTORY_BYTES * 4) {
    throw new Error('Soglia pausa output terminale non valida.')
  }
  if (!Number.isSafeInteger(resumeBytes) || resumeBytes < 0 || resumeBytes >= pauseBytes) {
    throw new Error('Soglia ripresa output terminale non valida.')
  }
  if (!Number.isSafeInteger(stallMs) || stallMs < 10 || stallMs > 60_000) {
    throw new Error('Timeout output terminale non valido.')
  }
  if (!Number.isSafeInteger(stopGraceMs) || stopGraceMs < 0 || stopGraceMs > 60_000 || !Number.isSafeInteger(forceStopMs) || forceStopMs < 0 || forceStopMs > 60_000) {
    throw new Error('Timeout arresto terminale non validi.')
  }
  if (options.processFactory !== undefined && typeof options.processFactory !== 'function') {
    throw new Error('Factory processo terminale non valida.')
  }
  if (options.createId !== undefined && typeof options.createId !== 'function') {
    throw new Error('Factory ID sessione non valida.')
  }
  if (options.createAttachmentId !== undefined && typeof options.createAttachmentId !== 'function') {
    throw new Error('Factory ID collegamento terminale non valida.')
  }
  if (options.onData !== undefined && typeof options.onData !== 'function') throw new Error('Listener dati terminale non valido.')
  if (options.onExit !== undefined && typeof options.onExit !== 'function') throw new Error('Listener exit terminale non valido.')

  const processFactory = options.processFactory ?? defaultProcessFactory
  const createId = options.createId ?? (() => crypto.randomUUID())
  const createAttachmentId = options.createAttachmentId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
  const getExecutable = options.getExecutable ?? (() => process.env.SHELL || '/bin/zsh')
  const getEnvironment = options.getEnvironment ?? (() => process.env)
  const onData = options.onData ?? (() => undefined)
  const onExit = options.onExit ?? (() => undefined)
  const isProcessAlive = options.isProcessAlive ?? processIsAlive
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const workspaces = new Map()
  const aliases = new Map()
  const issuedSessionIds = new Set()
  const issuedAttachmentIds = new Set()
  let disposed = false
  let disposing = false
  let disposePromise = null
  let creationSequence = 0
  let focusSequence = 0

  function assertUsable() {
    if (disposed || disposing) throw new Error('Il manager dei terminali è stato chiuso.')
  }

  function canonicalWorkspace(workspacePath) {
    const requestedPath = validateWorkspacePath(workspacePath)
    const knownPath = aliases.get(requestedPath)
    if (knownPath) return knownPath

    const root = path.resolve(fs.realpathSync(requestedPath))
    const stats = fs.lstatSync(root)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Il workspace non è una directory valida.')
    aliases.set(requestedPath, root)
    aliases.set(root, root)
    return root
  }

  function workspaceState(workspacePath, create = false) {
    const root = canonicalWorkspace(workspacePath)
    let state = workspaces.get(root)
    if (!state && create) {
      state = { root, sessions: new Map(), activeSessionId: null, nextOrdinal: 1 }
      workspaces.set(root, state)
    }
    return { root, state }
  }

  function createSessionId() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sessionId = createId()
      if (typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId) && !issuedSessionIds.has(sessionId)) {
        issuedSessionIds.add(sessionId)
        return sessionId
      }
    }
    throw new Error('Impossibile generare un ID sessione terminale sicuro.')
  }

  function nextAttachmentId() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const attachmentId = createAttachmentId()
      if (typeof attachmentId === 'string' && SESSION_ID_PATTERN.test(attachmentId) && !issuedAttachmentIds.has(attachmentId)) {
        issuedAttachmentIds.add(attachmentId)
        return attachmentId
      }
    }
    throw new Error('Impossibile generare un ID collegamento terminale sicuro.')
  }

  function emit(listener, payload) {
    try {
      listener(Object.freeze(payload))
    } catch {
      // Gli eventi non possono compromettere il lifecycle del processo PTY.
    }
  }

  function publicSession(session, activeSessionId) {
    return Object.freeze({
      sessionId: session.sessionId,
      title: session.title,
      status: session.status,
      active: session.sessionId === activeSessionId,
      createdAt: session.createdAt,
      lastFocusedAt: session.lastFocusedAt,
      cols: session.cols,
      rows: session.rows,
      pid: Number.isInteger(session.process?.pid) ? session.process.pid : null,
      exitStatus: session.exitStatus
        ? Object.freeze({ exitCode: session.exitStatus.exitCode, signal: session.exitStatus.signal })
        : null,
    })
  }

  function publicWorkspace(state) {
    const sessions = [...state.sessions.values()]
      .sort((left, right) => left.creationSequence - right.creationSequence)
      .map((session) => publicSession(session, state.activeSessionId))
    return Object.freeze({
      workspacePath: state.root,
      activeSessionId: state.activeSessionId,
      sessions: Object.freeze(sessions),
    })
  }

  function resetOutputHistory(session) {
    session.outputBlocks = []
    session.outputBytes = 0
    session.outputDroppedBytes = 0
    session.outputTruncated = false
  }

  function clearOutputStallTimer(session) {
    if (session.outputStallTimer !== null) clearTimer(session.outputStallTimer)
    session.outputStallTimer = null
  }

  function syncOutputPressure(session) {
    const shouldPause = session.outputPausedForPressure || session.outputPausedForStall
    const ptyProcess = session.process
    if (shouldPause && !session.outputPtyPaused && ptyProcess && session.status === 'running') {
      ptyProcess.pause()
      session.outputPtyPaused = true
      session.outputPauseCount += 1
    } else if (!shouldPause && session.outputPtyPaused && ptyProcess && session.status === 'running') {
      ptyProcess.resume()
      session.outputPtyPaused = false
    }
  }

  function updateOutputPressure(session) {
    if (session.outputQueuedBytes > pauseBytes) session.outputPausedForPressure = true
    if (session.outputQueuedBytes < resumeBytes) session.outputPausedForPressure = false
    syncOutputPressure(session)
  }

  function pumpOutput(session) {
    if (!session.outputRendererReady || !session.outputAttachmentId || session.outputInFlight || session.outputQueue.length === 0) return
    const block = session.outputQueue[0]
    session.outputInFlight = block
    const timer = setTimer(() => {
      if (session.outputInFlight !== block) return
      session.outputStallTimer = null
      session.outputPausedForStall = true
      syncOutputPressure(session)
    }, stallMs)
    timer?.unref?.()
    session.outputStallTimer = timer
    emit(onData, {
      workspacePath: session.workspacePath,
      sessionId: session.sessionId,
      attachmentId: session.outputAttachmentId,
      generation: block.generation,
      sequence: block.sequence,
      data: block.data,
    })
  }

  function resetOutputTransport(session) {
    clearOutputStallTimer(session)
    session.outputQueue = []
    session.outputQueuedBytes = 0
    session.outputInFlight = null
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputPendingSnapshot = null
    session.outputPausedForPressure = false
    session.outputPausedForStall = false
    session.outputPtyPaused = false
  }

  function appendOutput(session, generation, data) {
    const blockLimit = Math.min(SHELL_OUTPUT_BLOCK_BYTES, maxHistoryBytes)
    for (const chunk of splitUtf8Output(data, blockLimit)) {
      const sequence = ++session.outputSequence
      session.outputReceivedBytes += chunk.bytes
      const previous = session.outputBlocks.at(-1)
      if (previous && previous.bytes + chunk.bytes <= blockLimit) {
        previous.data += chunk.data
        previous.bytes += chunk.bytes
        previous.sequence = sequence
      } else {
        session.outputBlocks.push({ firstSequence: sequence, sequence, data: chunk.data, bytes: chunk.bytes })
      }
      session.outputBytes += chunk.bytes
      while (session.outputBytes > maxHistoryBytes) {
        const removed = session.outputBlocks.shift()
        if (!removed) break
        session.outputBytes -= removed.bytes
        session.outputDroppedBytes += removed.bytes
        session.outputTruncated = true
      }
      const block = { generation, sequence, data: chunk.data, bytes: chunk.bytes }
      session.outputQueue.push(block)
      session.outputQueuedBytes += block.bytes
      session.outputPeakQueuedBytes = Math.max(session.outputPeakQueuedBytes, session.outputQueuedBytes)
      updateOutputPressure(session)
      pumpOutput(session)
    }
  }

  function requireSession(workspacePath, sessionId) {
    const validatedId = validateSessionId(sessionId)
    const { state } = workspaceState(workspacePath)
    const session = state?.sessions.get(validatedId)
    if (!session) throw new Error('Sessione terminale non trovata per questo workspace.')
    return { state, session }
  }

  function disposeProcessSubscriptions(session) {
    disposeSubscription(session.dataSubscription)
    disposeSubscription(session.exitSubscription)
    session.dataSubscription = null
    session.exitSubscription = null
  }

  function executableAndEnvironment() {
    const executable = getExecutable()
    if (typeof executable !== 'string' || !executable || executable.includes('\0') || !path.isAbsolute(executable)) {
      throw new Error('Shell di sistema non valida.')
    }
    const environment = getEnvironment()
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      throw new Error('Ambiente shell non valido.')
    }
    return { executable, environment: { ...environment, TERM: 'xterm-256color' } }
  }

  function handleProcessData(session, ptyProcess, generation, data) {
    if (session.process !== ptyProcess || session.generation !== generation || session.status !== 'running') return
    if (typeof data !== 'string' || data.length === 0) return
    appendOutput(session, generation, data)
  }

  function handleProcessExit(session, ptyProcess, generation, event = {}) {
    if (session.process !== ptyProcess || session.generation !== generation) return
    const reason = session.stopReason
    disposeProcessSubscriptions(session)
    session.process = null
    session.outputPtyPaused = false
    session.status = 'exited'
    session.exitStatus = normalizeExitStatus(event)
    session.processExit?.resolve(session.exitStatus)
    session.processExit = null
    session.stopReason = null
    if (reason !== 'restart') {
      emit(onExit, {
        workspacePath: session.workspacePath,
        sessionId: session.sessionId,
        exitCode: session.exitStatus.exitCode,
        signal: session.exitStatus.signal,
        reason: reason === 'closed' ? 'closed' : 'exit',
      })
    }
  }

  function waitForProcessExit(session, ptyProcess, generation, timeoutMs) {
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

  function tryKillProcess(ptyProcess, signal) {
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
    handleProcessExit(session, ptyProcess, generation, { exitCode: null, signal })
    return true
  }

  async function terminateSessionProcess(session, reason) {
    const ptyProcess = session.process
    const generation = session.generation
    if (!ptyProcess) return session.exitStatus
    session.stopReason = reason

    const gracefulRequested = tryKillProcess(ptyProcess)
    if (!gracefulRequested && synthesizeExitIfGone(session, ptyProcess, generation, null)) return session.exitStatus
    if (await waitForProcessExit(session, ptyProcess, generation, stopGraceMs)) return session.exitStatus

    const forceRequested = tryKillProcess(ptyProcess, 'SIGKILL')
    if (!forceRequested && synthesizeExitIfGone(session, ptyProcess, generation, 9)) return session.exitStatus
    if (await waitForProcessExit(session, ptyProcess, generation, forceStopMs)) return session.exitStatus
    if (synthesizeExitIfGone(session, ptyProcess, generation, 9)) return session.exitStatus

    session.stopReason = null
    const error = new Error('La shell non ha confermato l’arresto; l’operazione è stata bloccata per evitare processi orfani.')
    error.code = 'SHELL_STOP_FAILED'
    throw error
  }

  function enqueueSessionOperation(session, operation) {
    const result = session.operationTail.then(operation, operation)
    session.operationTail = result.catch(() => {
      // Il chiamante riceve `result`; la tail interna assorbe solo la rejection già
      // propagata, così un'operazione fallita non blocca i retry della sessione.
    })
    return result
  }

  function prepareProcessForSession(session) {
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
      throw error
    }
    const generation = session.generation + 1
    const pendingEvents = []
    let activated = false
    let dataSubscription = null
    let exitSubscription = null

    try {
      dataSubscription = ptyProcess.onData((data) => {
        if (!activated) pendingEvents.push({ type: 'data', data })
        else handleProcessData(session, ptyProcess, generation, data)
      })
      exitSubscription = ptyProcess.onExit((event = {}) => {
        if (!activated) pendingEvents.push({ type: 'exit', event })
        else handleProcessExit(session, ptyProcess, generation, event)
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
          if (pending.type === 'data') handleProcessData(session, ptyProcess, generation, pending.data)
          else handleProcessExit(session, ptyProcess, generation, pending.event)
        }
        pendingEvents.length = 0
      },
    }
  }

  function spawnForSession(session) {
    const prepared = prepareProcessForSession(session)
    prepared.activate()
    return prepared.ptyProcess
  }

  function selectFallback(state) {
    let fallback = null
    for (const session of state.sessions.values()) {
      if (!fallback || session.focusSequence > fallback.focusSequence || (
        session.focusSequence === fallback.focusSequence && session.creationSequence > fallback.creationSequence
      )) fallback = session
    }
    state.activeSessionId = fallback?.sessionId ?? null
  }

  function create(workspacePath) {
    assertUsable()
    const { root, state } = workspaceState(workspacePath, true)
    if (state.sessions.size >= maxSessions) {
      throw new Error(`Ogni workspace può avere al massimo ${maxSessions} terminali.`)
    }

    const timestamp = now()
    const session = {
      sessionId: createSessionId(),
      workspacePath: root,
      title: `Terminale ${state.nextOrdinal}`,
      status: 'starting',
      createdAt: timestamp,
      lastFocusedAt: timestamp,
      creationSequence: ++creationSequence,
      focusSequence: ++focusSequence,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      process: null,
      processExit: null,
      stopReason: null,
      operationTail: Promise.resolve(),
      generation: 0,
      dataSubscription: null,
      exitSubscription: null,
      exitStatus: null,
      outputBlocks: [],
      outputBytes: 0,
      outputDroppedBytes: 0,
      outputTruncated: false,
      outputSequence: 0,
      outputQueue: [],
      outputQueuedBytes: 0,
      outputPeakQueuedBytes: 0,
      outputInFlight: null,
      outputRendererReady: false,
      outputAttachmentId: null,
      outputPendingSnapshot: null,
      outputPausedForPressure: false,
      outputPausedForStall: false,
      outputPtyPaused: false,
      outputStallTimer: null,
      outputPauseCount: 0,
      outputReceivedBytes: 0,
      outputAcknowledgedBytes: 0,
    }
    state.nextOrdinal += 1
    const previousActiveSessionId = state.activeSessionId
    state.sessions.set(session.sessionId, session)
    state.activeSessionId = session.sessionId

    try {
      spawnForSession(session)
    } catch (error) {
      state.sessions.delete(session.sessionId)
      state.activeSessionId = previousActiveSessionId
      issuedSessionIds.delete(session.sessionId)
      if (state.sessions.size === 0) workspaces.delete(root)
      throw error
    }
    return publicSession(session, state.activeSessionId)
  }

  function list(workspacePath) {
    assertUsable()
    const { root, state } = workspaceState(workspacePath)
    return state
      ? publicWorkspace(state)
      : Object.freeze({ workspacePath: root, activeSessionId: null, sessions: Object.freeze([]) })
  }

  function resume(workspacePath, sessionId) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    const attachmentId = nextAttachmentId()
    clearOutputStallTimer(session)
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputInFlight = null
    session.outputPausedForStall = false
    updateOutputPressure(session)
    const blocks = session.outputBlocks.map((block) => Object.freeze({ sequence: block.sequence, data: block.data }))
    const snapshot = Object.freeze({
      sessionId: session.sessionId,
      attachmentId,
      generation: session.generation,
      blocks: Object.freeze(blocks),
      firstSequence: session.outputBlocks[0]?.firstSequence ?? 0,
      watermark: session.outputSequence,
      bytes: session.outputBytes,
      truncated: session.outputTruncated,
      droppedBytes: session.outputDroppedBytes,
      status: session.status,
      exitStatus: session.exitStatus
        ? Object.freeze({ exitCode: session.exitStatus.exitCode, signal: session.exitStatus.signal })
        : null,
    })
    session.outputPendingSnapshot = {
      attachmentId,
      generation: snapshot.generation,
      watermark: snapshot.watermark,
      bytes: snapshot.bytes,
      droppedBytes: snapshot.droppedBytes,
    }
    return snapshot
  }

  function rendererReady(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const watermark = Number(message?.watermark)
    const pending = session.outputPendingSnapshot
    if (typeof attachmentId !== 'string' || !SESSION_ID_PATTERN.test(attachmentId)) return false
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(watermark) || watermark < 0) return false
    if (!pending || attachmentId !== pending.attachmentId || generation !== session.generation || generation !== pending.generation || watermark !== pending.watermark) return false

    while (session.outputQueue[0] && session.outputQueue[0].generation === generation && session.outputQueue[0].sequence <= watermark) {
      const block = session.outputQueue.shift()
      session.outputQueuedBytes -= block.bytes
    }
    session.outputPendingSnapshot = null
    session.outputAttachmentId = attachmentId
    session.outputRendererReady = true
    session.outputPausedForStall = false
    updateOutputPressure(session)
    pumpOutput(session)
    return true
  }

  function ack(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const sequence = Number(message?.sequence)
    const block = session.outputInFlight
    if (!block || attachmentId !== session.outputAttachmentId || generation !== block.generation || sequence !== block.sequence) return false
    clearOutputStallTimer(session)
    if (session.outputQueue[0] !== block) return false
    session.outputQueue.shift()
    session.outputQueuedBytes -= block.bytes
    session.outputAcknowledgedBytes += block.bytes
    session.outputInFlight = null
    session.outputPausedForStall = false
    updateOutputPressure(session)
    pumpOutput(session)
    return true
  }

  function disconnect(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const matchesActive = attachmentId === session.outputAttachmentId
    const matchesPending = attachmentId === session.outputPendingSnapshot?.attachmentId
    if ((!matchesActive && !matchesPending) || generation !== session.generation) return false
    clearOutputStallTimer(session)
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputPendingSnapshot = null
    session.outputInFlight = null
    session.outputPausedForStall = false
    updateOutputPressure(session)
    return true
  }

  function diagnostics(workspacePath, sessionId) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    return Object.freeze({
      generation: session.generation,
      receivedBytes: session.outputReceivedBytes,
      acknowledgedBytes: session.outputAcknowledgedBytes,
      queuedBytes: session.outputQueuedBytes,
      queuedBlocks: session.outputQueue.length,
      peakQueuedBytes: session.outputPeakQueuedBytes,
      inFlightSequence: session.outputInFlight?.sequence ?? null,
      rendererConnected: session.outputRendererReady,
      paused: session.outputPtyPaused,
      pauseCount: session.outputPauseCount,
    })
  }

  function focus(workspacePath, sessionId) {
    assertUsable()
    const { state, session } = requireSession(workspacePath, sessionId)
    session.lastFocusedAt = now()
    session.focusSequence = ++focusSequence
    state.activeSessionId = session.sessionId
    return publicSession(session, state.activeSessionId)
  }

  function write(workspacePath, sessionId, data) {
    assertUsable()
    if (typeof data !== 'string' || data.length === 0 || data.length > MAX_INPUT_LENGTH) {
      throw new Error('Input terminale non valido.')
    }
    const { session } = requireSession(workspacePath, sessionId)
    if (session.status !== 'running' || !session.process || session.stopReason) throw new Error('La sessione terminale non è attiva.')
    session.process.write(data)
    return Object.freeze({ written: true })
  }

  function resize(workspacePath, sessionId, dimensions) {
    assertUsable()
    const { cols, rows } = validateDimensions(dimensions)
    const { state, session } = requireSession(workspacePath, sessionId)
    if (session.status !== 'running' || !session.process || session.stopReason) throw new Error('La sessione terminale non è attiva.')
    session.process.resize(cols, rows)
    session.cols = cols
    session.rows = rows
    return publicSession(session, state.activeSessionId)
  }

  function restart(workspacePath, sessionId) {
    assertUsable()
    const { state, session } = requireSession(workspacePath, sessionId)
    return enqueueSessionOperation(session, async () => {
      if (state.sessions.get(session.sessionId) !== session) throw new Error('Sessione terminale non trovata per questo workspace.')
      await terminateSessionProcess(session, 'restart')
      resetOutputHistory(session)
      resetOutputTransport(session)
      spawnForSession(session)
      return publicSession(session, state.activeSessionId)
    })
  }

  function closeKnownSession(root, state, session) {
    return enqueueSessionOperation(session, async () => {
      if (state.sessions.get(session.sessionId) !== session) {
        return Object.freeze({ closed: false, activeSessionId: state.activeSessionId })
      }
      await terminateSessionProcess(session, 'closed')
      state.sessions.delete(session.sessionId)
      disposeProcessSubscriptions(session)
      resetOutputTransport(session)
      session.process = null
      session.processExit = null
      session.status = 'closed'

      if (state.activeSessionId === session.sessionId) selectFallback(state)
      if (state.sessions.size === 0) workspaces.delete(root)
      return Object.freeze({ closed: true, activeSessionId: state.activeSessionId })
    })
  }

  function close(workspacePath, sessionId) {
    assertUsable()
    const validatedId = validateSessionId(sessionId)
    const { root, state } = workspaceState(workspacePath)
    const session = state?.sessions.get(validatedId)
    if (!session) return Promise.resolve(Object.freeze({ closed: false, activeSessionId: state?.activeSessionId ?? null }))
    return closeKnownSession(root, state, session)
  }

  async function closeKnownWorkspace(root, state) {
    if (!state) return Object.freeze({ closed: 0 })
    const settlements = await Promise.allSettled([...state.sessions.values()].map((session) => closeKnownSession(root, state, session)))
    const failure = settlements.find((settlement) => settlement.status === 'rejected')
    if (failure) throw failure.reason
    return Object.freeze({ closed: settlements.filter((settlement) => settlement.value.closed).length })
  }

  function closeAll(workspacePath) {
    assertUsable()
    const { root, state } = workspaceState(workspacePath)
    return closeKnownWorkspace(root, state)
  }

  function dispose() {
    if (disposed) return Promise.resolve(Object.freeze({ closed: 0 }))
    if (disposePromise) return disposePromise
    disposing = true
    disposePromise = (async () => {
      const settlements = await Promise.allSettled([...workspaces.entries()].map(([root, state]) => closeKnownWorkspace(root, state)))
      const failure = settlements.find((settlement) => settlement.status === 'rejected')
      if (failure) throw failure.reason
      const closed = settlements.reduce((total, settlement) => total + settlement.value.closed, 0)
      disposed = true
      workspaces.clear()
      aliases.clear()
      issuedSessionIds.clear()
      issuedAttachmentIds.clear()
      return Object.freeze({ closed })
    })()
    return disposePromise.finally(() => {
      disposing = false
      disposePromise = null
    })
  }

  return Object.freeze({ ack, close, closeAll, create, diagnostics, disconnect, dispose, focus, list, rendererReady, resize, restart, resume, write })
}

module.exports = {
  DEFAULT_MAX_SESSIONS,
  DEFAULT_SHELL_OUTPUT_HISTORY_BYTES,
  DEFAULT_SHELL_OUTPUT_PAUSE_BYTES,
  DEFAULT_SHELL_OUTPUT_RESUME_BYTES,
  DEFAULT_SHELL_OUTPUT_STALL_MS,
  SESSION_ID_PATTERN,
  SHELL_OUTPUT_BLOCK_BYTES,
  createShellSessionManager,
}
