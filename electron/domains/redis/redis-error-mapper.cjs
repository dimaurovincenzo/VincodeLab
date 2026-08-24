const { createPublicError, isPublicError } = require('../errors/public-error.cjs')

function withoutControlCharacters(value) {
  return [...value].map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
}

const ERROR_DETAILS = Object.freeze({
  authentication: ['authentication', 'REDIS_AUTHENTICATION_FAILED', 'Autenticazione Redis non riuscita. Verifica le credenziali e riprova.'],
  cancelled: ['cancelled', 'REDIS_OPERATION_CANCELLED', 'L’operazione Redis è stata annullata.'],
  'client-unavailable': ['configuration', 'REDIS_CLIENT_UNAVAILABLE', 'Il supporto Redis non è disponibile. Reinstalla l’applicazione e riprova.'],
  'connection-failed': ['network', 'REDIS_CONNECTION_FAILED', 'La connessione a Redis non è stata completata. Controlla la configurazione e riprova.'],
  'connection-lost': ['network', 'REDIS_CONNECTION_LOST', 'La connessione a Redis si è interrotta. Riconnetti e riprova.'],
  'connection-not-found': ['not-found', 'REDIS_CONNECTION_NOT_FOUND', 'La connessione Redis del workspace non è più disponibile. Aggiorna l’elenco e riprova.'],
  'key-not-found': ['not-found', 'REDIS_KEY_NOT_FOUND', 'La chiave Redis non è più disponibile. Aggiorna l’elenco e riprova.'],
  permission: ['permission', 'REDIS_PERMISSION_DENIED', 'Redis ha rifiutato l’operazione. Verifica i permessi dell’utente configurato.'],
  'result-too-large': ['database', 'REDIS_RESULT_TOO_LARGE', 'Il valore Redis supera il limite di sicurezza della risposta. Restringi la ricerca o leggi una pagina più piccola.'],
  timeout: ['timeout', 'REDIS_TIMEOUT', 'Redis non ha risposto entro il tempo previsto. Riprova o verifica la connessione.'],
  'type-changed': ['conflict', 'REDIS_KEY_TYPE_CHANGED', 'Il tipo della chiave Redis è cambiato durante la lettura. Aggiorna e riprova.'],
  validation: ['validation', 'REDIS_INPUT_INVALID', 'La richiesta Redis non è valida. Controlla i dati e riprova.'],
  'read-failed': ['database', 'REDIS_READ_FAILED', 'Non è stato possibile leggere i dati da Redis. Riprova.'],
  'size-unavailable': ['database', 'REDIS_SIZE_UNAVAILABLE', 'Redis non consente di verificare in sicurezza la dimensione del valore. Concedi il permesso MEMORY USAGE e riprova.'],
  'prefetch-too-large': ['database', 'REDIS_PREFETCH_TOO_LARGE', 'La chiave Redis è troppo grande per una lettura sicura. Restringi la ricerca o usa uno strumento amministrativo dedicato.'],
})

function errorParts(error) {
  const parts = []
  const pending = [error]
  const visited = new Set()
  while (pending.length && visited.size < 6) {
    const current = pending.shift()
    if (typeof current === 'string') { parts.push(current.slice(0, 1_024)); continue }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    for (const key of ['name', 'code', 'errno', 'message']) {
      let value
      try { value = current[key] } catch { continue }
      if (typeof value === 'string' || typeof value === 'number') parts.push(String(value).slice(0, 1_024))
    }
    try { if (current.cause) pending.push(current.cause) } catch { /* Proprietà ostile ignorata. */ }
  }
  return parts
}

function sanitizeRedisDiagnostic(error) {
  return withoutControlCharacters(errorParts(error).join(' | '))
    .replace(/\b(?:redis|rediss):\/\/[^\s|]+/giu, '[REDIS URL REDACTED]')
    .replace(/\b(password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]\s*([^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[AUTH REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu, '$1[USER REDACTED]@')
    .replace(/\buser(?:name)?\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, 'user=[REDACTED]')
    .replace(/\bkey\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, 'key=[REDACTED]')
    .replace(/(["'])[^"']{1,256}\1/gu, '$1[VALUE REDACTED]$1')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/gu, '[HOST REDACTED]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/giu, '[HOST REDACTED]')
    .replace(/\/(?:Users|home)\/[^\s|]+/gu, '[PATH REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim().slice(0, 512) || 'Dettaglio Redis non disponibile.'
}

function redisErrorKind(error, { phase = 'read' } = {}) {
  const signal = errorParts(error).join(' ').toLowerCase()
  if (/redis_result_(?:item_)?too_large|redis_result_too_many_items|redis_result_too_large/u.test(signal)) return 'result-too-large'
  if (/redis_result_size_unavailable/u.test(signal)) return 'size-unavailable'
  if (/redis_prefetch_too_large/u.test(signal)) return 'prefetch-too-large'
  if (/redis_client_(?:command_)?unavailable|module_not_found|cannot find module.*(?:redis|@redis)/u.test(signal)) return 'client-unavailable'
  if (/aborterror|abort_err|redis_operation_cancelled|redis_session_invalidated|\babort(?:ed)?\b|cancel(?:led|ed)/u.test(signal)) return 'cancelled'
  // Il timeout esterno può avvolgere l'ultimo errore prodotto dal client
  // Sentinel. Le cause deterministiche devono prevalere, altrimenti una
  // credenziale errata viene presentata come server lento dopo diversi retry.
  if (/noauth|wrongpass|invalid username-password|authentication/u.test(signal)) return 'authentication'
  if (/noperm|permission|not authorized|forbidden/u.test(signal)) return 'permission'
  if (/etimedout|timeout|timed out|socket timeout/u.test(signal)) return 'timeout'
  if (/wrongtype/u.test(signal)) return 'type-changed'
  if (/redis_key_not_found/u.test(signal)) return 'key-not-found'
  if (/redis_connection_not_found/u.test(signal)) return 'connection-not-found'
  if (/econnreset|econnaborted|epipe|socket closed|connection (?:is )?(?:closed|lost)|the client is closed/u.test(signal)) return 'connection-lost'
  if (/econnrefused|enotfound|eai_again|ehostunreach|enetunreach|getaddrinfo|connect failed/u.test(signal)) return 'connection-failed'
  if (/redis_input_invalid|invalid (?:input|argument|configuration)|non valid/u.test(signal)) return 'validation'
  return phase === 'connection' ? 'connection-failed' : 'read-failed'
}

function normalizeRedisError(error, options = {}) {
  const kind = redisErrorKind(error, options)
  const [category, code, message] = ERROR_DETAILS[kind]
  return Object.freeze({ category, code, diagnostic: sanitizeRedisDiagnostic(error), kind, message })
}

function toRedisPublicError(error, options = {}) {
  if (isPublicError(error)) return error
  const normalized = normalizeRedisError(error, options)
  const publicError = createPublicError(normalized.code, normalized.message)
  Object.defineProperties(publicError, {
    redisCategory: { value: normalized.category },
    redisDiagnostic: { value: normalized.diagnostic },
    redisKind: { value: normalized.kind },
  })
  return publicError
}

module.exports = {
  normalizeRedisError,
  redisErrorKind,
  sanitizeRedisDiagnostic,
  toRedisPublicError,
}
