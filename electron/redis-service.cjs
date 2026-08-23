const { createPublicError, isPublicError } = require('./public-error.cjs')
const { getConnectionWithSecrets: storedConnectionWithSecrets } = require('./redis-store.cjs')
const { createRedisSessionRegistry } = require('./redis-session-registry.cjs')
const {
  createRedisResultBudget,
  REDIS_RESULT_BYTE_LIMIT,
  REDIS_RESULT_ITEM_BYTE_LIMIT,
  REDIS_RESULT_ITEM_LIMIT,
} = require('./redis-result-budget.cjs')

const REDIS_SCAN_LIMIT = 500
const REDIS_READ_LIMIT = 500
const REDIS_SEARCH_KEY_LIMIT = 10_000
const REDIS_SEARCH_MATCH_LIMIT = 100
const REDIS_SESSION_CLEANUP_TIMEOUT_MS = 2_000
const REDIS_COMMAND_TIMEOUT_MS = 10_000
const REDIS_METADATA_CONCURRENCY = 32
const REDIS_SEARCH_CONCURRENCY = 12
const REDIS_STRING_PREVIEW_BYTE_LIMIT = 256 * 1_024
const REDIS_SEARCH_STRING_PREVIEW_BYTE_LIMIT = 32 * 1_024
const REDIS_SEARCH_READ_BYTE_LIMIT = 32 * 1_024 * 1_024
const REDIS_COLLECTION_PREFETCH_BYTE_LIMIT = 8 * 1_024 * 1_024
const KEY_TYPE_SET = new Set(['string', 'hash', 'list', 'set', 'zset', 'stream', 'json'])

function hasControlCharacter(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

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

function validateConnectionConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  const mode = config.mode === undefined ? 'standalone' : config.mode
  if (mode !== 'standalone' && mode !== 'sentinel') throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (typeof config.host !== 'string' || !config.host.trim() || config.host.length > 255) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (!Number.isInteger(config.database) || config.database < 0 || config.database > 65_535) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.username !== undefined && (typeof config.username !== 'string' || !config.username || config.username.length > 255)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.password !== undefined && (typeof config.password !== 'string' || !config.password || config.password.length > 4_096)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (mode === 'sentinel' && (typeof config.sentinelMasterName !== 'string' || !config.sentinelMasterName.trim() || config.sentinelMasterName.length > 255 || hasControlCharacter(config.sentinelMasterName))) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.sentinelUsername !== undefined && (mode !== 'sentinel' || typeof config.sentinelUsername !== 'string' || !config.sentinelUsername || config.sentinelUsername.length > 255)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.sentinelPassword !== undefined && (mode !== 'sentinel' || typeof config.sentinelPassword !== 'string' || !config.sentinelPassword || config.sentinelPassword.length > 4_096)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return {
    mode, host: config.host.trim(), port: config.port, database: config.database,
    ...(mode === 'sentinel' ? { sentinelMasterName: config.sentinelMasterName.trim() } : {}),
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
    ...(mode === 'sentinel' && config.sentinelUsername ? { sentinelUsername: config.sentinelUsername } : {}),
    ...(mode === 'sentinel' && config.sentinelPassword ? { sentinelPassword: config.sentinelPassword } : {}),
    tls: Boolean(config.tls),
  }
}

function sessionKey(workspacePath, connectionId) {
  if (typeof workspacePath !== 'string' || !workspacePath || typeof connectionId !== 'string' || !connectionId) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return `${workspacePath}\u0000${connectionId}`
}

function encodedKey(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  if (bytes.length > 16_384) throw Object.assign(new Error('redis_result_item_too_large'), { code: 'REDIS_RESULT_TOO_LARGE' })
  const decoded = bytes.toString('utf8')
  const binary = !Buffer.from(decoded, 'utf8').equals(bytes)
  const display = binary
    ? `0x${bytes.toString('hex')}`
    : (decoded ? [...decoded].map((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 ? `\\x${code.toString(16).padStart(2, '0')}` : character
      }).join('') : '(chiave vuota)')
  return Object.freeze({ encoded: bytes.toString('base64'), display, binary })
}

function keyBytes(keyRef) {
  if (Buffer.isBuffer(keyRef)) return keyRef
  if (typeof keyRef === 'string' && keyRef.length && keyRef.length <= 16_384 && !hasControlCharacter(keyRef)) return Buffer.from(keyRef, 'utf8')
  if (!keyRef || typeof keyRef !== 'object' || Array.isArray(keyRef) || typeof keyRef.encoded !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(keyRef.encoded)
    || keyRef.encoded.length > 21_848) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  const bytes = Buffer.from(keyRef.encoded, 'base64')
  if (bytes.length > 16_384 || bytes.toString('base64') !== keyRef.encoded) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return bytes
}

function integerOption(value, fallback, min, max, code = 'redis_input_invalid') {
  value = value === undefined ? fallback : value
  if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error(code), { code: 'REDIS_INPUT_INVALID' })
  return value
}

function cursorOption(value = '0') {
  const cursor = String(value)
  if (!/^\d{1,40}$/u.test(cursor)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return cursor
}

function patternOption(value = '*') {
  if (typeof value !== 'string' || !value || value.length > 512 || hasControlCharacter(value)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return value
}

function normalizeType(value) {
  const normalized = String(value).toLowerCase()
  if (normalized === 'rejson-rl' || normalized === 'json') return 'json'
  return normalized
}

function commandClient(client, signal) {
  if (signal?.aborted) throw abortError()
  return typeof client.withCommandOptions === 'function'
    ? client.withCommandOptions({ timeout: REDIS_COMMAND_TIMEOUT_MS, ...(signal ? { abortSignal: signal } : {}) })
    : client
}

function abortError() {
  return Object.assign(new Error('redis_operation_cancelled'), { name: 'AbortError', code: 'ABORT_ERR' })
}

function connectionErrorWithCause(error, session) {
  if (!session?.lastError) return error
  const wrapped = new Error('redis_connection_failed', { cause: session.lastError })
  if (typeof error?.code === 'string') wrapped.code = error.code
  return wrapped
}

function withAbort(promise, signal, onAbort = () => undefined) {
  if (!signal) return Promise.resolve(promise)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      callback(value)
    }
    const handleAbort = () => {
      try { onAbort() } catch { /* La cancellazione resta deterministica. */ }
      finish(reject, abortError())
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

function withTimeout(promise, timeoutMs, onTimeout = () => undefined) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      try { onTimeout() } catch { /* La chiusura forzata resta best effort. */ }
      finish(reject, Object.assign(new Error('redis_connection_timeout'), { code: 'ETIMEDOUT' }))
    }, timeoutMs)
    timer.unref?.()
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

async function invoke(client, names, args, signal) {
  const target = commandClient(client, signal)
  for (const name of names) if (typeof target[name] === 'function') return target[name](...args)
  throw Object.assign(new Error('redis_client_command_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
}

function normalizeScanReply(reply, collectionNames) {
  if (Array.isArray(reply)) return { cursor: String(reply[0]), values: Array.isArray(reply[1]) ? reply[1] : [] }
  if (!reply || typeof reply !== 'object') throw new Error('redis_invalid_scan_reply')
  const values = collectionNames.map((name) => reply[name]).find(Array.isArray) ?? []
  return { cursor: String(reply.cursor ?? reply.nextCursor ?? '0'), values }
}

function valueForRenderer(value) {
  if (Buffer.isBuffer(value)) {
    const decoded = value.toString('utf8')
    return Buffer.from(decoded, 'utf8').equals(value) ? decoded : `base64:${value.toString('base64')}`
  }
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

function budgetItems(items, options = {}) {
  const budget = createRedisResultBudget(options)
  for (const item of items) budget.add(item)
  return { bytes: budget.bytes, items: budget.items }
}

function createRedisService({
  createClient,
  createSentinel,
  cleanupTimeoutMs = REDIS_SESSION_CLEANUP_TIMEOUT_MS,
  connectionTimeoutMs = REDIS_COMMAND_TIMEOUT_MS,
  getConnectionWithSecrets = storedConnectionWithSecrets,
  sessionRegistry,
  resultByteLimit = REDIS_RESULT_BYTE_LIMIT,
  resultItemByteLimit = REDIS_RESULT_ITEM_BYTE_LIMIT,
  resultItemLimit = REDIS_RESULT_ITEM_LIMIT,
  metadataConcurrency = REDIS_METADATA_CONCURRENCY,
  searchConcurrency = REDIS_SEARCH_CONCURRENCY,
  searchReadByteLimit = REDIS_SEARCH_READ_BYTE_LIMIT,
} = {}) {
  if (createClient !== undefined && typeof createClient !== 'function') throw new TypeError('createClient Redis non valido.')
  if (createSentinel !== undefined && typeof createSentinel !== 'function') throw new TypeError('createSentinel Redis non valido.')
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 60_000) throw new TypeError('Timeout chiusura Redis non valido.')
  if (!Number.isInteger(connectionTimeoutMs) || connectionTimeoutMs < 1 || connectionTimeoutMs > 60_000) throw new TypeError('Timeout connessione Redis non valido.')
  if (!Number.isInteger(metadataConcurrency) || metadataConcurrency < 1 || metadataConcurrency > REDIS_METADATA_CONCURRENCY) throw new TypeError('Concorrenza metadati Redis non valida.')
  if (!Number.isInteger(searchConcurrency) || searchConcurrency < 1 || searchConcurrency > 16) throw new TypeError('Concorrenza ricerca Redis non valida.')
  if (!Number.isInteger(searchReadByteLimit) || searchReadByteLimit < 1 || searchReadByteLimit > 256 * 1_024 * 1_024) throw new TypeError('Budget ricerca Redis non valido.')
  if (typeof getConnectionWithSecrets !== 'function') throw new TypeError('Store connessioni Redis non valido.')

  const clientFactory = createClient ?? ((options) => {
    // Il require è intenzionalmente lazy: l’avvio dell’app e i test che non usano
    // Redis non dipendono dal caricamento del client o dei suoi moduli opzionali.
    const redis = require('redis')
    const client = redis.createClient(options)
    // SCAN deve conservare anche chiavi non UTF-8. Con RESP3 il mapping a Buffer
    // evita conversioni lossy; tutti i DTO renderer vengono poi codificati base64.
    return typeof client.withTypeMapping === 'function' && redis.RESP_TYPES?.BLOB_STRING !== undefined
      ? client.withTypeMapping({ [redis.RESP_TYPES.BLOB_STRING]: Buffer })
      : client
  })

  const sentinelFactory = createSentinel ?? ((options) => {
    const redis = require('redis')
    const client = redis.createSentinel(options)
    return typeof client.withTypeMapping === 'function' && redis.RESP_TYPES?.BLOB_STRING !== undefined
      ? client.withTypeMapping({ [redis.RESP_TYPES.BLOB_STRING]: Buffer })
      : client
  })

  function optionsForClient(config) {
    return {
      username: config.username,
      password: config.password,
      database: config.database,
      disableOfflineQueue: true,
      socket: {
        host: config.host,
        port: config.port,
        tls: config.tls,
        connectTimeout: connectionTimeoutMs,
        reconnectStrategy: false,
      },
    }
  }

  function optionsForSentinel(config) {
    const sharedSocket = {
      tls: config.tls,
      connectTimeout: connectionTimeoutMs,
      reconnectStrategy: false,
    }
    return {
      name: config.sentinelMasterName,
      sentinelRootNodes: [{ host: config.host, port: config.port }],
      masterPoolSize: 1,
      replicaPoolSize: 0,
      reserveClient: true,
      // Ogni root Sentinel viene già provata da node-redis durante observe().
      // Un solo rediscovery copre un cambio di topologia transitorio senza
      // oltrepassare il timeout applicativo o nascondere NOAUTH/WRONGPASS.
      maxCommandRediscovers: 1,
      passthroughClientErrorEvents: true,
      commandOptions: { timeout: 10_000 },
      nodeClientOptions: {
        username: config.username,
        password: config.password,
        database: config.database,
        disableOfflineQueue: true,
        socket: { ...sharedSocket },
      },
      sentinelClientOptions: {
        username: config.sentinelUsername,
        password: config.sentinelPassword,
        disableOfflineQueue: true,
        socket: { ...sharedSocket },
      },
    }
  }

  function createClientForConfig(config) {
    return config.mode === 'sentinel'
      ? sentinelFactory(optionsForSentinel(config))
      : clientFactory(optionsForClient(config))
  }

  const forcedDisposals = new WeakMap()

  async function disposeSession(session) {
    const client = session?.client ?? session
    if (!client) return
    let cleanupComplete = true
    try {
      const close = client.isOpen !== false && typeof client.quit === 'function'
        ? client.quit()
        : typeof client.close === 'function' ? client.close() : undefined
      if (close) await withTimeout(close, cleanupTimeoutMs)
    } catch {
      try { await withTimeout(forceDisposeSession(session), cleanupTimeoutMs) } catch { cleanupComplete = false }
    } finally {
      if (cleanupComplete) client.off?.('error', session?.errorListener)
    }
  }

  function forceDisposeSession(session) {
    const client = session?.client ?? session
    if (!client) return Promise.resolve()
    if ((typeof client === 'object' || typeof client === 'function') && forcedDisposals.has(client)) return forcedDisposals.get(client)
    const closing = Promise.resolve().then(() => {
      if (typeof client.destroy === 'function') return client.destroy()
      if (typeof client.disconnect === 'function') return client.disconnect()
      return undefined
    }).catch(() => undefined)
    if (typeof client === 'object' || typeof client === 'function') forcedDisposals.set(client, closing)
    return closing
  }

  function connectSession(session, signal) {
    return withTimeout(
      withAbort(session.client.connect(), signal, () => forceDisposeSession(session)),
      connectionTimeoutMs,
      () => forceDisposeSession(session),
    )
  }

  const sessions = sessionRegistry ?? createRedisSessionRegistry({
    cleanupTimeoutMs,
    closeSession: disposeSession,
    forceCloseSession: forceDisposeSession,
  })
  if (!sessions || typeof sessions.acquire !== 'function' || typeof sessions.close !== 'function' || typeof sessions.closeMatching !== 'function') throw new TypeError('Registry sessioni Redis non valido.')

  async function getSession(workspacePath, connectionId, { signal } = {}) {
    if (signal?.aborted) throw toRedisPublicError(abortError(), { phase: 'connection' })
    const key = sessionKey(workspacePath, connectionId)
    const acquire = () => sessions.acquire(key, async ({ setCandidate }) => {
      const stored = getConnectionWithSecrets(workspacePath, connectionId)
      const resolved = await Promise.resolve(stored)
      if (!resolved) throw Object.assign(new Error('redis_connection_not_found'), { code: 'REDIS_INPUT_INVALID' })
      const config = validateConnectionConfig(resolved)
      const client = createClientForConfig(config)
      if (!client || typeof client.connect !== 'function') throw Object.assign(new Error('redis_client_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
      const session = { client, errorListener: null, lastError: null }
      session.errorListener = (error) => { session.lastError = error }
      client.on?.('error', session.errorListener)
      setCandidate(session)
      try {
        await connectSession(session, signal)
      } catch (error) {
        throw connectionErrorWithCause(error, session)
      }
      return session
    })
    try {
      let session = await withAbort(acquire(), signal)
      if (session.client?.isOpen === false) {
        await sessions.close(key)
        session = await withAbort(acquire(), signal)
      }
      return session
    } catch (error) { throw toRedisPublicError(error, { phase: 'connection' }) }
  }

  async function invalidateFailedSession(workspacePath, connectionId, error) {
    const kind = error?.redisKind ?? normalizeRedisError(error).kind
    if (kind === 'connection-lost' || kind === 'connection-failed' || kind === 'timeout') {
      await sessions.close(sessionKey(workspacePath, connectionId)).catch(() => undefined)
    }
  }

  async function metadata(client, key, signal, { includeSize = true, includeTtl = true } = {}) {
    const requests = []
    if (includeTtl) requests.push(invoke(client, ['pTTL', 'pttl'], [key], signal))
    if (includeSize) requests.push(invoke(client, ['memoryUsage'], [key], signal))
    const settled = await Promise.allSettled(requests)
    if (signal?.aborted || settled.some((result) => result.status === 'rejected' && redisErrorKind(result.reason) === 'cancelled')) throw abortError()
    const ttlResult = includeTtl ? settled[0] : undefined
    const sizeResult = includeSize ? settled[includeTtl ? 1 : 0] : undefined
    const ttlValue = ttlResult?.status === 'fulfilled' ? Number(ttlResult.value) : Number.NaN
    const ttlState = !Number.isFinite(ttlValue)
      ? 'unavailable'
      : ttlValue >= 0
        ? 'expires'
        : ttlValue === -1
          ? 'persistent'
          : ttlValue === -2
            ? 'missing'
            : 'unavailable'
    return {
      ...(includeTtl ? { ttlMs: ttlValue >= 0 ? ttlValue : null, ttlState } : {}),
      ...(sizeResult?.status === 'fulfilled' && Number.isFinite(Number(sizeResult.value)) ? { sizeBytes: Number(sizeResult.value) } : {}),
    }
  }

  async function scanRawKeys(client, { cursor, match, count, type, signal }) {
    const reply = await invoke(client, ['scan'], [cursor, {
      MATCH: match,
      COUNT: count,
      ...(type && type !== 'json' ? { TYPE: type } : {}),
    }], signal)
    const normalized = normalizeScanReply(reply, ['keys', 'items'])
    if (normalized.values.length > resultItemLimit) {
      throw Object.assign(new Error('redis_result_too_many_items'), { code: 'REDIS_RESULT_TOO_LARGE' })
    }
    return { rawKeys: normalized.values, nextCursor: normalized.cursor }
  }

  async function estimateSearchTotal(client, maxScanned, signal) {
    try {
      const value = Number(await invoke(client, ['dbSize', 'dbsize'], [], signal))
      return { estimatedTotal: Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maxScanned) : undefined }
    } catch {
      // DBSIZE può essere negato dalle ACL. È solo un aiuto visuale: la
      // ricerca SCAN resta valida e non deve fallire se la stima manca.
      return {}
    }
  }

  async function readKeyFromClient(client, key, {
    collectionPrefetchByteLimit = REDIS_COLLECTION_PREFETCH_BYTE_LIMIT,
    count,
    cursor,
    includeTtl = true,
    offset,
    signal,
    stringPreviewByteLimit = REDIS_STRING_PREVIEW_BYTE_LIMIT,
  }) {
    // TYPE, TTL e MEMORY USAGE sono indipendenti. Inviarli insieme permette a
    // node-redis di accodarli nello stesso ciclo di rete senza cambiare il
    // contratto o richiedere MULTI/EXEC sul server.
    const [typeValue, keyMetadata] = await Promise.all([
      invoke(client, ['type'], [key], signal),
      metadata(client, key, signal, { includeTtl }),
    ])
    const type = normalizeType(typeValue)
    if (type === 'none') throw Object.assign(new Error('redis_key_not_found'), { code: 'REDIS_KEY_NOT_FOUND' })
    if (!KEY_TYPE_SET.has(type)) throw Object.assign(new Error('redis_unsupported_type'), { code: 'REDIS_KEY_TYPE_UNSUPPORTED' })
    const base = { key: encodedKey(key), type, ...keyMetadata }
    let result

    if (type !== 'string') {
      if (!Number.isFinite(base.sizeBytes)) throw Object.assign(new Error('redis_result_size_unavailable'), { code: 'REDIS_SIZE_UNAVAILABLE' })
      const prefetchLimit = type === 'json' ? resultItemByteLimit : collectionPrefetchByteLimit
      if (base.sizeBytes > prefetchLimit) throw Object.assign(new Error('redis_prefetch_too_large'), { code: 'REDIS_PREFETCH_TOO_LARGE' })
    }

    if (type === 'string') {
      const previewLimit = Math.max(1, Math.min(resultItemByteLimit, stringPreviewByteLimit))
      const [totalValue, previewValue] = await Promise.all([
        invoke(client, ['strLen', 'strlen'], [key], signal),
        invoke(client, ['getRange', 'getrange'], [key, 0, previewLimit - 1], signal),
      ])
      const totalBytes = Number(totalValue)
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new Error('redis_invalid_string_length')
      const value = valueForRenderer(totalBytes === 0 ? Buffer.alloc(0) : previewValue)
      result = { ...base, value, previewBytes: Math.min(totalBytes, previewLimit), totalBytes, truncated: totalBytes > previewLimit }
    } else if (type === 'list') {
      const [values, totalValue] = await Promise.all([
        invoke(client, ['lRange', 'lrange'], [key, offset, offset + count - 1], signal),
        invoke(client, ['lLen', 'llen'], [key], signal),
      ])
      const total = Number(totalValue)
      const page = (Array.isArray(values) ? values : []).slice(0, count).map((value, index) => ({ index: offset + index, value: valueForRenderer(value) }))
      result = { ...base, items: page, nextOffset: offset + page.length, total, hasMore: offset + page.length < total }
    } else if (type === 'hash') {
      const reply = normalizeScanReply(await invoke(client, ['hScan', 'hscan'], [key, cursor, { COUNT: count }], signal), ['entries', 'tuples'])
      let entries = reply.values
      if (entries.length && !Array.isArray(entries[0]) && typeof entries[0] !== 'object') {
        const flat = entries; entries = []
        for (let index = 0; index < flat.length; index += 2) entries.push({ field: flat[index], value: flat[index + 1] })
      }
      entries = entries.map((entry) => Array.isArray(entry)
        ? { field: valueForRenderer(entry[0]), value: valueForRenderer(entry[1]) }
        : { field: valueForRenderer(entry.field), value: valueForRenderer(entry.value) })
      result = { ...base, entries, cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'set') {
      const reply = normalizeScanReply(await invoke(client, ['sScan', 'sscan'], [key, cursor, { COUNT: count }], signal), ['members', 'items'])
      result = { ...base, members: reply.values.map(valueForRenderer), cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'zset') {
      const reply = normalizeScanReply(await invoke(client, ['zScan', 'zscan'], [key, cursor, { COUNT: count }], signal), ['members', 'items'])
      let members = reply.values
      if (members.length && typeof members[0] !== 'object') {
        const flat = members; members = []
        for (let index = 0; index < flat.length; index += 2) members.push({ value: flat[index], score: flat[index + 1] })
      }
      members = members.map((member) => ({ value: valueForRenderer(member.value), score: Number(member.score) }))
      result = { ...base, members, cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'stream') {
      const start = cursor !== '0' ? `(${cursor}` : '-'
      const values = await invoke(client, ['xRange', 'xrange'], [key, start, '+', { COUNT: count + 1 }], signal)
      const page = (Array.isArray(values) ? values : []).slice(0, count).map((entry) => ({
        id: valueForRenderer(entry.id ?? entry[0]),
        fields: Object.entries(entry.message ?? entry[1] ?? {}).map(([field, value]) => ({ field, value: valueForRenderer(value) })),
      }))
      const nextCursor = page.at(-1)?.id ?? cursor
      result = { ...base, entries: page, cursor: nextCursor, hasMore: Array.isArray(values) && values.length > count }
    } else {
      const jsonClient = commandClient(client, signal)
      if (!jsonClient.json || typeof jsonClient.json.get !== 'function') throw Object.assign(new Error('redis_json_unavailable'), { code: 'REDIS_READ_FAILED' })
      result = { ...base, value: await jsonClient.json.get(key) }
    }
    let measured
    try {
      measured = budgetItems([result], { byteLimit: resultByteLimit, itemByteLimit: resultItemByteLimit, itemLimit: 1 })
    } catch (error) {
      // Solo un contatore numerico, mai payload: consente alla ricerca di
      // contabilizzare anche una risposta già letta ma scartata dal budget IPC.
      const readBytes = type === 'string'
        ? result.previewBytes
        : Number.isFinite(base.sizeBytes) ? Math.max(1, Math.ceil(base.sizeBytes)) : resultItemByteLimit
      if (error && (typeof error === 'object' || typeof error === 'function')) {
        try { Object.defineProperty(error, 'redisReadBytes', { value: readBytes }) } catch { /* Contatore diagnostico best effort. */ }
      }
      throw error
    }
    return Object.freeze({ ...result, resultBytes: measured.bytes })
  }

  async function testConnection(workspacePath, connectionId, { signal } = {}) {
    try {
      const { client } = await getSession(workspacePath, connectionId, { signal })
      const startedAt = Date.now()
      await invoke(client, ['ping'], [], signal)
      return Object.freeze({ ok: true, connected: true, latencyMs: Date.now() - startedAt })
    } catch (error) {
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error, { phase: 'connection' })
    }
  }

  async function testConnectionInput(input, { signal } = {}) {
    let session
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('redis_input_invalid')
      const config = validateConnectionConfig({ ...input, database: input.database ?? 0 })
      const client = createClientForConfig(config)
      if (!client || typeof client.connect !== 'function') throw Object.assign(new Error('redis_client_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
      session = { client, errorListener: null, lastError: null }
      session.errorListener = (error) => { session.lastError = error }
      client.on?.('error', session.errorListener)
      if (signal?.aborted) throw abortError()
      try {
        await connectSession(session, signal)
      } catch (error) {
        throw connectionErrorWithCause(error, session)
      }
      const startedAt = Date.now()
      await invoke(client, ['ping'], [], signal)
      const latencyMs = Date.now() - startedAt
      let serverVersion
      try {
        const info = await invoke(client, ['info'], ['server'], signal)
        const match = /(?:^|\r?\n)redis_version:([^\r\n]{1,64})/u.exec(valueForRenderer(info))
        const version = match?.[1].trim()
        if (version && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$/u.test(version)) serverVersion = version
      } catch (error) {
        if (signal?.aborted) throw error
        // INFO può essere negato via ACL: PING riuscito è sufficiente per il test.
      }
      return Object.freeze({ ok: true, latencyMs, ...(serverVersion ? { serverVersion } : {}) })
    } catch (error) {
      throw toRedisPublicError(error, { phase: 'connection' })
    } finally {
      if (session) await disposeSession(session).catch(() => { forceDisposeSession(session) })
    }
  }

  async function scanKeys(workspacePath, connectionId, input = {}) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('redis_input_invalid')
      const cursor = cursorOption(input.cursor)
      const match = patternOption(input.match)
      const count = integerOption(input.count, 100, 1, REDIS_SCAN_LIMIT)
      const type = input.type === undefined || input.type === 'all' ? null : normalizeType(input.type)
      if (type && !KEY_TYPE_SET.has(type)) throw new Error('redis_input_invalid')
      const { client } = await getSession(workspacePath, connectionId, { signal: input.signal })
      const { rawKeys, nextCursor } = await scanRawKeys(client, { cursor, match, count, type, signal: input.signal })
      const summaries = await mapWithConcurrency(rawKeys, metadataConcurrency, async (key) => {
        const [keyTypeValue, keyMetadata] = await Promise.all([
          type && type !== 'json' ? type : invoke(client, ['type'], [key], input.signal),
          metadata(client, key, input.signal, { includeSize: false }),
        ])
        const keyType = normalizeType(keyTypeValue)
        return { key: encodedKey(key), type: keyType, ...keyMetadata }
      })
      const filtered = summaries.filter((item) => KEY_TYPE_SET.has(item.type) && (!type || item.type === type))
      const { bytes, items } = budgetItems(filtered, { byteLimit: resultByteLimit, itemByteLimit: resultItemByteLimit, itemLimit: resultItemLimit })
      return Object.freeze({
        items, nextCursor, complete: nextCursor === '0', resultBytes: bytes, scanned: rawKeys.length,
        // Alias mantenuti per il renderer iniziale; non contengono mai il valore della chiave.
        cursor: nextCursor, keys: items, hasMore: nextCursor !== '0',
      })
    } catch (error) {
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  async function readKey(workspacePath, connectionId, keyRef, options = {}) {
    try {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('redis_input_invalid')
      const key = keyBytes(keyRef)
      const count = integerOption(options.count, 100, 1, REDIS_READ_LIMIT)
      const cursor = cursorOption(options.cursor)
      const offset = integerOption(options.offset, 0, 0, 2_147_483_647)
      const { client } = await getSession(workspacePath, connectionId, { signal: options.signal })
      return await readKeyFromClient(client, key, { count, cursor, offset, signal: options.signal })
    } catch (error) {
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  function findSearchablePart(inspection, query) {
    const match = (value, path) => {
      if (typeof value !== 'string') return null
      const matchIndex = value.toLocaleLowerCase().indexOf(query)
      return matchIndex < 0 ? null : { matchIndex, path, value }
    }
    if (inspection.type === 'string') return match(inspection.value)
    if (inspection.type === 'hash') {
      for (const { field, value } of inspection.entries) {
        const found = match(field, field) ?? match(value, field)
        if (found) return found
      }
    } else if (inspection.type === 'list') {
      for (const { index, value } of inspection.items) {
        const found = match(value, `[${index}]`)
        if (found) return found
      }
    } else if (inspection.type === 'set' || inspection.type === 'zset') {
      for (const member of inspection.members) {
        const found = match(typeof member === 'string' ? member : member.value)
        if (found) return found
      }
    } else if (inspection.type === 'stream') {
      for (const entry of inspection.entries) {
        for (const { field, value } of entry.fields) {
          const found = match(value, `${entry.id}.${field}`)
          if (found) return found
        }
      }
    } else if (inspection.type === 'json') {
      return match(JSON.stringify(inspection.value), '$')
    }
    return null
  }

  async function searchKeys(workspacePath, connectionId, input = {}, progress) {
    let operationId = typeof input?.operationId === 'string' ? input.operationId : ''
    let scanned = 0
    let truncated = false
    let partialPayloads = false
    let searchReadBytes = 0
    let searchReadBudgetExhausted = false
    let matches = []
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.operationId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.operationId)) throw new Error('redis_input_invalid')
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 256 || hasControlCharacter(input.query)) throw new Error('redis_input_invalid')
      if (progress !== undefined && typeof progress !== 'function') throw new Error('redis_input_invalid')
      operationId = input.operationId
      const query = input.query.toLocaleLowerCase()
      const count = integerOption(input.count, 100, 1, 200)
      const limit = integerOption(input.limit, 50, 1, REDIS_SEARCH_MATCH_LIMIT)
      const maxScanned = integerOption(input.maxScanned, REDIS_SEARCH_KEY_LIMIT, 1, REDIS_SEARCH_KEY_LIMIT)
      const exactKey = input.keyRef === undefined ? null : keyBytes({ encoded: input.keyRef })
      const keyPattern = exactKey ? null : patternOption(input.keyPattern)
      const typeFilter = input.type === undefined || input.type === 'all' ? null : normalizeType(input.type)
      if (typeFilter && !KEY_TYPE_SET.has(typeFilter)) throw new Error('redis_input_invalid')
      const { client } = await getSession(workspacePath, connectionId, { signal: input.signal })
      let estimateResult = exactKey ? { estimatedTotal: 1 } : null
      if (!exactKey) {
        // La stima è strettamente best-effort: non entra mai nel critical path
        // di SCAN, progress o risultato. Il timeout comando ne limita comunque
        // la durata e il segnale dell’operazione la interrompe in cancellazione.
        void estimateSearchTotal(client, maxScanned, input.signal).then((result) => { estimateResult = result })
      }
      let estimatedTotal
      let cursor = '0'
      do {
        if (input.signal?.aborted) return Object.freeze({ operationId, scanned, matches, truncated, cancelled: true })
        const page = exactKey
          ? { rawKeys: [exactKey], nextCursor: '0' }
          : await scanRawKeys(client, {
            cursor,
            match: keyPattern,
            count,
            type: typeFilter,
            signal: input.signal,
          })
        cursor = page.nextCursor
        let pageIndex = 0
        while (pageIndex < page.rawKeys.length && scanned < maxScanned && matches.length < limit && !searchReadBudgetExhausted) {
          const batchSize = Math.min(searchConcurrency, page.rawKeys.length - pageIndex, maxScanned - scanned)
          const batch = page.rawKeys.slice(pageIndex, pageIndex + batchSize)
          pageIndex += batch.length
          const outcomes = await mapWithConcurrency(batch, searchConcurrency, async (key) => {
            let inspection
            try {
              inspection = await readKeyFromClient(client, key, {
                collectionPrefetchByteLimit: resultItemByteLimit,
                count: Math.min(count, 50),
                cursor: '0',
                includeTtl: false,
                offset: 0,
                signal: input.signal,
                stringPreviewByteLimit: REDIS_SEARCH_STRING_PREVIEW_BYTE_LIMIT,
              })
            } catch (error) {
              const kind = normalizeRedisError(error).kind
              if (kind === 'size-unavailable' || kind === 'prefetch-too-large') return { partial: true }
              if (kind === 'result-too-large') {
                return {
                  partial: true,
                  readBytes: Number.isSafeInteger(error?.redisReadBytes) && error.redisReadBytes > 0
                    ? error.redisReadBytes
                    : resultItemByteLimit,
                }
              }
              if (kind === 'key-not-found' || kind === 'type-changed' || error?.code === 'REDIS_KEY_TYPE_UNSUPPORTED') return {}
              throw error
            }
            if (typeFilter && inspection.type !== typeFilter) return {}
            const part = findSearchablePart(inspection, query)
            return { inspection, part, partial: Boolean(inspection.truncated || inspection.hasMore) }
          })
          for (let index = 0; index < outcomes.length; index += 1) {
            scanned += 1
            const { inspection, part, partial, readBytes } = outcomes[index]
            if (partial) partialPayloads = true
            const accountedBytes = inspection?.resultBytes ?? readBytes
            if (Number.isSafeInteger(accountedBytes) && accountedBytes > 0) {
              // Tutte le letture del batch sono già in volo: vengono conteggiate
              // integralmente, ma nessun batch successivo parte dopo il limite.
              // L'overshoot massimo resta quindi il solo batch già in volo.
              searchReadBytes += accountedBytes
              if (searchReadBytes >= searchReadByteLimit) {
                searchReadBudgetExhausted = true
                partialPayloads = true
              }
            }
            if (!inspection) continue
            if (!part) continue
            if (matches.length >= limit) {
              truncated = true
              continue
            }
            const excerptStart = Math.max(0, part.matchIndex - 80)
            matches.push({
              key: inspection.key,
              type: inspection.type,
              excerpt: part.value.slice(excerptStart, excerptStart + 240),
              ...(part.path ? { path: part.path } : {}),
            })
            if (matches.length >= limit && index < outcomes.length - 1) truncated = true
          }
        }
        if (input.signal?.aborted) throw abortError()
        estimatedTotal ??= estimateResult?.estimatedTotal
        const snapshot = {
          operationId,
          scanned,
          matches: [...matches],
          ...(estimatedTotal !== undefined ? { estimatedTotal } : {}),
        }
        if (progress) await Promise.resolve(progress(Object.freeze(snapshot)))
        if (searchReadBudgetExhausted) {
          truncated = true
          break
        }
        if (matches.length >= limit || scanned >= maxScanned) {
          if (pageIndex < page.rawKeys.length || cursor !== '0') truncated = true
          break
        }
      } while (cursor !== '0')
      const bounded = budgetItems(matches, { byteLimit: resultByteLimit, itemByteLimit: 16 * 1024, itemLimit: limit })
      matches = bounded.items
      return Object.freeze({ operationId, scanned, matches: bounded.items, resultBytes: bounded.bytes, truncated: truncated || partialPayloads || cursor !== '0', cancelled: false })
    } catch (error) {
      if (input?.signal?.aborted) return Object.freeze({ operationId, scanned, matches, truncated, cancelled: true })
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  const closeConnectionSession = (workspacePath, connectionId) => sessions.close(sessionKey(workspacePath, connectionId))
  const closeWorkspaceSessions = (workspacePath) => sessions.closeMatching((key) => key.startsWith(`${workspacePath}\u0000`))

  return {
    closeConnectionSession,
    closeWorkspaceSessions,
    getSession,
    inspectKey: readKey,
    readKey,
    scanKeys,
    searchKeys,
    searchPayload: searchKeys,
    testConnection,
    testConnectionInput,
  }
}

const defaultService = createRedisService()

module.exports = {
  ...defaultService,
  createRedisService,
  encodedKey,
  keyBytes,
  normalizeRedisError,
  sanitizeRedisDiagnostic,
  sessionKey,
  toRedisPublicError,
  validateConnectionConfig,
  REDIS_READ_LIMIT,
  REDIS_SCAN_LIMIT,
  REDIS_SEARCH_KEY_LIMIT,
  REDIS_SEARCH_MATCH_LIMIT,
}
