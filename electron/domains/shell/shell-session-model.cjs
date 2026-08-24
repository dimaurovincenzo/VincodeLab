const path = require('node:path')

const DEFAULT_MAX_SESSIONS = 8
const MAX_CONFIGURABLE_SESSIONS = 32
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 34
const MAX_INPUT_LENGTH = 65_536
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/

function validateSessionLimit(configuredLimit) {
  const maxSessions = configuredLimit === undefined ? DEFAULT_MAX_SESSIONS : configuredLimit
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > MAX_CONFIGURABLE_SESSIONS) {
    throw new Error('Limite sessioni terminale non valido.')
  }
  return maxSessions
}

function validateManagerCollaborators(options) {
  if (typeof options.canonicalizeWorkspace !== 'function') throw new Error('Canonicalizzatore workspace terminale non valido.')
  if (typeof options.processFactory !== 'function') throw new Error('Factory processo terminale non valida.')
  if (typeof options.getExecutable !== 'function') throw new Error('Resolver eseguibile shell non valido.')
  if (typeof options.getEnvironment !== 'function') throw new Error('Provider ambiente shell non valido.')
  if (typeof options.isProcessAlive !== 'function') throw new Error('Verifica processo shell non valida.')
  if (options.createId !== undefined && typeof options.createId !== 'function') {
    throw new Error('Factory ID sessione non valida.')
  }
  if (options.createAttachmentId !== undefined && typeof options.createAttachmentId !== 'function') {
    throw new Error('Factory ID collegamento terminale non valida.')
  }
  if (options.onData !== undefined && typeof options.onData !== 'function') throw new Error('Listener dati terminale non valido.')
  if (options.onExit !== undefined && typeof options.onExit !== 'function') throw new Error('Listener exit terminale non valido.')
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

function normalizeExitStatus(event = {}) {
  return Object.freeze({
    exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
    signal: Number.isInteger(event.signal) || typeof event.signal === 'string' ? event.signal : null,
  })
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

function selectFallbackSession(state) {
  let fallback = null
  for (const session of state.sessions.values()) {
    if (!fallback || session.focusSequence > fallback.focusSequence || (
      session.focusSequence === fallback.focusSequence && session.creationSequence > fallback.creationSequence
    )) fallback = session
  }
  state.activeSessionId = fallback?.sessionId ?? null
}

module.exports = {
  DEFAULT_COLS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_ROWS,
  MAX_INPUT_LENGTH,
  SESSION_ID_PATTERN,
  normalizeExitStatus,
  publicSession,
  publicWorkspace,
  selectFallbackSession,
  validateDimensions,
  validateManagerCollaborators,
  validateSessionLimit,
  validateSessionId,
  validateWorkspacePath,
}
