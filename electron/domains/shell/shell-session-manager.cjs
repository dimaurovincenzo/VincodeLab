const crypto = require('node:crypto')
const {
  DEFAULT_COLS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_ROWS,
  MAX_INPUT_LENGTH,
  SESSION_ID_PATTERN,
  publicSession,
  publicWorkspace,
  selectFallbackSession,
  validateDimensions,
  validateManagerCollaborators,
  validateSessionLimit,
  validateSessionId,
  validateWorkspacePath,
} = require('./shell-session-model.cjs')
const {
  DEFAULT_SHELL_OUTPUT_HISTORY_BYTES,
  DEFAULT_SHELL_OUTPUT_PAUSE_BYTES,
  DEFAULT_SHELL_OUTPUT_RESUME_BYTES,
  DEFAULT_SHELL_OUTPUT_STALL_MS,
  SHELL_OUTPUT_BLOCK_BYTES,
  createShellOutputTransport,
} = require('./shell-output-transport.cjs')
const { createShellProcessLifecycle } = require('./shell-process-lifecycle.cjs')

function createShellSessionManager(options = {}) {
  validateManagerCollaborators(options)
  const maxSessions = validateSessionLimit(options.maxSessions)
  const outputTransport = createShellOutputTransport({
    maxHistoryBytes: options.maxHistoryBytes,
    pauseBytes: options.pauseBytes,
    resumeBytes: options.resumeBytes,
    stallMs: options.stallMs,
    onData: options.onData,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  })
  const processLifecycle = createShellProcessLifecycle({
    processFactory: options.processFactory,
    getExecutable: options.getExecutable,
    getEnvironment: options.getEnvironment,
    isProcessAlive: options.isProcessAlive,
    stopGraceMs: options.stopGraceMs,
    forceStopMs: options.forceStopMs,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    onData: (session, generation, data) => outputTransport.append(session, generation, data),
    onExit: options.onExit,
    onProcessStopped: (session) => outputTransport.processStopped(session),
  })
  const canonicalizeWorkspace = options.canonicalizeWorkspace
  const createId = options.createId ?? (() => crypto.randomUUID())
  const createAttachmentId = options.createAttachmentId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
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

    const root = validateWorkspacePath(canonicalizeWorkspace(requestedPath))
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

  function requireSession(workspacePath, sessionId) {
    const validatedId = validateSessionId(sessionId)
    const { state } = workspaceState(workspacePath)
    const session = state?.sessions.get(validatedId)
    if (!session) throw new Error('Sessione terminale non trovata per questo workspace.')
    return { state, session }
  }

  function enqueueSessionOperation(session, operation) {
    const result = session.operationTail.then(operation, operation)
    session.operationTail = result.catch(() => {
      // Il chiamante riceve `result`; la tail interna assorbe solo la rejection già
      // propagata, così un'operazione fallita non blocca i retry della sessione.
    })
    return result
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
    }
    outputTransport.initialize(session)
    state.nextOrdinal += 1
    const previousActiveSessionId = state.activeSessionId
    state.sessions.set(session.sessionId, session)
    state.activeSessionId = session.sessionId

    try {
      processLifecycle.spawn(session)
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
    return outputTransport.resume(session, nextAttachmentId())
  }

  function rendererReady(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    return outputTransport.rendererReady(session, message)
  }

  function ack(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    return outputTransport.acknowledge(session, message)
  }

  function disconnect(workspacePath, sessionId, message) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    return outputTransport.disconnect(session, message)
  }

  function diagnostics(workspacePath, sessionId) {
    assertUsable()
    const { session } = requireSession(workspacePath, sessionId)
    return outputTransport.diagnostics(session)
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
      await processLifecycle.terminate(session, 'restart')
      outputTransport.resetHistory(session)
      outputTransport.resetTransport(session)
      processLifecycle.spawn(session)
      return publicSession(session, state.activeSessionId)
    })
  }

  function closeKnownSession(root, state, session) {
    return enqueueSessionOperation(session, async () => {
      if (state.sessions.get(session.sessionId) !== session) {
        return Object.freeze({ closed: false, activeSessionId: state.activeSessionId })
      }
      await processLifecycle.terminate(session, 'closed')
      state.sessions.delete(session.sessionId)
      processLifecycle.disposeSubscriptions(session)
      outputTransport.resetTransport(session)
      session.process = null
      session.processExit = null
      session.status = 'closed'

      if (state.activeSessionId === session.sessionId) selectFallbackSession(state)
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
