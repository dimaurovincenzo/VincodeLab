const { getApplicationErrorLogMetadata, toApplicationError } = require('./application-error.cjs')
const { SESSION_ID_PATTERN } = require('./shell-session-manager.cjs')

const SHELL_SESSION_ERROR_CHANNEL = 'shellSessions:error'
const OPERATION_CONFIGURATION = Object.freeze({
  ready: Object.freeze({
    code: 'SHELL_SESSION_READY_FAILED',
    message: 'Impossibile collegare l’output del terminale. Recupera lo storico e riprova.',
    recovery: 'resume',
  }),
  ack: Object.freeze({
    code: 'SHELL_SESSION_ACK_FAILED',
    message: 'L’output del terminale non è stato confermato. Recupera lo storico per riallinearlo.',
    recovery: 'resume',
  }),
  disconnect: Object.freeze({
    code: 'SHELL_SESSION_DISCONNECT_FAILED',
    message: 'Impossibile scollegare correttamente l’output del terminale. Riapri la sessione per riallinearla.',
    recovery: 'resume',
  }),
  write: Object.freeze({
    code: 'SHELL_SESSION_WRITE_FAILED',
    message: 'Il testo non è stato inviato alla shell. La sessione e lo storico sono rimasti disponibili.',
    recovery: 'restart',
  }),
  resize: Object.freeze({
    code: 'SHELL_SESSION_RESIZE_FAILED',
    message: 'Il terminale non è stato ridimensionato. La sessione è rimasta attiva.',
    recovery: 'resize',
  }),
})

function errorSignal(error) {
  const values = []
  for (const key of ['name', 'code', 'errno', 'message']) {
    const value = error?.[key]
    if (typeof value === 'string' || typeof value === 'number') values.push(String(value).slice(0, 1_024))
  }
  if (typeof error === 'string') values.push(error.slice(0, 1_024))
  return values.join(' ').toLowerCase()
}

function shellSessionErrorCategory(error) {
  const signal = errorSignal(error)
  if (/abort|cancel|annullat|abort_err/u.test(signal)) return 'cancelled'
  if (/timeout|timed out|etimedout|deadline/u.test(signal)) return 'timeout'
  if (/eacces|eperm|permission denied|operation not permitted/u.test(signal)) return 'permission'
  if (/not found|non trovata|does not exist|enoent/u.test(signal)) return 'not-found'
  if (/invalid|non valid|malformed|input terminale|dimensioni terminale/u.test(signal)) return 'validation'
  return 'process'
}

function validatedSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId) ? sessionId : null
}

function createShellSessionErrorEvent(error, { operation, sessionId } = {}) {
  const configuration = OPERATION_CONFIGURATION[operation]
  if (!configuration) throw new TypeError('Operazione terminale one-way non valida.')
  const safeSessionId = validatedSessionId(sessionId)
  const invalidSession = !safeSessionId
  const incident = toApplicationError(error, {
    category: invalidSession ? 'validation' : shellSessionErrorCategory(error),
    channel: `shellSessions:${operation}`,
    code: invalidSession ? 'SHELL_SESSION_INVALID' : configuration.code,
    domain: 'terminal',
    message: invalidSession ? 'Richiesta terminale non valida.' : configuration.message,
    operation,
    recoverable: !invalidSession,
  })
  const payload = safeSessionId
    ? Object.freeze({
      sessionId: safeSessionId,
      operation,
      recovery: configuration.recovery,
      error: Object.freeze({
        category: incident.category,
        code: incident.publicCode,
        correlationId: incident.correlationId,
        message: incident.message,
        recoverable: incident.recoverable,
        severity: incident.severity,
      }),
    })
    : null
  return Object.freeze({ incident, payload })
}

function reportShellSessionOneWayFailure({ error, log, operation, send, sessionId }) {
  const result = createShellSessionErrorEvent(error, { operation, sessionId })
  const metadata = Object.freeze({
    ...getApplicationErrorLogMetadata(result.incident),
    ...(result.payload ? { sessionId: result.payload.sessionId } : {}),
  })
  if (typeof log === 'function') {
    try {
      log(result.incident.severity, 'shell_session_one_way_failed', metadata)
    } catch {
      // Il logging non deve sostituire o duplicare l’incidente originale.
    }
  }
  if (result.payload && typeof send === 'function') {
    try {
      send(SHELL_SESSION_ERROR_CHANNEL, result.payload)
    } catch {
      if (typeof log === 'function') {
        try { log('warning', 'shell_session_error_delivery_failed', metadata) } catch { /* Il PTY resta isolato. */ }
      }
    }
  }
  return result
}

module.exports = {
  SHELL_SESSION_ERROR_CHANNEL,
  createShellSessionErrorEvent,
  reportShellSessionOneWayFailure,
}
