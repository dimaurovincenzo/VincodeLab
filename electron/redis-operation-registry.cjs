const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DEFAULT_CLEANUP_TIMEOUT_MS = 4_000

function cleanupTimeoutError() {
  return Object.assign(new Error('Le operazioni Redis non hanno confermato la chiusura entro il tempo previsto.'), { code: 'REDIS_OPERATION_CLEANUP_TIMEOUT' })
}

function createRedisOperationRegistry({ cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 60_000) throw new Error('Timeout cleanup Redis non valido.')
  const operations = new Map()

  function start({ operationId, senderId, workspacePath, connectionId, mutative = false }) {
    if (typeof operationId !== 'string' || !UUID_PATTERN.test(operationId)) throw new Error('Identificativo operazione Redis non valido.')
    if (!Number.isInteger(senderId) || senderId < 1 || typeof workspacePath !== 'string' || !workspacePath || typeof connectionId !== 'string' || !connectionId) throw new Error('Contesto operazione Redis non valido.')
    if (operations.has(operationId)) throw new Error('Operazione Redis già in esecuzione.')
    const controller = new AbortController()
    let resolveFinished
    const finished = new Promise((resolve) => { resolveFinished = resolve })
    const operation = { operationId, senderId, workspacePath, connectionId, mutative: Boolean(mutative), controller, finished }
    operations.set(operationId, operation)
    let completed = false
    return {
      signal: controller.signal,
      finish() {
        if (completed) return false
        completed = true
        if (operations.get(operationId) === operation) operations.delete(operationId)
        resolveFinished()
        return true
      },
    }
  }

  function cancel(operationId, senderId) {
    const operation = operations.get(operationId)
    if (!operation || operation.senderId !== senderId) return { cancelled: false, mutative: false }
    operation.controller.abort()
    return { cancelled: true, mutative: operation.mutative }
  }

  function abortMatching(predicate = () => true) {
    if (typeof predicate !== 'function') throw new Error('Filtro operazioni Redis non valido.')
    let cancelled = 0
    for (const operation of operations.values()) {
      if (!predicate(operation)) continue
      operation.controller.abort()
      cancelled += 1
    }
    return cancelled
  }

  function abortAndWaitMatching(predicate = () => true, { timeoutMs = cleanupTimeoutMs } = {}) {
    if (typeof predicate !== 'function') return Promise.reject(new Error('Filtro operazioni Redis non valido.'))
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return Promise.reject(new Error('Timeout cleanup Redis non valido.'))
    const matching = [...operations.values()].filter(predicate)
    for (const operation of matching) operation.controller.abort()
    if (!matching.length) return Promise.resolve(Object.freeze({ cancelled: 0 }))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback(value)
      }
      const timer = setTimeout(() => finish(reject, cleanupTimeoutError()), timeoutMs)
      Promise.all(matching.map((operation) => operation.finished)).then(
        () => finish(resolve, Object.freeze({ cancelled: matching.length })),
        (error) => finish(reject, error),
      )
    })
  }

  const abortWorkspace = (workspacePath, options) => typeof workspacePath === 'string' && workspacePath
    ? abortAndWaitMatching((operation) => operation.workspacePath === workspacePath, options)
    : Promise.reject(new Error('Workspace operazioni Redis non valido.'))
  const abortOwner = (senderId, options) => Number.isInteger(senderId) && senderId > 0
    ? abortAndWaitMatching((operation) => operation.senderId === senderId, options)
    : Promise.reject(new Error('Owner operazioni Redis non valido.'))

  return {
    abortAll: (options) => abortAndWaitMatching(() => true, options),
    abortAndWaitMatching,
    abortMatching,
    abortOwner,
    abortWorkspace,
    cancel,
    diagnostics: () => ({ activeOperations: operations.size }),
    start,
  }
}

module.exports = { DEFAULT_CLEANUP_TIMEOUT_MS, createRedisOperationRegistry }
