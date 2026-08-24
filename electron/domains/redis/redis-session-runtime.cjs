const { normalizeRedisError, toRedisPublicError } = require('./redis-error-mapper.cjs')
const { sessionKey, validateConnectionConfig } = require('./redis-input-model.cjs')
const { createRedisSessionRegistry } = require('./redis-session-registry.cjs')
const {
  abortError,
  connectionErrorWithCause,
  withAbort,
  withTimeout,
} = require('./redis-operation-utils.cjs')

function createRedisSessionRuntime({
  cleanupTimeoutMs,
  connectionTimeoutMs,
  createClient,
  createSentinel,
  getConnectionWithSecrets,
  sessionRegistry,
} = {}) {
  if (typeof createClient !== 'function') throw new TypeError('Factory client Redis non valida.')
  if (typeof createSentinel !== 'function') throw new TypeError('Factory Sentinel Redis non valida.')
  if (typeof getConnectionWithSecrets !== 'function') throw new TypeError('Store connessioni Redis non valido.')

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
      ? createSentinel(optionsForSentinel(config))
      : createClient(optionsForClient(config))
  }

  const forcedDisposals = new WeakMap()

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

  return Object.freeze({
    closeConnectionSession: (workspacePath, connectionId) => sessions.close(sessionKey(workspacePath, connectionId)),
    closeWorkspaceSessions: (workspacePath) => sessions.closeMatching((key) => key.startsWith(`${workspacePath}\u0000`)),
    connectSession,
    createClientForConfig,
    disposeSession,
    forceDisposeSession,
    getSession,
    invalidateFailedSession,
  })
}

module.exports = { createRedisSessionRuntime }
