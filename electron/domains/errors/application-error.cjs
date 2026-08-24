const { createHash, randomBytes } = require('node:crypto')

const {
  createPublicError,
  ensurePublicErrorCorrelation,
  getPublicErrorCorrelationId,
  isPublicError,
} = require('./public-error.cjs')

const APPLICATION_ERROR = Symbol('vincodelab.application-error')
const CORRELATION_ID_PATTERN = /^ERR-[A-F0-9]{6}$/u
const SAFE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/u
const SAFE_CONTEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/u
const SAFE_TECHNICAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{0,63}$/u
const MAX_TECHNICAL_DETAIL_LENGTH = 256
const PRIVATE_DIAGNOSTICS = new WeakMap()
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

const APPLICATION_ERROR_CATEGORIES = Object.freeze([
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
const APPLICATION_ERROR_SEVERITIES = Object.freeze(['info', 'warning', 'error'])
const CATEGORY_SET = new Set(APPLICATION_ERROR_CATEGORIES)
const SEVERITY_SET = new Set(APPLICATION_ERROR_SEVERITIES)

const GIT_CHANNEL_OPERATIONS = new Set([
  'addRemote',
  'branches',
  'commit',
  'createBranch',
  'fetch',
  'fileDiff',
  'gitStatus',
  'initRepository',
  'pullRebase',
  'push',
  'revert',
  'stage',
  'switchBranch',
  'unstage',
])

const DOMAIN_CODE_PREFIX = Object.freeze({
  ai: 'AI',
  configuration: 'CONFIGURATION',
  database: 'DATABASE',
  filesystem: 'FILESYSTEM',
  git: 'GIT',
  github: 'GITHUB',
  internal: 'OPERATION',
  persistence: 'PERSISTENCE',
  redis: 'REDIS',
  remote: 'REMOTE',
  terminal: 'TERMINAL',
  update: 'UPDATE',
  workspace: 'WORKSPACE',
})
const DOMAIN_SET = new Set(Object.keys(DOMAIN_CODE_PREFIX))

const CATEGORY_CODE_SUFFIX = Object.freeze({
  authentication: 'AUTHENTICATION_REQUIRED',
  cancelled: 'CANCELLED',
  conflict: 'CONFLICT',
  network: 'NETWORK_UNAVAILABLE',
  'not-found': 'NOT_FOUND',
  permission: 'PERMISSION_DENIED',
  timeout: 'TIMEOUT',
  validation: 'INVALID',
})

const CHANNEL_MESSAGES = Object.freeze({
  'database:begin': 'Impossibile avviare la transazione.',
  'database:commit': 'Impossibile confermare la transazione.',
  'database:createConnection': 'Impossibile salvare la connessione al database.',
  'database:execute': 'Impossibile completare la query.',
  'database:inspectSchema': 'Impossibile leggere lo schema del database.',
  'database:rollback': 'Impossibile annullare la transazione.',
  'database:tableRows': 'Impossibile leggere i dati della tabella.',
  'redis:createConnection': 'Impossibile salvare la connessione Redis.',
  'redis:deleteConnection': 'Impossibile eliminare la connessione Redis.',
  'redis:listConnections': 'Impossibile leggere le connessioni Redis.',
  'redis:readKey': 'Impossibile leggere la chiave Redis.',
  'redis:reconnect': 'Impossibile riconnettere Redis.',
  'redis:scanKeys': 'Impossibile aggiornare le chiavi Redis.',
  'redis:searchPayloads': 'Impossibile completare la ricerca nei dati Redis.',
  'redis:testConnection': 'Impossibile verificare la connessione Redis.',
  'redis:updateConnection': 'Impossibile aggiornare la connessione Redis.',
  'files:create': 'Impossibile creare il file.',
  'files:index': 'Impossibile aggiornare l’indice dei file.',
  'files:list': 'Impossibile leggere i file del workspace.',
  'files:listDirectory': 'Impossibile leggere la cartella.',
  'files:preview': 'Impossibile generare l’anteprima del file.',
  'files:read': 'Impossibile leggere il file.',
  'files:save': 'Impossibile salvare il file.',
  'github:addRemote': 'Impossibile collegare il repository remoto.',
  'github:branches': 'Impossibile leggere i branch Git.',
  'github:commit': 'Impossibile creare il commit.',
  'github:createBranch': 'Impossibile creare il branch Git.',
  'github:createIssue': 'Impossibile creare la issue GitHub.',
  'github:createRepository': 'Impossibile creare il repository GitHub.',
  'github:data': 'Impossibile aggiornare i dati GitHub.',
  'github:fetch': 'Impossibile aggiornare i riferimenti remoti.',
  'github:fileDiff': 'Impossibile leggere le modifiche del file.',
  'github:gitStatus': 'Impossibile leggere lo stato Git.',
  'github:initRepository': 'Impossibile inizializzare il repository Git.',
  'github:pullRebase': 'Impossibile integrare le modifiche remote.',
  'github:push': 'Impossibile inviare le modifiche al repository remoto.',
  'github:stage': 'Impossibile preparare i file per il commit.',
  'github:switchBranch': 'Impossibile cambiare branch Git.',
  'github:unstage': 'Impossibile rimuovere i file dalla preparazione del commit.',
  'managedSsh:check': 'Impossibile verificare la connessione remota.',
  'pi:reload': 'Impossibile ricaricare la sessione AI.',
  'pi:restart': 'Impossibile riavviare la sessione AI.',
  'preferences:get': 'Impossibile leggere le impostazioni.',
  'preferences:setGlobal': 'Impossibile salvare le impostazioni.',
  'preferences:setWorkspace': 'Impossibile salvare le impostazioni del workspace.',
  'remoteFiles:browse': 'Impossibile leggere la cartella remota.',
  'remoteFiles:compare': 'Impossibile confrontare il file remoto.',
  'remoteFiles:createDirectory': 'Impossibile creare la cartella remota.',
  'remoteFiles:downloadAndTrack': 'Impossibile scaricare il file remoto.',
  'remoteFiles:downloadAs': 'Impossibile scaricare il file remoto.',
  'remoteFiles:read': 'Impossibile leggere il file remoto.',
  'remoteFiles:remove': 'Impossibile eliminare la risorsa remota.',
  'remoteFiles:rename': 'Impossibile rinominare la risorsa remota.',
  'remoteFiles:upload': 'Impossibile caricare il file remoto.',
  'shellSessions:create': 'Impossibile avviare il terminale.',
  'shellSessions:restart': 'Impossibile riavviare il terminale.',
  'systemSkills:create': 'Impossibile creare la skill Pi.',
  'systemSkills:delete': 'Impossibile eliminare la skill Pi.',
  'systemSkills:get': 'Impossibile leggere la skill Pi.',
  'systemSkills:list': 'Impossibile leggere le skill Pi.',
  'systemSkills:update': 'Impossibile salvare la skill Pi.',
  'terminal:exportDiagnostics': 'Impossibile esportare la diagnostica del terminale.',
  'terminal:resume': 'Impossibile ripristinare la sessione del terminale.',
  'updates:activatePending': 'Impossibile attivare l’aggiornamento.',
  'updates:check': 'Impossibile controllare gli aggiornamenti.',
  'updates:download': 'Impossibile scaricare l’aggiornamento.',
  'updates:downloadAll': 'Impossibile scaricare gli aggiornamenti.',
  'updates:rollback': 'Impossibile ripristinare la versione precedente.',
  'workspace:open': 'Impossibile aprire il workspace.',
  'workspace:openInNewInstance': 'Impossibile aprire il workspace in una nuova finestra.',
  'workspace:openRecent': 'Impossibile riaprire il workspace.',
  'workspaceSession:get': 'Impossibile ripristinare la sessione del workspace.',
  'workspaceSession:save': 'Impossibile salvare la sessione del workspace.',
})

let fallbackCorrelationSequence = 0

function safeContext(value, fallback) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return SAFE_CONTEXT_PATTERN.test(normalized) ? normalized : fallback
}

function safeCode(value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return SAFE_CODE_PATTERN.test(normalized) ? normalized : null
}

function createCorrelationId() {
  try {
    const value = randomBytes(3).toString('hex').toUpperCase()
    if (value !== '000000') return `ERR-${value}`
  } catch {
    // Un riferimento diagnostico non deve impedire la gestione dell'errore.
  }
  fallbackCorrelationSequence = (fallbackCorrelationSequence + 1) % 0xFFFFFF
  const value = (Date.now() + fallbackCorrelationSequence).toString(16).slice(-6).padStart(6, '0').toUpperCase()
  return `ERR-${value}`
}

function operationFromIpcChannel(channel) {
  const safeChannel = safeContext(channel, 'operation')
  const separator = safeChannel.indexOf(':')
  return separator >= 0 ? safeChannel.slice(separator + 1) || 'operation' : safeChannel
}

function domainFromIpcChannel(channel) {
  const safeChannel = safeContext(channel, '')
  const [namespace, operation = ''] = safeChannel.split(':', 2)
  if (namespace === 'database') return 'database'
  if (namespace === 'redis') return 'redis'
  if (namespace === 'github') return GIT_CHANNEL_OPERATIONS.has(operation) ? 'git' : 'github'
  if (namespace === 'remoteFiles' || namespace === 'managedSsh') return 'remote'
  if (namespace === 'files' || namespace === 'instructions' || namespace === 'skills' || namespace === 'systemSkills') return 'filesystem'
  if (namespace === 'workspace') return 'workspace'
  if (namespace === 'workspaceSession' || namespace === 'volatileDrafts') return 'persistence'
  if (namespace === 'terminal' || namespace === 'shellSessions' || namespace === 'workspaceCommands') return 'terminal'
  if (namespace === 'pi') return 'ai'
  if (namespace === 'piConfig' || namespace === 'piSystem' || namespace === 'runtime' || namespace === 'appearance' || namespace === 'preferences') return 'configuration'
  if (namespace === 'updates') return 'update'
  return 'internal'
}

function fallbackCategoryForDomain(domain) {
  if (domain === 'database' || domain === 'git' || domain === 'github' || domain === 'filesystem' || domain === 'persistence') return domain
  if (domain === 'redis') return 'database'
  if (domain === 'remote') return 'remote'
  if (domain === 'configuration') return 'configuration'
  if (domain === 'terminal' || domain === 'ai' || domain === 'update') return 'process'
  if (domain === 'workspace') return 'filesystem'
  return 'internal'
}

function safeProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}

function errorSignals(error) {
  const signals = []
  const visited = new Set()
  let current = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object' && !visited.has(current); depth += 1) {
    visited.add(current)
    for (const key of ['name', 'code', 'errno', 'type', 'status', 'statusCode', 'message']) {
      const value = safeProperty(current, key)
      if (typeof value === 'string' || typeof value === 'number') signals.push(String(value).slice(0, 1_024))
    }
    current = safeProperty(current, 'cause')
  }
  if (typeof error === 'string') signals.push(error.slice(0, 1_024))
  return signals.join(' ').toLowerCase()
}

function safeTechnicalName(value, fallback) {
  return typeof value === 'string' && SAFE_TECHNICAL_NAMES.has(value) ? value : fallback
}

function safeTechnicalCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim().toUpperCase()
  return SAFE_TECHNICAL_CODE_PATTERN.test(normalized) ? normalized : null
}

function sanitizeTechnicalDetail(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const withoutControlCharacters = [...value.slice(0, 4_096)]
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 0x1F || codePoint === 0x7F) ? ' ' : character
    })
    .join('')
  const sanitized = withoutControlCharacters
    .replace(/\b(password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]\s*([^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[AUTH REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu, '$1[USER REDACTED]@')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[EMAIL REDACTED]')
    .replace(/\/(?:Users|home|tmp|private\/tmp|var\/folders|opt|etc|srv|mnt)(?:\/[^\s"'|)\]]*)?/gu, '[PATH REDACTED]')
    .replace(/[A-Z]:\\(?:[^\s"']+\\)*[^\s"']*/giu, '[PATH REDACTED]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/gu, '[HOST REDACTED]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/giu, '[HOST REDACTED]')
    .replace(/\b(?:select|insert|update|delete|merge|create|alter|drop|truncate)\b[\s\S]*/iu, '[QUERY REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
  return sanitized ? sanitized.slice(0, MAX_TECHNICAL_DETAIL_LENGTH) : null
}

function createPrivateDiagnostics(error, classification, options = {}) {
  const technicalName = safeTechnicalName(safeProperty(error, 'name'), typeof error === 'string' ? 'ThrownString' : 'Error')
  const technicalCode = ['code', 'errno', 'statusCode', 'status']
    .map((key) => safeTechnicalCode(safeProperty(error, key)))
    .find(Boolean) ?? null
  const requestedTechnicalDetail = safeProperty(options, 'technicalDiagnostic')
  const technicalDetail = sanitizeTechnicalDetail(
    requestedTechnicalDetail === undefined ? safeProperty(error, 'databaseDiagnostic') : requestedTechnicalDetail,
  )
  const fingerprintSignal = errorSignals(error).replace(/err-[a-f0-9]{6}/giu, 'err-reference')
  const fingerprintSource = [
    classification.domain,
    classification.operation,
    technicalName,
    technicalCode ?? '',
    fingerprintSignal,
    technicalDetail ?? '',
  ].join('|')
  const fingerprint = `FP-${createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 12).toUpperCase()}`
  return Object.freeze({
    fingerprint,
    ...(technicalCode ? { technicalCode } : {}),
    ...(technicalDetail ? { technicalDetail } : {}),
    technicalName,
  })
}

function classifyCategory(error, domain, explicitCategory) {
  if (CATEGORY_SET.has(explicitCategory)) return explicitCategory
  const publicCode = isPublicError(error) ? safeCode(safeProperty(error, 'publicCode')) : null
  if (publicCode?.endsWith('_ALREADY_EXISTS')) return 'conflict'
  if (publicCode?.endsWith('_INVALID')) return 'validation'
  const signal = errorSignals(error)

  if (/aborterror|abort_err|err_(?:canceled|cancelled)|cancel(?:ing|led|ed)|annullat|\b57014\b/u.test(signal)) return 'cancelled'
  if (/timeouterror|etimedout|esockettimedout|err_.*timeout|timed?\s*out|timeout|deadline/u.test(signal)) return 'timeout'
  if (/\b401\b|(?:^|[_\W])auth(?:entication)?(?:[_\W]|$)|unauthori[sz]ed|invalid credentials|credentiali non valide|login failed|login required|access denied for user|permission denied \((?:publickey|password)|token (?:expired|invalid|missing)|not logged|\b28p01\b/u.test(signal)) return 'authentication'
  if (/eacces|eperm|erofs|\b403\b|permission denied|forbidden|read.?only|scope required|accesso negato|permess/u.test(signal)) return 'permission'
  if (/eexist|ebusy|\b409\b|conflict|merge conflict|already exists|duplicate entry|unique constraint|sqlite_constraint|\b23505\b|stale|out.of.date|modificat. esternamente/u.test(signal)) return 'conflict'
  if (/enoent|enotdir|\b404\b|not found|does not exist|no such file|inesistent|non (?:esiste|trovato|disponibile)/u.test(signal)) return 'not-found'
  if (/econn|enet|ehost|eai_again|enotfound|epipe|getaddrinfo|dns|network|offline|socket hang up|connection (?:lost|closed|refused|reset)|rate.?limit|too many requests|\b429\b|rete|connessione interrotta/u.test(signal)) return 'network'
  if (/einval|enametoolong|validation|malformed|parse\s*error|syntax\s*error|invalid (?:input|argument|format)|non valid|unsupported/u.test(signal)) return 'validation'
  return fallbackCategoryForDomain(domain)
}

function severityForCategory(category, requestedSeverity) {
  if (SEVERITY_SET.has(requestedSeverity)) return requestedSeverity
  if (category === 'cancelled') return 'info'
  if (category === 'validation' || category === 'conflict' || category === 'configuration') return 'warning'
  return 'error'
}

function generatedCode(domain, operation, category) {
  const domainCode = DOMAIN_CODE_PREFIX[domain] ?? 'OPERATION'
  const operationCode = operation
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toUpperCase()
    .slice(0, 28)
  const suffix = CATEGORY_CODE_SUFFIX[category] ?? 'FAILED'
  return safeCode(`${domainCode}_${operationCode || 'OPERATION'}_${suffix}`) ?? `${domainCode}_OPERATION_FAILED`
}

function fallbackMessage(domain, operation) {
  if (/^(?:create|start|begin|init)/u.test(operation)) return 'Impossibile avviare la richiesta.'
  if (/^(?:read|get|list|browse|inspect|preview|status)/u.test(operation)) return 'Impossibile leggere i dati richiesti.'
  if (/^(?:save|set|update|edit|write)/u.test(operation)) return 'Impossibile salvare le modifiche.'
  if (/^(?:delete|remove|discard|clear)/u.test(operation)) return 'Impossibile eliminare la risorsa.'
  if (/^(?:open|resume|reload|restart)/u.test(operation)) return 'Impossibile ripristinare questa funzione.'
  if (domain === 'database') return 'Il database non ha completato la richiesta.'
  if (domain === 'redis') return 'Redis non ha completato la richiesta.'
  if (domain === 'git') return 'Git non ha completato la richiesta.'
  if (domain === 'github') return 'GitHub non ha completato la richiesta.'
  if (domain === 'remote') return 'La risorsa remota non ha completato la richiesta.'
  if (domain === 'terminal') return 'Il terminale non ha completato la richiesta.'
  if (domain === 'ai') return 'La sessione AI non ha completato la richiesta.'
  if (domain === 'workspace') return 'Il workspace non ha completato la richiesta.'
  return 'Questa funzione ha incontrato un problema.'
}

function categoryAdvice(category, domain, signal) {
  if (category === 'cancelled') return 'Operazione annullata.'
  if (category === 'timeout') return 'Il tempo disponibile è terminato. Riprova.'
  if (category === 'authentication') {
    if (domain === 'github') return 'Accedi di nuovo a GitHub e riprova.'
    if (domain === 'database') return 'Verifica le credenziali del database e riprova.'
    if (domain === 'redis') return 'Verifica utente e password Redis, quindi riprova.'
    if (domain === 'remote') return 'Verifica le credenziali della connessione remota e riprova.'
    return 'Accedi di nuovo e riprova.'
  }
  if (category === 'permission') {
    if (/erofs|read.?only/u.test(signal)) return 'La destinazione è in sola lettura. Scegli una posizione scrivibile e riprova.'
    return 'Verifica i permessi e riprova.'
  }
  if (category === 'conflict') {
    if (domain === 'filesystem' || domain === 'remote') return 'Il file è cambiato nel frattempo. Confronta le modifiche prima di riprovare.'
    return 'La risorsa è cambiata nel frattempo. Controlla le modifiche prima di riprovare.'
  }
  if (category === 'not-found') {
    if (domain === 'filesystem' || domain === 'remote') return 'Il file non è più disponibile. Riaprilo o selezionane un altro.'
    if (domain === 'workspace') return 'Il workspace non è più disponibile. Selezionalo di nuovo.'
    return 'La risorsa non è più disponibile. Aggiorna i dati e riprova.'
  }
  if (category === 'network') {
    if (/rate.?limit|too many requests|\b429\b/u.test(signal)) return 'Il servizio sta limitando le richieste. Attendi qualche minuto e riprova.'
    if (/econnrefused|connection refused/u.test(signal)) return 'Il servizio ha rifiutato la connessione. Verifica che sia disponibile e riprova.'
    return 'Controlla la connessione e riprova.'
  }
  if (category === 'validation') return 'Controlla i dati inseriti e riprova.'
  if (category === 'configuration') return 'Controlla la configurazione e riprova.'
  if (/enospc|no space left|disk full|spazio.+insufficient/u.test(signal)) return 'Lo spazio disponibile non è sufficiente. Libera spazio e riprova.'
  if (/emfile|enfile|too many open files/u.test(signal)) return 'Sono aperte troppe risorse. Chiudi quelle non necessarie e riprova.'
  return 'Riprova. Se il problema continua, copia la diagnostica.'
}

function publicMessageFor(error, channel, domain, operation, category, authoredMessage) {
  if (isPublicError(error)) return error.publicMessage
  if (typeof authoredMessage === 'string' && authoredMessage.trim()) return authoredMessage
  const advice = categoryAdvice(category, domain, errorSignals(error))
  if (category === 'cancelled') return advice
  const base = CHANNEL_MESSAGES[channel] ?? fallbackMessage(domain, operation)
  return `${base} ${advice}`
}

function classifyApplicationError(error, options = {}) {
  const channel = safeContext(options.channel, 'operation')
  const domain = DOMAIN_SET.has(options.domain) ? options.domain : domainFromIpcChannel(channel)
  const operation = safeContext(options.operation, operationFromIpcChannel(channel))
  const category = classifyCategory(error, domain, options.category)
  const severity = severityForCategory(category, options.severity)
  const correlationId = CORRELATION_ID_PATTERN.test(options.correlationId ?? '')
    ? options.correlationId
    : getPublicErrorCorrelationId(error) ?? createCorrelationId()
  const code = (isPublicError(error) ? safeCode(error.publicCode) : null)
    ?? safeCode(options.code)
    ?? generatedCode(domain, operation, category)
  const message = publicMessageFor(error, channel, domain, operation, category, options.message)

  return Object.freeze({
    category,
    code,
    correlationId,
    domain,
    message,
    operation,
    recoverable: options.recoverable ?? category !== 'cancelled',
    severity,
  })
}

function isApplicationError(error) {
  return Boolean(error && typeof error === 'object' && PRIVATE_DIAGNOSTICS.has(error))
}

function attachApplicationMetadata(error, classification) {
  Object.defineProperties(error, {
    [APPLICATION_ERROR]: { value: true },
    category: { value: classification.category },
    domain: { value: classification.domain },
    operation: { value: classification.operation },
    recoverable: { value: classification.recoverable },
    severity: { value: classification.severity },
  })
  return error
}

function toApplicationError(error, options = {}) {
  if (isApplicationError(error)) return error
  const classification = classifyApplicationError(error, options)
  let publicError = isPublicError(error)
    ? ensurePublicErrorCorrelation(error, classification.correlationId)
    : createPublicError(classification.code, classification.message, { correlationId: classification.correlationId })
  let applicationError
  try {
    applicationError = attachApplicationMetadata(publicError, classification)
  } catch {
    publicError = createPublicError(classification.code, classification.message, { correlationId: classification.correlationId })
    applicationError = attachApplicationMetadata(publicError, classification)
  }
  PRIVATE_DIAGNOSTICS.set(applicationError, createPrivateDiagnostics(error, classification, options))
  return applicationError
}

function getApplicationErrorLogMetadata(error, options = {}) {
  const applicationError = isApplicationError(error) ? error : toApplicationError(error, options)
  const privateDiagnostics = PRIVATE_DIAGNOSTICS.get(applicationError)
    ?? createPrivateDiagnostics(applicationError, {
      domain: applicationError.domain,
      operation: applicationError.operation,
    }, options)
  return Object.freeze({
    category: applicationError.category,
    code: applicationError.publicCode,
    component: applicationError.domain,
    correlationId: applicationError.correlationId,
    ...privateDiagnostics,
    operation: applicationError.operation,
    severity: applicationError.severity,
  })
}

module.exports = {
  APPLICATION_ERROR_CATEGORIES,
  APPLICATION_ERROR_SEVERITIES,
  classifyApplicationError,
  createCorrelationId,
  domainFromIpcChannel,
  getApplicationErrorLogMetadata,
  isApplicationError,
  toApplicationError,
}
