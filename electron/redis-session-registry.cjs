class RedisSessionInvalidatedError extends Error {
  constructor() {
    super('La sessione Redis è stata chiusa durante la connessione.')
    this.name = 'RedisSessionInvalidatedError'
    this.code = 'REDIS_SESSION_INVALIDATED'
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
      if (outcome !== 'closed') await force(session)
      return outcome
    })()
    if (typeof session === 'object' || typeof session === 'function') disposals.set(session, promise)
    return promise
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
    if (sessions.has(key)) return sessions.get(key)
    if (openings.has(key)) return openings.get(key).promise

    const generation = generations.get(key) ?? 0
    const record = { candidate: null, generation, invalidated: false, promise: null }
    const setCandidate = (candidate) => {
      record.candidate = candidate
      if (record.invalidated) void dispose(candidate)
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
    sessions.delete(key)
    if (opening) {
      opening.invalidated = true
      openings.delete(key)
    }
    const cleanup = Promise.allSettled([
      dispose(session),
      dispose(opening?.candidate),
      opening ? settle(opening.promise) : Promise.resolve(),
    ]).then(() => undefined)
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
    if (typeof predicate !== 'function') throw new TypeError('Filtro sessioni Redis non valido.')
    const keys = new Set([...sessions.keys(), ...openings.keys(), ...closings.keys()])
    await Promise.allSettled([...keys].filter(predicate).map((key) => close(key)))
  }

  return { acquire, close, closeMatching, has: (key) => sessions.has(key) }
}

module.exports = { RedisSessionInvalidatedError, createRedisSessionRegistry }
