const { createDatabaseSessionRegistry } = require('./database-session-registry.cjs')
const { toDatabasePublicError } = require('./database-error-mapper.cjs')

const REMOTE_SESSION_CLEANUP_TIMEOUT_MS = 2_000
const REMOTE_SESSION_LIFECYCLE = Symbol('vincodelab.database-remote-session-lifecycle')
const remoteSessionDisposals = new WeakMap()
const forceClosedRemoteSessions = new WeakSet()

function detachRemoteSessionLifecycle(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (!lifecycle || lifecycle.detached) return
  lifecycle.detached = true
  lifecycle.unsubscribe()
}

function markRemoteSessionClosing(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (lifecycle) lifecycle.closing = true
}

function attachRemoteSessionLifecycle(session, onFailure = () => undefined) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return null
  if (session[REMOTE_SESSION_LIFECYCLE]) return session[REMOTE_SESSION_LIFECYCLE]
  if (!session.handle || typeof session.driverPort?.subscribeRemoteFailure !== 'function') return null

  let resolveFailure
  const lifecycle = {
    closing: false,
    detached: false,
    error: null,
    failure: new Promise((resolve) => { resolveFailure = resolve }),
    invalidated: false,
    unsubscribe: () => undefined,
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
  const unsubscribe = session.driverPort.subscribeRemoteFailure(session.handle, ({ error, event }) => notify(event, error))
  if (typeof unsubscribe !== 'function') throw new TypeError('Sottoscrizione lifecycle database non valida.')
  lifecycle.unsubscribe = unsubscribe
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
      if (!session.handle || typeof session.driverPort?.closeRemoteSession !== 'function') {
        closed = true
        return
      }
      await session.driverPort.closeRemoteSession(session.handle)
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
  try {
    session?.driverPort?.forceCloseRemoteSession?.(session.handle)
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
