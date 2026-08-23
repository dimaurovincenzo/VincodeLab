class SessionInvalidatedError extends Error {
  constructor() {
    super('La sessione database è stata chiusa durante la connessione.')
    this.name = 'SessionInvalidatedError'
  }
}

function timeoutPromise(timeoutMs) {
  let timer
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function createDatabaseSessionRegistry({ closeSession, forceCloseSession = () => undefined, cleanupTimeoutMs = 2_000 } = {}) {
  if (typeof closeSession !== 'function') throw new TypeError('closeSession deve essere una funzione.')
  if (typeof forceCloseSession !== 'function') throw new TypeError('forceCloseSession deve essere una funzione.')
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1) throw new TypeError('cleanupTimeoutMs non valido.')

  const sessions = new Map()
  const openings = new Map()
  const closings = new Map()
  const generations = new Map()
  const disposalPromises = new WeakMap()

  function nextGeneration(key) {
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    return generation
  }

  function currentGeneration(key) {
    return generations.get(key) ?? 0
  }

  function disposeWithinDeadline(session) {
    if (!session) return Promise.resolve('empty')
    if ((typeof session === 'object' || typeof session === 'function') && disposalPromises.has(session)) return disposalPromises.get(session)

    const disposal = (async () => {
      const deadline = timeoutPromise(cleanupTimeoutMs)
      const graceful = Promise.resolve().then(() => closeSession(session))
      const outcome = await Promise.race([
        graceful.then(() => 'closed', () => 'failed'),
        deadline.promise,
      ])
      deadline.cancel()
      if (outcome !== 'closed') {
        await Promise.resolve().then(() => forceCloseSession(session)).catch(() => {
          // Il timeout di cleanup ha già determinato l'esito del drain; questa chiusura
          // forzata è best-effort e non deve sostituire l'incidente principale.
        })
      }
      return outcome
    })()

    if (typeof session === 'object' || typeof session === 'function') disposalPromises.set(session, disposal)
    return disposal
  }

  async function settleWithinDeadline(promise) {
    const deadline = timeoutPromise(cleanupTimeoutMs)
    const outcome = await Promise.race([
      Promise.resolve(promise).then(() => 'settled', () => 'settled'),
      deadline.promise,
    ])
    deadline.cancel()
    return outcome
  }

  async function acquire(key, openSession) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chiave sessione non valida.')
    if (typeof openSession !== 'function') throw new TypeError('openSession deve essere una funzione.')

    while (closings.has(key)) await closings.get(key)
    if (sessions.has(key)) return sessions.get(key)
    if (openings.has(key)) return openings.get(key).promise

    const generation = currentGeneration(key)
    const record = { candidate: null, generation, invalidated: false, promise: null }
    const setCandidate = (candidate) => {
      record.candidate = candidate
      if (record.invalidated) void disposeWithinDeadline(candidate)
    }

    record.promise = Promise.resolve()
      .then(() => openSession({ setCandidate }))
      .then(async (session) => {
        if (record.invalidated || currentGeneration(key) !== generation || openings.get(key) !== record) {
          await disposeWithinDeadline(session)
          throw new SessionInvalidatedError()
        }
        openings.delete(key)
        sessions.set(key, session)
        return session
      }, async (error) => {
        if (openings.get(key) === record) openings.delete(key)
        await disposeWithinDeadline(record.candidate)
        throw error
      })
    openings.set(key, record)
    return record.promise
  }

  function close(key) {
    const activeClosing = closings.get(key)
    if (activeClosing) return activeClosing

    nextGeneration(key)
    const session = sessions.get(key)
    const opening = openings.get(key)
    sessions.delete(key)
    if (opening) {
      opening.invalidated = true
      openings.delete(key)
    }

    const cleanup = (async () => {
      await Promise.allSettled([
        disposeWithinDeadline(session),
        disposeWithinDeadline(opening?.candidate),
        opening ? settleWithinDeadline(opening.promise) : Promise.resolve(),
      ])
    })()
    const tracked = cleanup.finally(() => {
      if (closings.get(key) === tracked) {
        closings.delete(key)
        if (!sessions.has(key) && !openings.has(key)) generations.delete(key)
      }
    })
    closings.set(key, tracked)
    return tracked
  }

  async function closeMatching(predicate) {
    if (typeof predicate !== 'function') throw new TypeError('predicate deve essere una funzione.')
    const keys = new Set([...sessions.keys(), ...openings.keys(), ...closings.keys()])
    await Promise.allSettled([...keys].filter(predicate).map((key) => close(key)))
  }

  return {
    acquire,
    close,
    closeMatching,
    has: (key) => sessions.has(key),
  }
}

module.exports = { SessionInvalidatedError, createDatabaseSessionRegistry }
