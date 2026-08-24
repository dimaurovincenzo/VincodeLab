function createDeferred() {
  let resolve
  const promise = new Promise((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function createGithubOperationRegistry() {
  const operations = new Map()

  function operationKey(senderId, workspacePath, type) {
    if (!Number.isInteger(senderId) || senderId < 1 || typeof workspacePath !== 'string' || workspacePath.length === 0 || typeof type !== 'string' || !/^[a-z][a-z0-9:-]{1,63}$/.test(type)) {
      throw new Error('Contesto operazione Git/GitHub non valido.')
    }
    return `${senderId}\0${workspacePath}\0${type}`
  }

  function startLatest({ senderId, workspacePath, type }) {
    const key = operationKey(senderId, workspacePath, type)
    const previous = operations.get(key)
    previous?.controller.abort()

    const controller = new AbortController()
    const finished = createDeferred()
    const operation = { senderId, workspacePath, type, controller, finished }
    operations.set(key, operation)
    let completed = false

    return Object.freeze({
      signal: controller.signal,
      ready: previous?.finished.promise ?? Promise.resolve(),
      finish() {
        if (completed) return false
        completed = true
        if (operations.get(key) === operation) operations.delete(key)
        finished.resolve()
        return true
      },
    })
  }

  function abortMatching(predicate = () => true) {
    let cancelled = 0
    for (const operation of operations.values()) {
      if (!predicate(operation) || operation.controller.signal.aborted) continue
      operation.controller.abort()
      cancelled += 1
    }
    return cancelled
  }

  async function abortAndWaitMatching(predicate = () => true) {
    const matching = [...operations.values()].filter(predicate)
    for (const operation of matching) operation.controller.abort()
    await Promise.all(matching.map((operation) => operation.finished.promise))
    return Object.freeze({ cancelled: matching.length })
  }

  function diagnostics() {
    const byType = {}
    for (const operation of operations.values()) byType[operation.type] = (byType[operation.type] ?? 0) + 1
    return Object.freeze({ activeOperations: operations.size, byType: Object.freeze(byType) })
  }

  return Object.freeze({ abortAndWaitMatching, abortMatching, diagnostics, startLatest })
}

module.exports = { createGithubOperationRegistry }
