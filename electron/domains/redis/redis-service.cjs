const {
  normalizeRedisError,
  sanitizeRedisDiagnostic,
  toRedisPublicError,
} = require('./redis-error-mapper.cjs')
const {
  encodedKey,
  keyBytes,
  sessionKey,
  validateConnectionConfig,
} = require('./redis-input-model.cjs')
const {
  REDIS_RESULT_BYTE_LIMIT,
  REDIS_RESULT_ITEM_BYTE_LIMIT,
  REDIS_RESULT_ITEM_LIMIT,
} = require('./redis-result-budget.cjs')
const {
  REDIS_READ_LIMIT,
  REDIS_SCAN_LIMIT,
  createRedisReadService,
} = require('./redis-read-service.cjs')
const {
  REDIS_SEARCH_KEY_LIMIT,
  REDIS_SEARCH_MATCH_LIMIT,
  createRedisSearchService,
} = require('./redis-search-service.cjs')
const { createRedisSessionRuntime } = require('./redis-session-runtime.cjs')
const {
  abortError,
  connectionErrorWithCause,
  invoke,
  REDIS_COMMAND_TIMEOUT_MS,
  valueForRenderer,
} = require('./redis-operation-utils.cjs')

const REDIS_SESSION_CLEANUP_TIMEOUT_MS = 2_000
const REDIS_METADATA_CONCURRENCY = 32
const REDIS_SEARCH_CONCURRENCY = 12
const REDIS_SEARCH_READ_BYTE_LIMIT = 32 * 1_024 * 1_024
let redisPersistence = null
let redisClientAdapter = null

function configureRedisPersistence(persistence) {
  if (!persistence || typeof persistence.getConnectionWithSecrets !== 'function') throw new TypeError('Persistenza Redis non valida.')
  redisPersistence = Object.freeze({ getConnectionWithSecrets: persistence.getConnectionWithSecrets })
}

function configureRedisClientAdapter(adapter) {
  if (!adapter || typeof adapter.createClient !== 'function' || typeof adapter.createSentinel !== 'function') {
    throw new TypeError('Adapter client Redis non valido.')
  }
  redisClientAdapter = Object.freeze({
    createClient: adapter.createClient,
    createSentinel: adapter.createSentinel,
  })
}

function storedConnectionWithSecrets(...args) {
  if (!redisPersistence) throw new Error('Persistenza Redis non configurata.')
  return redisPersistence.getConnectionWithSecrets(...args)
}

function configuredRedisClient(options) {
  if (!redisClientAdapter) throw Object.assign(new Error('redis_client_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
  return redisClientAdapter.createClient(options)
}

function configuredRedisSentinel(options) {
  if (!redisClientAdapter) throw Object.assign(new Error('redis_client_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
  return redisClientAdapter.createSentinel(options)
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

  const sessionRuntime = createRedisSessionRuntime({
    cleanupTimeoutMs,
    connectionTimeoutMs,
    createClient: createClient ?? configuredRedisClient,
    createSentinel: createSentinel ?? configuredRedisSentinel,
    getConnectionWithSecrets,
    sessionRegistry,
  })
  const readService = createRedisReadService({
    getSession: sessionRuntime.getSession,
    invalidateFailedSession: sessionRuntime.invalidateFailedSession,
    metadataConcurrency,
    resultByteLimit,
    resultItemByteLimit,
    resultItemLimit,
  })
  const searchService = createRedisSearchService({
    estimateSearchTotal: readService.estimateSearchTotal,
    getSession: sessionRuntime.getSession,
    invalidateFailedSession: sessionRuntime.invalidateFailedSession,
    readKeyFromClient: readService.readKeyFromClient,
    resultByteLimit,
    resultItemByteLimit,
    scanRawKeys: readService.scanRawKeys,
    searchConcurrency,
    searchReadByteLimit,
  })

  async function testConnection(workspacePath, connectionId, { signal } = {}) {
    try {
      const { client } = await sessionRuntime.getSession(workspacePath, connectionId, { signal })
      const startedAt = Date.now()
      await invoke(client, ['ping'], [], signal)
      return Object.freeze({ ok: true, connected: true, latencyMs: Date.now() - startedAt })
    } catch (error) {
      await sessionRuntime.invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error, { phase: 'connection' })
    }
  }

  async function testConnectionInput(input, { signal } = {}) {
    let session
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('redis_input_invalid')
      const config = validateConnectionConfig({ ...input, database: input.database ?? 0 })
      const client = sessionRuntime.createClientForConfig(config)
      if (!client || typeof client.connect !== 'function') throw Object.assign(new Error('redis_client_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
      session = { client, errorListener: null, lastError: null }
      session.errorListener = (error) => { session.lastError = error }
      client.on?.('error', session.errorListener)
      if (signal?.aborted) throw abortError()
      try {
        await sessionRuntime.connectSession(session, signal)
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
      if (session) await sessionRuntime.disposeSession(session).catch(() => { sessionRuntime.forceDisposeSession(session) })
    }
  }

  return Object.freeze({
    closeConnectionSession: sessionRuntime.closeConnectionSession,
    closeWorkspaceSessions: sessionRuntime.closeWorkspaceSessions,
    getSession: sessionRuntime.getSession,
    inspectKey: readService.readKey,
    readKey: readService.readKey,
    scanKeys: readService.scanKeys,
    searchKeys: searchService.searchKeys,
    searchPayload: searchService.searchKeys,
    testConnection,
    testConnectionInput,
  })
}

const defaultService = createRedisService()

module.exports = {
  ...defaultService,
  configureRedisClientAdapter,
  configureRedisPersistence,
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
