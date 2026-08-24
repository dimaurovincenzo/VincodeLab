const { randomUUID } = require('node:crypto')

const DEFAULT_DRAIN_TIMEOUT_MS = 12_000

function assertContext(context) {
  if (!context || !Number.isInteger(context.ownerId) || context.ownerId < 0) throw new Error('Owner mutazione non valido.')
  if (context.workspacePath !== null && (typeof context.workspacePath !== 'string' || context.workspacePath.length > 4_096)) throw new Error('Workspace mutazione non valido.')
  if (typeof context.type !== 'string' || !/^[a-z][a-z0-9:.-]{0,95}$/u.test(context.type)) throw new Error('Tipo mutazione non valido.')
  return { ownerId: context.ownerId, workspacePath: context.workspacePath, type: context.type }
}

function createExternalMutationRegistry({ drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 1 || drainTimeoutMs > 120_000) throw new Error('Timeout mutazioni non valido.')
  const operations = new Map()

  function run(context, operation) {
    const normalized = assertContext(context)
    if (typeof operation !== 'function') throw new Error('Operazione mutativa non valida.')
    const duplicate = [...operations.values()].find((entry) => entry.ownerId === normalized.ownerId
      && entry.workspacePath === normalized.workspacePath
      && entry.type === normalized.type)
    if (duplicate) {
      const error = new Error('Questa operazione è già in corso. Attendi il completamento e aggiorna lo stato prima di riprovare.')
      error.code = 'MUTATION_IN_PROGRESS'
      throw error
    }

    const id = randomUUID()
    const operationPromise = Promise.resolve().then(operation)
    const promise = operationPromise.finally(() => operations.delete(id))
    const settled = promise.then(() => undefined, () => undefined)
    operations.set(id, { id, ...normalized, promise, settled })
    return promise
  }

  function waitMatching(predicate = () => true, { timeoutMs = drainTimeoutMs } = {}) {
    if (typeof predicate !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Attesa mutazioni non valida.')
    const matching = [...operations.values()].filter(predicate)
    if (matching.length === 0) return Promise.resolve({ settled: 0 })
    return new Promise((resolve, reject) => {
      let finished = false
      const complete = (callback, value) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        callback(value)
      }
      const timer = setTimeout(() => {
        const error = new Error('Una modifica esterna non ha ancora confermato il completamento.')
        error.code = 'MUTATION_DRAIN_TIMEOUT'
        complete(reject, error)
      }, timeoutMs)
      timer.unref?.()
      Promise.all(matching.map((entry) => entry.settled)).then(
        () => complete(resolve, { settled: matching.length }),
        (error) => complete(reject, error),
      )
    })
  }

  return Object.freeze({
    active: () => [...operations.values()].map(({ id, ownerId, workspacePath, type }) => ({ id, ownerId, workspacePath, type })),
    run,
    waitAll: (options) => waitMatching(() => true, options),
    waitOwner: (ownerId, options) => waitMatching((entry) => entry.ownerId === ownerId, options),
    waitWorkspace: (workspacePath, options) => waitMatching((entry) => entry.workspacePath === workspacePath, options),
    waitMatching,
  })
}

module.exports = { DEFAULT_DRAIN_TIMEOUT_MS, createExternalMutationRegistry }
