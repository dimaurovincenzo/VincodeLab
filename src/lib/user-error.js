const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': Error:\s*/u
const PUBLIC_ERROR_CODE = /\s*\[([A-Z][A-Z0-9_]{2,63})\]\s*$/u
const PUBLIC_CORRELATION_ID = /\s*\[(ERR-[A-F0-9]{6})\]\s*$/u
const CORRELATION_ID = /^ERR-[A-F0-9]{6}$/u
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u
const SAFE_CONTEXT = /^[a-zA-Z0-9_.:/-]{1,96}$/u
const MAX_TEXT_LENGTH = 2_000
const SAFE_TECHNICAL_NAMES = new Set([
  'AggregateError',
  'DOMException',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
])
const SAFE_TECHNICAL_CODES = new Set([
  'ABORT_ERR',
  'EACCES',
  'EAI_AGAIN',
  'EBUSY',
  'ECANCELED',
  'ECANCELLED',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EEXIST',
  'EHOSTUNREACH',
  'EINVAL',
  'EISDIR',
  'EMFILE',
  'ENAMETOOLONG',
  'ENETDOWN',
  'ENETUNREACH',
  'ENFILE',
  'ENOENT',
  'ENOSPC',
  'ENOTDIR',
  'ENOTFOUND',
  'EPERM',
  'EPIPE',
  'EROFS',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'ERR_ABORTED',
  'ERR_CANCELED',
  'ERR_CANCELLED',
  'SQLITE_BUSY',
  'SQLITE_CONSTRAINT',
  'SQLITE_INTERRUPT',
  'SQLITE_LOCKED',
  'SQLITE_READONLY',
])

export const USER_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'not-found',
  'permission',
  'authentication',
  'network',
  'timeout',
  'cancelled',
  'conflict',
  'process',
  'database',
  'filesystem',
  'git',
  'github',
  'remote',
  'configuration',
  'persistence',
  'internal',
])

const CATEGORY_TITLES = Object.freeze({
  validation: 'Controlla i dati inseriti',
  'not-found': 'Risorsa non disponibile',
  permission: 'Permesso necessario',
  authentication: 'Accesso richiesto',
  network: 'Connessione non disponibile',
  timeout: 'Tempo di attesa superato',
  cancelled: 'Operazione annullata',
  conflict: 'Modifiche in conflitto',
  process: 'Processo non disponibile',
  database: 'Problema con il database',
  filesystem: 'Problema con il file',
  git: 'Operazione Git non completata',
  github: 'Operazione GitHub non completata',
  remote: 'Risorsa remota non disponibile',
  configuration: 'Configurazione da completare',
  persistence: 'Preferenze non salvate',
  internal: 'Questa vista ha avuto un problema',
})

const errorCorrelationIds = new WeakMap()
const normalizedUserErrors = new WeakSet()
let fallbackCorrelationSequence = 0

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function safeProperty(value, key) {
  if (!isObjectLike(value)) return undefined
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().replace(/\s+/gu, ' ')
  return normalized.slice(0, MAX_TEXT_LENGTH) || fallback
}

function safeContext(value) {
  const normalized = normalizeText(value)
  return SAFE_CONTEXT.test(normalized) ? normalized : undefined
}

function safeCode(value) {
  const normalized = normalizeText(value).toUpperCase()
  return SAFE_CODE.test(normalized) ? normalized : undefined
}

function rawErrorMessage(error) {
  if (typeof error === 'string') return normalizeText(error)
  return normalizeText(safeProperty(error, 'message'))
}

function withoutIpcContext(message) {
  return message.replace(IPC_ERROR_PREFIX, '').trim()
}

function parsedPublicMessage(message) {
  const rawMessage = withoutIpcContext(message)
  const correlationMatch = rawMessage.match(PUBLIC_CORRELATION_ID)
  const withoutCorrelation = rawMessage.replace(PUBLIC_CORRELATION_ID, '')
  const match = withoutCorrelation.match(PUBLIC_ERROR_CODE)
  return {
    code: safeCode(match?.[1]),
    correlationId: correlationMatch?.[1],
    message: normalizeText(withoutCorrelation.replace(PUBLIC_ERROR_CODE, '')),
  }
}

function structuredPublicErrorData(error) {
  if (!isObjectLike(error)) return undefined
  if (normalizedUserErrors.has(error)) {
    return {
      code: safeCode(safeProperty(error, 'code')),
      correlationId: CORRELATION_ID.test(safeProperty(error, 'correlationId') ?? '')
        ? safeProperty(error, 'correlationId')
        : undefined,
      message: normalizeText(safeProperty(error, 'description')),
    }
  }

  const category = safeProperty(error, 'category')
  const code = safeCode(safeProperty(error, 'code'))
  const correlationId = safeProperty(error, 'correlationId')
  const message = normalizeText(safeProperty(error, 'message'))
  const recoverable = safeProperty(error, 'recoverable')
  const severity = safeProperty(error, 'severity')
  if (!USER_ERROR_CATEGORIES.includes(category)
    || !code
    || !CORRELATION_ID.test(correlationId ?? '')
    || typeof recoverable !== 'boolean'
    || !['info', 'warning', 'error'].includes(severity)) return undefined

  const parsed = parsedPublicMessage(message)
  if (parsed.code !== code || parsed.correlationId !== correlationId || !parsed.message) return undefined
  if (sanitizeDiagnosticText(parsed.message) !== parsed.message) return undefined
  return { code, correlationId, message: parsed.message }
}

function publicErrorData(error) {
  const parsed = parsedPublicMessage(rawErrorMessage(error))
  const structured = structuredPublicErrorData(error)
  const propertyCorrelationId = safeProperty(error, 'correlationId')
  return {
    classificationCode: structured?.code ?? parsed.code,
    code: structured?.code,
    correlationId: structured?.correlationId
      ?? parsed.correlationId
      ?? (CORRELATION_ID.test(propertyCorrelationId ?? '') ? propertyCorrelationId : undefined),
    message: structured?.message ?? parsed.message,
    trusted: Boolean(structured),
  }
}

function isCancellation(error, code, message) {
  const errorName = normalizeText(safeProperty(error, 'name')).toLowerCase()
  const technicalCode = normalizeText(safeProperty(error, 'code')).toUpperCase()
  const publicCode = normalizeText(code).toUpperCase()
  if (['aborterror', 'cancelederror', 'cancellederror'].includes(errorName)) return true
  if (['ABORT_ERR', 'ECANCELED', 'ECANCELLED', 'ERR_ABORTED', 'ERR_CANCELED', 'ERR_CANCELLED'].includes(technicalCode)) return true
  if (/(?:^|_)(?:ABORTED|CANCELED|CANCELLED)(?:_|$)/u.test(publicCode)) return true

  const normalized = normalizeText(message).toLowerCase()
  if (/^(?:aborted|canceled|cancelled|annullat[aoe])\s*[.!]?$/u.test(normalized)) return true
  if (/\b(?:the\s+|this\s+)?(?:operation|request|query|transfer|download|upload|process)\s+(?:(?:was|has been)\s+)?(?:aborted|canceled|cancelled)\b/u.test(normalized)) return true
  if (/\b(?:operazione|richiesta|query|trasferimento|download|caricamento|processo)\s+(?:(?:è|e)\s+stat[ao]\s+)?annullat[aoe]\b/u.test(normalized)) return true
  return /\b(?:user\s+(?:aborted|canceled|cancelled)|utente\s+ha\s+annullato)\b/u.test(normalized)
}

function categoryFrom(error, code, context) {
  const errorName = normalizeText(safeProperty(error, 'name'))
  const technicalCode = normalizeText(safeProperty(error, 'code'))
  const rawMessage = rawErrorMessage(error)
  const searchable = `${errorName} ${technicalCode} ${code ?? ''} ${rawMessage} ${context ?? ''}`.toLowerCase()

  if (isCancellation(error, code, rawMessage)) return 'cancelled'
  if (/auth|credential|login|token.*(?:expired|missing|invalid)|unauthoriz/u.test(searchable)) return 'authentication'
  if (/permission|forbidden|scope|eacces|eperm|read.only/u.test(searchable)) return 'permission'
  if (/timeout|timed out|etimedout|deadline/u.test(searchable)) return 'timeout'
  if (/conflict|already exists|stale|out.of.date|eexist|merge/u.test(searchable)) return 'conflict'
  if (/not.found|missing|enoent|does not exist|inesistent/u.test(searchable)) return 'not-found'
  if (/network|offline|econn|enet|ehost|dns|socket|rate.?limit|too many requests/u.test(searchable)) return 'network'
  if (/validat|invalid|malformed|parse|syntax|unsupported|non valid/u.test(searchable)) return 'validation'
  if (/github|gh_/u.test(searchable)) return 'github'
  if (/(?:^|\W)git(?:\W|$)|repository|branch|commit|checkout|detached/u.test(searchable)) return 'git'
  if (/database|sqlite|postgres|mysql|sql server|query|constraint|db_/u.test(searchable)) return 'database'
  if (/sftp|ssh|remote|host key|transfer/u.test(searchable)) return 'remote'
  if (/file|directory|folder|workspace|filesystem|fs_/u.test(searchable)) return 'filesystem'
  if (/config|preference|setting|environment/u.test(searchable)) return 'configuration'
  if (/persist|session|cache|store|hydrate/u.test(searchable)) return 'persistence'
  if (/process|pty|shell|subprocess|executable|spawn|pi_/u.test(searchable)) return 'process'
  return 'internal'
}

function severityFor(category) {
  if (category === 'cancelled') return 'info'
  if (category === 'validation' || category === 'conflict' || category === 'configuration') return 'warning'
  return 'error'
}

function randomHex(length) {
  const bytes = new Uint8Array(Math.ceil(length / 2))
  globalThis.crypto?.getRandomValues?.(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length).toUpperCase()
}

export function createErrorCorrelationId() {
  try {
    const random = randomHex(6)
    if (random.length === 6 && random !== '000000') return `ERR-${random}`
  } catch {
    // La generazione casuale è una comodità diagnostica: il fallback resta un ID valido e locale.
  }

  fallbackCorrelationSequence = (fallbackCorrelationSequence + 1) % 0xFFFFFF
  const value = (Date.now() + fallbackCorrelationSequence).toString(16).slice(-6).padStart(6, '0').toUpperCase()
  return `ERR-${value}`
}

function correlationIdFor(error, requestedId) {
  if (CORRELATION_ID.test(requestedId ?? '')) return requestedId
  if (isObjectLike(error)) {
    const existing = errorCorrelationIds.get(error)
    if (existing) return existing
    const created = createErrorCorrelationId()
    errorCorrelationIds.set(error, created)
    return created
  }
  return createErrorCorrelationId()
}

export function sanitizeDiagnosticText(value) {
  return normalizeText(value)
    .replace(/([?&#](?:access_token|auth|authorization|api[-_]?key|cookie|password|passwd|secret|token)=)[^&#\s]+/giu, '$1[REDACTED]')
    .replace(/\b(password|passwd|pwd|access[-_ ]?token|auth(?:orization)?|cookie|secret|api[-_ ]?key|token)\b(?:\s*[:=]\s*|\s+(?:is\s+)?)([^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[AUTH REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu, '$1[USER REDACTED]@')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[EMAIL REDACTED]')
    .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders|opt|etc|srv|mnt)(?:\/[^\s"'|)\]]*)?/gu, '[PATH REDACTED]')
    .replace(/[A-Z]:\\(?:[^\s"']+\\)*[^\s"']*/giu, '[PATH REDACTED]')
    .replace(/\b(?:gh[opusr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/giu, '[TOKEN REDACTED]')
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}(?:\.[a-z0-9_-]{8,})?\b/giu, '[TOKEN REDACTED]')
    .replace(/\b(?:params?|parameters?|bindings?|bind\s+values?|sql\s+values?)\b\s*[:=]\s*[\s\S]*$/giu, 'parameters=[REDACTED]')
    .replace(/\b(?:select|insert|update|delete|merge|create|alter|drop|truncate)\b[\s\S]*$/iu, '[QUERY REDACTED]')
    .slice(0, MAX_TEXT_LENGTH)
}

function technicalMessageFor(error) {
  const name = normalizeText(safeProperty(error, 'name'))
  const code = normalizeText(safeProperty(error, 'code')).toUpperCase()
  const details = []
  if (SAFE_TECHNICAL_NAMES.has(name)) details.push(`Tipo: ${name}`)
  if (SAFE_TECHNICAL_CODES.has(code)) details.push(`Codice tecnico: ${code}`)
  return details.join('; ') || 'Dettaglio tecnico omesso per proteggere i dati.'
}

export function normalizeUserError(error, options = {}) {
  const publicData = publicErrorData(error)
  const explicitCategory = USER_ERROR_CATEGORIES.includes(options.category) ? options.category : undefined
  const component = safeContext(options.component)
  const operation = safeContext(options.operation)
  const category = explicitCategory ?? categoryFrom(error, publicData.classificationCode, `${component ?? ''} ${operation ?? ''}`)
  const fallbackDescription = normalizeText(options.fallbackDescription, 'Riprova. Se il problema continua, copia la diagnostica.')
  const trustedDescription = publicData.trusted ? publicData.message : ''
  const description = normalizeText(options.description, trustedDescription || fallbackDescription)
  const title = normalizeText(options.title, CATEGORY_TITLES[category])
  const technicalMessage = technicalMessageFor(error)

  const normalized = Object.freeze({
    category,
    code: safeCode(options.code) ?? publicData.code,
    component,
    correlationId: correlationIdFor(error, options.correlationId ?? publicData.correlationId),
    description,
    operation,
    recoverable: options.recoverable !== false,
    severity: ['info', 'warning', 'error'].includes(options.severity) ? options.severity : severityFor(category),
    technicalMessage,
    timestamp: typeof options.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(options.timestamp)
      ? options.timestamp
      : new Date().toISOString(),
    title,
  })
  normalizedUserErrors.add(normalized)
  return normalized
}

export function userErrorMessage(error, fallback) {
  const publicData = publicErrorData(error)
  return publicData.trusted ? publicData.message : fallback
}

export function userErrorDiagnostic(userError) {
  const trusted = isObjectLike(userError) && normalizedUserErrors.has(userError)
  const correlationId = safeProperty(userError, 'correlationId')
  const category = safeProperty(userError, 'category')
  const timestamp = safeProperty(userError, 'timestamp')
  const lines = [
    `Riferimento: ${trusted && CORRELATION_ID.test(correlationId ?? '') ? correlationId : 'non disponibile'}`,
    `Categoria: ${trusted && USER_ERROR_CATEGORIES.includes(category) ? category : 'internal'}`,
    `Data: ${trusted && typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(timestamp) ? timestamp : 'non disponibile'}`,
  ]
  const code = trusted ? safeCode(safeProperty(userError, 'code')) : undefined
  const component = trusted ? safeContext(safeProperty(userError, 'component')) : undefined
  const operation = trusted ? safeContext(safeProperty(userError, 'operation')) : undefined
  if (code) lines.push(`Codice: ${code}`)
  if (component) lines.push(`Componente: ${component}`)
  if (operation) lines.push(`Operazione: ${operation}`)
  lines.push(`Dettaglio: ${trusted ? sanitizeDiagnosticText(safeProperty(userError, 'technicalMessage')) || 'Dettaglio non disponibile' : 'Dettaglio non disponibile'}`)
  return lines.join('\n')
}

export function reportUserError(userError) {
  const trusted = isObjectLike(userError) && normalizedUserErrors.has(userError)
  const category = safeProperty(userError, 'category')
  const severity = safeProperty(userError, 'severity')
  const event = {
    event: 'renderer_user_error',
    category: trusted && USER_ERROR_CATEGORIES.includes(category) ? category : 'internal',
    code: trusted ? safeCode(safeProperty(userError, 'code')) : undefined,
    component: trusted ? safeContext(safeProperty(userError, 'component')) : undefined,
    correlationId: trusted && CORRELATION_ID.test(safeProperty(userError, 'correlationId') ?? '')
      ? safeProperty(userError, 'correlationId')
      : createErrorCorrelationId(),
    operation: trusted ? safeContext(safeProperty(userError, 'operation')) : undefined,
    severity: trusted && ['info', 'warning', 'error'].includes(severity) ? severity : 'error',
  }
  console.error(JSON.stringify(event))
  return userError
}
