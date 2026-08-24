const { createDatabaseSessionRegistry } = require('./database-session-registry.cjs')
const { toDatabasePublicError } = require('./database-error-mapper.cjs')

const REMOTE_SESSION_CLEANUP_TIMEOUT_MS = 2_000
const REMOTE_SESSION_LIFECYCLE = Symbol('vincodelab.database-remote-session-lifecycle')
const remoteSessionDisposals = new WeakMap()
const forceClosedRemoteSessions = new WeakSet()

function remoteSessionEmitter(session) {
  if (session?.driver === 'mysql') return session.client?.connection ?? session.client
  return session?.client
}

function detachRemoteSessionLifecycle(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (!lifecycle || lifecycle.detached) return
  lifecycle.detached = true
  for (const [event, listener] of lifecycle.listeners) lifecycle.emitter.removeListener?.(event, listener)
  lifecycle.listeners.length = 0
}

function markRemoteSessionClosing(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (lifecycle) lifecycle.closing = true
}

function attachRemoteSessionLifecycle(session, onFailure = () => undefined) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return null
  if (session[REMOTE_SESSION_LIFECYCLE]) return session[REMOTE_SESSION_LIFECYCLE]
  const emitter = remoteSessionEmitter(session)
  if (!emitter || typeof emitter.on !== 'function') return null

  let resolveFailure
  const lifecycle = {
    closing: false,
    detached: false,
    emitter,
    error: null,
    failure: new Promise((resolve) => { resolveFailure = resolve }),
    invalidated: false,
    listeners: [],
  }
  Object.defineProperty(session, REMOTE_SESSION_LIFECYCLE, { value: lifecycle })

  const notify = (event, error) => {
    if (lifecycle.closing || lifecycle.invalidated) return
    lifecycle.invalidated = true
    lifecycle.error = error instanceof Error ? error : Object.assign(new Error('Connessione database interrotta.'), { code: 'DATABASE_CONNECTION_LOST' })
    resolveFailure(lifecycle.error)
    try {
      onFailure({ error: lifecycle.error, event, session })
    } catch {
      // Un listener driver non deve mai trasformare una disconnessione in un
      // uncaught exception del processo main.
    }
  }
  lifecycle.notify = notify
  for (const event of ['error', 'end', 'close']) {
    const listener = event === 'error' ? (error) => notify(event, error) : () => notify(event)
    lifecycle.listeners.push([event, listener])
    emitter.on(event, listener)
  }
  return lifecycle
}

function raceRemoteSessionFailure(session, operation) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (!lifecycle) return operation
  if (lifecycle.error) return Promise.reject(lifecycle.error)
  return Promise.race([
    Promise.resolve(operation),
    lifecycle.failure.then((error) => Promise.reject(error)),
  ])
}

async function closeMssqlClient(client) {
  if (!client || client.closed || typeof client.close !== 'function') return
  if (typeof client.once !== 'function') {
    await Promise.resolve(client.close())
    return
  }
  await new Promise((resolve, reject) => {
    let completed = false
    const finish = (error) => {
      if (completed) return
      completed = true
      client.removeListener?.('end', onEnd)
      client.removeListener?.('close', onEnd)
      client.removeListener?.('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onEnd = () => finish()
    const onError = (error) => finish(error)
    client.once('end', onEnd)
    client.once('close', onEnd)
    client.once('error', onError)
    try {
      const result = client.close()
      if (result && typeof result.then === 'function') result.then(onEnd, onError)
    } catch (error) {
      onError(error)
    }
  })
}

function disposeRemoteSession(session) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return Promise.resolve()
  const existing = remoteSessionDisposals.get(session)
  if (existing) return existing

  const disposal = (async () => {
    markRemoteSessionClosing(session)
    let closed = false
    try {
      await Promise.resolve(session.remoteOperationQueue).catch(() => {
        // La coda può contenere l'errore già restituito alla richiesta chiamante;
        // qui attendiamo soltanto il settlement prima di chiudere la sessione.
      })
      if (!session.client) {
        closed = true
        return
      }
      if (session.driver === 'mssql') {
        await closeMssqlClient(session.client)
        closed = true
        return
      }
      if (typeof session.client.end === 'function') await Promise.resolve(session.client.end())
      else if (typeof session.client.close === 'function') await Promise.resolve(session.client.close())
      closed = true
    } finally {
      // I listener restano attivi durante end()/close(): alcuni driver emettono
      // `error` nel teardown e, senza un listener, EventEmitter chiuderebbe il main.
      // Se il teardown fallisce, restano installati anche per il fallback forzato.
      if (closed) detachRemoteSessionLifecycle(session)
    }
  })()
  remoteSessionDisposals.set(session, disposal)
  return disposal
}

function forceCloseRemoteSession(session) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function') || forceClosedRemoteSessions.has(session)) return
  forceClosedRemoteSessions.add(session)
  markRemoteSessionClosing(session)
  const client = session?.client
  if (!client) return
  try {
    if (typeof client.destroy === 'function') client.destroy()
    else if (typeof client.connection?.stream?.destroy === 'function') client.connection.stream.destroy()
    else if (typeof client.socket?.destroy === 'function') client.socket.destroy()
    else if (typeof client.close === 'function') client.close()
  } catch {
    // Il fallback è best effort e non deve mascherare il failure originale.
  }
}

function invalidateRemoteSession(session, error) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (lifecycle && !lifecycle.invalidated) {
    const reason = error instanceof Error ? error : new Error('Sessione database invalidata.')
    lifecycle.notify('invalidated', reason)
  }
  forceCloseRemoteSession(session)
}

const remoteSessions = createDatabaseSessionRegistry({
  cleanupTimeoutMs: REMOTE_SESSION_CLEANUP_TIMEOUT_MS,
  closeSession: disposeRemoteSession,
  forceCloseSession: forceCloseRemoteSession,
})

function createRemoteSessionLifecycleController({ closeSession, invalidateSchema = () => undefined } = {}) {
  if (typeof closeSession !== 'function') throw new TypeError('closeSession deve essere una funzione.')
  if (typeof invalidateSchema !== 'function') throw new TypeError('invalidateSchema deve essere una funzione.')
  const activeSessions = new Map()
  const failures = new Map()

  function closeAfterFailure(key) {
    try {
      void Promise.resolve(closeSession(key)).catch(() => {
        // Il failure originario resta memorizzato per il renderer; questa chiusura
        // asincrona è best effort e verrà ritentata dal lifecycle di cleanup.
      })
    } catch {
      // Il failure è già memorizzato per il renderer; il cleanup resta best effort.
    }
  }

  function track(key, session) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chiave sessione non valida.')
    if (!session || (typeof session !== 'object' && typeof session !== 'function')) throw new TypeError('Sessione remota non valida.')
    if (activeSessions.get(key) === session) return session
    const previous = activeSessions.get(key)
    if (previous) markRemoteSessionClosing(previous)
    activeSessions.set(key, session)
    attachRemoteSessionLifecycle(session, ({ error, event }) => {
      if (activeSessions.get(key) !== session) return
      activeSessions.delete(key)
      if (event !== 'invalidated' && !failures.has(key)) failures.set(key, toDatabasePublicError(error, { fallbackKind: 'connection-lost', phase: 'connection' }))
      try { invalidateSchema(key) } catch { /* La cache verrà ricostruita alla prossima sessione. */ }
      closeAfterFailure(key)
    })
    return session
  }

  function consumeFailure(key) {
    const failure = failures.get(key) ?? null
    if (failure) failures.delete(key)
    return failure
  }

  function prepareClose(key, { clearFailure = true } = {}) {
    const session = activeSessions.get(key)
    if (session) {
      activeSessions.delete(key)
      markRemoteSessionClosing(session)
    }
    if (clearFailure) failures.delete(key)
  }

  function prepareCloseMatching(predicate, options) {
    if (typeof predicate !== 'function') throw new TypeError('predicate deve essere una funzione.')
    const keys = new Set([...activeSessions.keys(), ...failures.keys()])
    for (const key of keys) if (predicate(key)) prepareClose(key, options)
  }

  return {
    consumeFailure,
    hasFailure: (key) => failures.has(key),
    prepareClose,
    prepareCloseMatching,
    track,
  }
}

module.exports = {
  attachRemoteSessionLifecycle,
  createRemoteSessionLifecycleController,
  detachRemoteSessionLifecycle,
  disposeRemoteSession,
  forceCloseRemoteSession,
  invalidateRemoteSession,
  raceRemoteSessionFailure,
  remoteSessions,
}
