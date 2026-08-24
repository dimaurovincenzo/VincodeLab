const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

const DATABASE_ERROR_DETAILS = Object.freeze({
  authentication: {
    category: 'authentication',
    code: 'DATABASE_AUTHENTICATION_FAILED',
    message: 'Autenticazione database non riuscita. Verifica credenziali e riprova.',
  },
  cancelled: {
    category: 'cancelled',
    code: 'DATABASE_QUERY_CANCELLED',
    message: 'La query è stata annullata.',
  },
  'connection-failed': {
    category: 'database',
    code: 'DATABASE_CONNECTION_FAILED',
    message: 'La connessione al database non è stata completata. Controlla la configurazione e riprova.',
  },
  'connection-lost': {
    category: 'network',
    code: 'DATABASE_NETWORK_CONNECTION_LOST',
    message: 'La connessione al database si è interrotta. Riconnetti e riprova.',
  },
  constraint: {
    category: 'conflict',
    code: 'DATABASE_CONSTRAINT_VIOLATION',
    message: 'La query viola un vincolo del database. Controlla i dati e riprova.',
  },
  'database-not-found': {
    category: 'not-found',
    code: 'DATABASE_NOT_FOUND',
    message: 'Il database richiesto non esiste o non è disponibile. Verifica il nome e riprova.',
  },
  'driver-unavailable': {
    category: 'configuration',
    code: 'DATABASE_DRIVER_UNAVAILABLE',
    message: 'Il driver database incluso nell’app non è disponibile. Reinstalla VincodeLab e riprova.',
  },
  'file-invalid': {
    category: 'validation',
    code: 'DATABASE_FILE_INVALID',
    message: 'Il file selezionato non è un database SQLite valido. Scegli un altro file e riprova.',
  },
  'file-not-found': {
    category: 'not-found',
    code: 'DATABASE_FILE_NOT_FOUND',
    message: 'Il file SQLite non è disponibile. Verifica il percorso o seleziona di nuovo il file.',
  },
  'file-read-only': {
    category: 'permission',
    code: 'DATABASE_FILE_READ_ONLY',
    message: 'Il file SQLite è in sola lettura o non è scrivibile. Verifica i permessi e riprova.',
  },
  'host-unreachable': {
    category: 'network',
    code: 'DATABASE_NETWORK_HOST_UNREACHABLE',
    message: 'Impossibile raggiungere il server database. Verifica host, porta e rete.',
  },
  permission: {
    category: 'permission',
    code: 'DATABASE_PERMISSION_DENIED',
    message: 'Il database ha rifiutato l’operazione per permessi insufficienti. Verifica i permessi e riprova.',
  },
  'query-failed': {
    category: 'database',
    code: 'DATABASE_QUERY_FAILED',
    message: 'Il database non ha completato la query. Controlla il testo e riprova.',
  },
  'result-too-large': {
    category: 'database',
    code: 'DATABASE_RESULT_TOO_LARGE',
    message: 'Il risultato supera il limite sicuro dell’app. Riduci righe o colonne, oppure limita i valori grandi nella query.',
  },
  'runtime-incompatible': {
    category: 'configuration',
    code: 'DATABASE_RUNTIME_INCOMPATIBLE',
    message: 'Il runtime database incluso nell’app non è compatibile con questo Mac. Reinstalla la versione corretta di VincodeLab.',
  },
  syntax: {
    category: 'validation',
    code: 'DATABASE_SYNTAX_ERROR',
    message: 'La query contiene un errore di sintassi. Controlla il testo e riprova.',
  },
  timeout: {
    category: 'timeout',
    code: 'DATABASE_TIMEOUT',
    message: 'Il database non ha risposto entro il tempo previsto. Riprova o verifica la connessione.',
  },
  validation: {
    category: 'validation',
    code: 'DATABASE_CONFIGURATION_INVALID',
    message: 'La configurazione del database non è valida. Controlla i campi e riprova.',
  },
})

function databaseErrorParts(error) {
  const parts = []
  const pending = [error]
  const visited = new Set()
  while (pending.length && visited.size < 8) {
    const current = pending.shift()
    if (typeof current === 'string') {
      parts.push(current.slice(0, 1_024))
      continue
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    for (const key of ['name', 'code', 'errno', 'number', 'sqlState', 'sqlstate', 'state', 'class', 'message']) {
      const value = current[key]
      if (typeof value === 'string' || typeof value === 'number') parts.push(String(value).slice(0, 1_024))
    }
    for (const key of ['cause', 'originalError', 'parent']) if (current[key]) pending.push(current[key])
    if (Array.isArray(current.precedingErrors)) pending.push(...current.precedingErrors.slice(0, 4))
  }
  return parts
}

function sanitizeDatabaseDiagnostic(error) {
  const diagnostic = databaseErrorParts(error).join(' | ')
    .replace(/\b(password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]\s*([^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[AUTH REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu, '$1[USER REDACTED]@')
    .replace(/\b(for\s+user|user(?:name)?|database|host|server)\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(for\s+(?:table|relation|schema|object))\s+(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, '$1 [REDACTED]')
    .replace(/(["'])[^"']{1,256}\1/gu, '$1[VALUE REDACTED]$1')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/gu, '[HOST REDACTED]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/giu, '[HOST REDACTED]')
    .replace(/\/(?:Users|home)\/[^\s|]+/gu, '[PATH REDACTED]')
    .replace(/[A-Z]:\\(?:[^\s|]+\\)*[^\s|]*/giu, '[PATH REDACTED]')
    .replace(/\b(?:select|insert|update|delete|merge|create|alter|drop|truncate)\b[\s\S]*/iu, '[QUERY REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
  return diagnostic.slice(0, 512) || 'Dettaglio driver non disponibile.'
}

function databaseErrorKind(error, { driver, fallbackKind, phase = 'query' } = {}) {
  const signal = databaseErrorParts(error).join(' ').toLowerCase()
  if (/err_module_not_found|module_not_found|cannot find module/u.test(signal)) return 'driver-unavailable'
  if (/err_dlopen_failed|node_module_version|compiled against a different node\.js version|incompatible architecture|wrong architecture|mach-o.*(?:incompatible|wrong)|symbol not found/u.test(signal)) return 'runtime-incompatible'
  if (/sqlite_(?:notadb|corrupt|format)(?:_[a-z]+)?|file is not a database|database disk image is malformed/u.test(signal)) return 'file-invalid'
  if (/sqlite_(?:readonly(?:_[a-z]+)?|perm|ioerr_access)|attempt to write a readonly database/u.test(signal)) return 'file-read-only'
  if (/sqlite_cantopen(?:_[a-z]+)?|unable to open database file/u.test(signal)) return 'file-not-found'
  if (driver === 'sqlite' && /(?:^|\s)(?:eacces|eperm|erofs)(?:\s|$)|permission denied|read.?only/u.test(signal)) return 'file-read-only'
  if (driver === 'sqlite' && /(?:^|\s)(?:enoent|enotdir)(?:\s|$)|no such file|directory does not exist/u.test(signal)) return 'file-not-found'
  if (/database_result_(?:cell_)?too_large/u.test(signal)) return 'result-too-large'
  if (/timeouterror|etimedout|esockettimedout|\betimeout\b|protocol_sequence_timeout|query_timeout|request timeout|statement timeout|timed?\s*out|deadline/u.test(signal)) return 'timeout'
  if (/aborterror|abort_err|database_query_abort(?:ed)?|\baborted?\b|err_(?:canceled|cancelled)|\becancel\b|er_query_interrupted|\b1317\b|query execution was interrupted|cancel(?:ing|led|ed)|annullat/u.test(signal)) return 'cancelled'
  if (/\b57014\b/u.test(signal)) return 'cancelled'
  if (/\b3d000\b|er_bad_db_error|\b1049\b|\b4060\b|unknown database|database .+ does not exist|cannot open database/u.test(signal)) return 'database-not-found'
  if (/\b28p01\b|\b28000\b|er_access_denied_error|\b1045\b|\belogin\b|\b18456\b|login failed|authentication failed|password authentication|invalid (?:password|credentials)|access denied for user/u.test(signal)) return 'authentication'
  if (/\b42501\b|er_dbaccess_denied_error|er_tableaccess_denied_error|\b1044\b|\b1142\b|\b1227\b|\b229\b|\b916\b|permission denied|insufficient privilege|command denied|not authorized|forbidden/u.test(signal)) return 'permission'
  if (/econnrefused|enotfound|eai_again|ehostunreach|enetunreach|einstlookup|\b08001\b|\b57p03\b|could not connect|server is not found|host is unreachable|getaddrinfo/u.test(signal)) return 'host-unreachable'
  if (/econnreset|econnaborted|econnclosed|epipe|protocol_connection_lost|protocol_enqueue_after_(?:fatal_error|quit)|er_server_shutdown|er_connection_killed|\b08000\b|\b08003\b|\b08006\b|\b08007\b|\b08p01\b|\b08s01\b|\b57p01\b|\b57p02\b|server (?:has gone away|shutdown)|socket hang up|connection (?:is |was )?(?:lost|closed|terminated|broken)|database_connection_lost/u.test(signal)) return 'connection-lost'
  if (/\b42601\b|er_parse_error|\b1064\b|syntax error|incorrect syntax|parse error/u.test(signal)) return 'syntax'
  if (/\b23[0-9a-z]{3}\b|er_bad_null_error|er_check_constraint_violated|er_dup_entry|er_no_referenced_row|er_row_is_referenced|\b1048\b|\b1062\b|\b1451\b|\b1452\b|\b3819\b|\b2601\b|\b2627\b|\b547\b|constraint|duplicate (?:entry|key)|foreign key|not[- ]null violation/u.test(signal)) return 'constraint'
  if (/sessioninvalidatederror|chiusa durante la connessione/u.test(signal)) return 'cancelled'
  if (/einval|validation|malformed|non valid|invalid (?:configuration|config|input|argument)/u.test(signal)) return 'validation'
  if (DATABASE_ERROR_DETAILS[fallbackKind]) return fallbackKind
  return phase === 'connection' ? 'connection-failed' : 'query-failed'
}

function normalizeDatabaseError(error, options = {}) {
  const kind = databaseErrorKind(error, options)
  const details = DATABASE_ERROR_DETAILS[kind]
  return Object.freeze({
    category: details.category,
    code: details.code,
    diagnostic: sanitizeDatabaseDiagnostic(error),
    kind,
    message: details.message,
  })
}

function toDatabasePublicError(error, options = {}) {
  if (isPublicError(error)) return error
  const normalized = normalizeDatabaseError(error, options)
  const publicError = createPublicError(normalized.code, normalized.message)
  Object.defineProperties(publicError, {
    databaseCategory: { value: normalized.category },
    databaseDiagnostic: { value: normalized.diagnostic },
    databaseKind: { value: normalized.kind },
  })
  return publicError
}

const SQLITE_INFRASTRUCTURE_ERROR_KINDS = new Set([
  'driver-unavailable',
  'file-invalid',
  'file-not-found',
  'file-read-only',
  'runtime-incompatible',
])

function sqliteInfrastructurePublicError(error, { phase = 'query' } = {}) {
  const options = { driver: 'sqlite', phase }
  return SQLITE_INFRASTRUCTURE_ERROR_KINDS.has(databaseErrorKind(error, options))
    ? toDatabasePublicError(error, options)
    : null
}

module.exports = {
  databaseErrorKind,
  normalizeDatabaseError,
  sanitizeDatabaseDiagnostic,
  sqliteInfrastructurePublicError,
  toDatabasePublicError,
}
