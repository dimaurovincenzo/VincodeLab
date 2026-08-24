class RedisSessionInvalidatedError extends Error {
  constructor() {
    super('La sessione Redis è stata chiusa durante la connessione.')
    this.name = 'RedisSessionInvalidatedError'
    this.code = 'REDIS_SESSION_INVALIDATED'
  }
}

class RedisSessionCleanupError extends Error {
  constructor(message = 'La sessione Redis non ha confermato la chiusura.') {
    super(message)
    this.name = 'RedisSessionCleanupError'
    this.code = 'REDIS_SESSION_CLEANUP_FAILED'
  }
}

function deadline(timeoutMs) {
  let timer
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function createRedisSessionRegistry({ closeSession, forceCloseSession = () => undefined, cleanupTimeoutMs = 2_000 } = {}) {
  if (typeof closeSession !== 'function') throw new TypeError('closeSession deve essere una funzione.')
  if (typeof forceCloseSession !== 'function') throw new TypeError('forceCloseSession deve essere una funzione.')
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 60_000) throw new TypeError('cleanupTimeoutMs non valido.')

  const sessions = new Map()
  const openings = new Map()
  const closings = new Map()
  const failedClosures = new Map()
  const generations = new Map()
  const disposals = new WeakMap()

  async function force(session) {
    const timeout = deadline(cleanupTimeoutMs)
    const outcome = await Promise.race([
      Promise.resolve().then(() => forceCloseSession(session)).then(() => 'forced', () => 'failed'),
      timeout.promise,
    ])
    timeout.cancel()
    return outcome
  }

  const nextGeneration = (key) => {
    const generation = (generations.get(key) ?? 0) + 1
    generations.set(key, generation)
    return generation
  }

  function dispose(session) {
    if (!session) return Promise.resolve('empty')
    if ((typeof session === 'object' || typeof session === 'function') && disposals.has(session)) return disposals.get(session)
    const promise = (async () => {
      const timeout = deadline(cleanupTimeoutMs)
      const outcome = await Promise.race([
        Promise.resolve().then(() => closeSession(session)).then(() => 'closed', () => 'failed'),
        timeout.promise,
      ])
      timeout.cancel()
      if (outcome === 'closed') return outcome
      const forced = await force(session)
      if (forced === 'forced') return forced
      throw new RedisSessionCleanupError(forced === 'timeout'
        ? 'La chiusura forzata della sessione Redis ha superato il tempo disponibile.'
        : 'La chiusura forzata della sessione Redis non è riuscita.')
    })()
    if (typeof session !== 'object' && typeof session !== 'function') return promise
    let tracked
    tracked = promise.catch((error) => {
      if (disposals.get(session) === tracked) disposals.delete(session)
      throw error
    })
    disposals.set(session, tracked)
    return tracked
  }

  function retainFailedClosure(key, candidates) {
    const retained = failedClosures.get(key) ?? []
    for (const candidate of candidates) if (candidate && !retained.includes(candidate)) retained.push(candidate)
    if (retained.length) failedClosures.set(key, retained)
  }

  async function settle(promise) {
    const timeout = deadline(cleanupTimeoutMs)
    const outcome = await Promise.race([Promise.resolve(promise).then(() => 'settled', () => 'settled'), timeout.promise])
    timeout.cancel()
    return outcome
  }

  async function acquire(key, openSession) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chiave sessione Redis non valida.')
    if (typeof openSession !== 'function') throw new TypeError('openSession deve essere una funzione.')
    while (closings.has(key)) await closings.get(key)
    if (failedClosures.has(key)) throw new RedisSessionCleanupError('La precedente sessione Redis richiede un nuovo tentativo di disconnessione.')
    if (sessions.has(key)) return sessions.get(key)
    if (openings.has(key)) return openings.get(key).promise

    const generation = generations.get(key) ?? 0
    const record = { candidate: null, generation, invalidated: false, promise: null }
    const setCandidate = (candidate) => {
      record.candidate = candidate
      if (record.invalidated) void dispose(candidate).catch(() => retainFailedClosure(key, [candidate]))
    }
    record.promise = Promise.resolve()
      .then(() => openSession({ setCandidate }))
      .then(async (session) => {
        if (record.invalidated || (generations.get(key) ?? 0) !== generation || openings.get(key) !== record) {
          await dispose(session)
          throw new RedisSessionInvalidatedError()
        }
        openings.delete(key)
        sessions.set(key, session)
        return session
      }, async (error) => {
        if (openings.get(key) === record) openings.delete(key)
        await dispose(record.candidate)
        throw error
      })
    openings.set(key, record)
    return record.promise
  }

  function close(key) {
    if (typeof key !== 'string' || !key) return Promise.reject(new TypeError('Chiave sessione Redis non valida.'))
    if (closings.has(key)) return closings.get(key)
    nextGeneration(key)
    const session = sessions.get(key)
    const opening = openings.get(key)
    const retained = failedClosures.get(key) ?? []
    failedClosures.delete(key)
    sessions.delete(key)
    if (opening) {
      opening.invalidated = true
      openings.delete(key)
    }
    const targets = [...new Set([session, opening?.candidate, ...retained].filter(Boolean))]
    const cleanup = Promise.all([
      Promise.allSettled(targets.map((candidate) => dispose(candidate))),
      opening ? settle(opening.promise) : Promise.resolve('settled'),
    ]).then(([disposalResults, openingOutcome]) => {
      const failed = disposalResults.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
      if (openingOutcome === 'timeout') throw new RedisSessionCleanupError('La connessione Redis in apertura non ha confermato la chiusura.')
    })
    const tracked = cleanup.catch((error) => {
      retainFailedClosure(key, targets)
      throw error
    }).finally(() => {
      if (closings.get(key) === tracked) {
        closings.delete(key)
        if (!sessions.has(key) && !openings.has(key) && !failedClosures.has(key)) generations.delete(key)
      }
    })
    closings.set(key, tracked)
    return tracked
  }

  async function closeMatching(predicate) {
    if (typeof predicate !== 'function') throw new TypeError('Filtro sessioni Redis non valido.')
    const keys = new Set([...sessions.keys(), ...openings.keys(), ...closings.keys(), ...failedClosures.keys()])
    await Promise.allSettled([...keys].filter(predicate).map((key) => close(key)))
  }

  return { acquire, close, closeMatching, has: (key) => sessions.has(key) }
}

module.exports = { RedisSessionCleanupError, RedisSessionInvalidatedError, createRedisSessionRegistry }
