const PUBLIC_ERROR = Symbol('vincodelab.public-error')
const PUBLIC_ERRORS = new WeakSet()
const DEFAULT_CODE = 'OPERATION_FAILED'
const DEFAULT_MESSAGE = 'Impossibile completare la richiesta.'
const MAX_MESSAGE_LENGTH = 320
const CORRELATION_ID_PATTERN = /^ERR-[A-F0-9]{6}$/u

const SYSTEM_HINTS = new Map([
  ['EACCES', 'Verifica i permessi e riprova.'],
  ['EPERM', 'Verifica i permessi e riprova.'],
  ['ENOSPC', 'Lo spazio disponibile non e sufficiente.'],
  ['ETIMEDOUT', 'La richiesta ha superato il tempo disponibile.'],
  ['ECONNABORTED', 'La connessione e stata interrotta.'],
  ['ECONNREFUSED', 'La connessione non e disponibile.'],
  ['ECONNRESET', 'La connessione e stata interrotta.'],
  ['EHOSTUNREACH', 'La destinazione non e raggiungibile.'],
  ['ENETUNREACH', 'La rete non e raggiungibile.'],
])

function normalizeCode(value, fallback = DEFAULT_CODE) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(value) ? value : fallback
}

function safeProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

function sanitizeAuthoredMessage(value, fallback = DEFAULT_MESSAGE) {
  if (typeof value !== 'string') return fallback
  const withoutControls = [...value.slice(0, MAX_MESSAGE_LENGTH * 4)]
    .map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character)
    .join('')
  const message = withoutControls
    .replace(/\s+/g, ' ')
    .trim()
  if (!message) return fallback
  return message.slice(0, MAX_MESSAGE_LENGTH)
}

function normalizeCorrelationId(value) {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value) ? value : null
}

function correlationIdFromOptions(options) {
  if (!options || typeof options !== 'object') return null
  try {
    if (Array.isArray(options)) return null
    const prototype = Object.getPrototypeOf(options)
    if (prototype !== Object.prototype && prototype !== null) return null
  } catch {
    return null
  }
  return normalizeCorrelationId(safeProperty(options, 'correlationId'))
}

function formatMessage(message, code, correlationId) {
  const normalizedCode = normalizeCode(code)
  const normalizedMessage = sanitizeAuthoredMessage(message)
  const normalizedCorrelationId = normalizeCorrelationId(correlationId)
  return `${normalizedMessage} [${normalizedCode}]${normalizedCorrelationId ? ` [${normalizedCorrelationId}]` : ''}`
}

function isPublicError(error) {
  return Boolean(error && typeof error === 'object' && PUBLIC_ERRORS.has(error))
}

function createPublicError(code, message, options = {}) {
  const publicCode = normalizeCode(code)
  const publicMessage = sanitizeAuthoredMessage(message)
  const correlationId = correlationIdFromOptions(options)
  const error = new Error(formatMessage(publicMessage, publicCode, correlationId))
  error.code = publicCode
  Object.defineProperties(error, {
    [PUBLIC_ERROR]: { value: true },
    publicCode: { value: publicCode },
    publicMessage: { value: publicMessage },
    ...(correlationId ? { correlationId: { value: correlationId } } : {}),
  })
  PUBLIC_ERRORS.add(error)
  return error
}

function getPublicErrorCorrelationId(error) {
  if (!isPublicError(error)) return null
  return normalizeCorrelationId(safeProperty(error, 'correlationId'))
}

function ensurePublicErrorCorrelation(error, correlationId) {
  if (!isPublicError(error)) return error
  if (getPublicErrorCorrelationId(error)) return error
  const normalizedCorrelationId = normalizeCorrelationId(correlationId)
  if (!normalizedCorrelationId) return error
  const publicMessage = safeProperty(error, 'publicMessage')
  const publicCode = safeProperty(error, 'publicCode')
  try {
    Object.defineProperty(error, 'correlationId', { value: normalizedCorrelationId })
    error.message = formatMessage(publicMessage, publicCode, normalizedCorrelationId)
  } catch {
    // Un errore pubblico congelato o alterato resta utilizzabile senza correlation.
  }
  return error
}

function systemHint(error) {
  const name = safeProperty(error, 'name')
  const code = safeProperty(error, 'code')
  if (name === 'AbortError' || code === 'ABORT_ERR') return 'Operazione annullata.'
  return SYSTEM_HINTS.get(code) ?? null
}

function toPublicError(error, options = {}) {
  if (isPublicError(error)) return error
  const code = safeProperty(options, 'code') ?? DEFAULT_CODE
  const message = safeProperty(options, 'message') ?? DEFAULT_MESSAGE
  const hint = systemHint(error)
  const authoredMessage = hint ? `${sanitizeAuthoredMessage(message)} ${hint}` : message
  return createPublicError(code, authoredMessage)
}

function toPublicErrorMessage(error, options) {
  const publicError = toPublicError(error, options)
  const message = safeProperty(publicError, 'message')
  if (typeof message === 'string') return message
  return formatMessage(
    safeProperty(publicError, 'publicMessage'),
    safeProperty(publicError, 'publicCode'),
    getPublicErrorCorrelationId(publicError),
  )
}

module.exports = {
  createPublicError,
  ensurePublicErrorCorrelation,
  getPublicErrorCorrelationId,
  isPublicError,
  toPublicError,
  toPublicErrorMessage,
}
