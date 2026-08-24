function createRemoteOperationLifecycle({
  lifecycleTimeoutMs,
  abortAllTransfers,
  abortWorkspaceTransfers,
  clearAllRegistries,
  clearWorkspaceRegistries,
  openWorkspaceDependency,
  resolveCloseAllDependency,
  resolveCloseWorkspaceDependency,
}) {
  const activeOperations = new Set()
  const closedWorkspaces = new Set()
  const cleanedWorkspaces = new Set()
  const workspaceClosePromises = new Map()
  const reopenWorkspaces = new Set()
  let closeAllPromise
  let closingAll = false

  function cancellationError() {
    const error = new Error('Operazione remota annullata.')
    error.name = 'AbortError'
    return error
  }

  function withOperation(workspacePath, operation) {
    if (closingAll || closedWorkspaces.has(workspacePath)) return Promise.reject(cancellationError())
    const controller = new AbortController()
    const active = { workspacePath, controller, settled: undefined }
    const pending = Promise.resolve().then(async () => {
      const result = await operation(controller.signal)
      if (controller.signal.aborted) throw cancellationError()
      return result
    })
    active.settled = pending.then(() => undefined, () => undefined)
    activeOperations.add(active)
    return pending.finally(() => activeOperations.delete(active))
  }

  function waitForLifecycle(promises) {
    if (promises.length === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        callback(value)
      }
      const timer = setTimeout(() => {
        const error = new Error('Il cleanup dei file remoti non è terminato entro il tempo previsto.')
        error.code = 'REMOTE_LIFECYCLE_TIMEOUT'
        finish(reject, error)
      }, lifecycleTimeoutMs)
      Promise.allSettled(promises).then((results) => {
        const failure = results.find((result) => result.status === 'rejected')
        if (failure) finish(reject, failure.reason)
        else finish(resolve)
      }, (error) => finish(reject, error))
    })
  }

  function clearWorkspaceResources(workspacePath) {
    for (const operation of activeOperations) {
      if (operation.workspacePath === workspacePath) activeOperations.delete(operation)
    }
    clearWorkspaceRegistries(workspacePath)
  }

  function closeWorkspace(workspacePath) {
    reopenWorkspaces.delete(workspacePath)
    const existing = workspaceClosePromises.get(workspacePath)
    if (existing) return existing
    if (cleanedWorkspaces.has(workspacePath)) return Promise.resolve()
    closedWorkspaces.add(workspacePath)
    const matchingOperations = [...activeOperations].filter((operation) => operation.workspacePath === workspacePath)
    for (const operation of matchingOperations) operation.controller.abort()
    abortWorkspaceTransfers(workspacePath)
    const targets = matchingOperations.map((operation) => operation.settled)
    const closeDependency = resolveCloseWorkspaceDependency?.()
    if (typeof closeDependency === 'function') targets.push(Promise.resolve().then(() => closeDependency(workspacePath)))
    const closing = waitForLifecycle(targets).then(() => {
      clearWorkspaceResources(workspacePath)
      cleanedWorkspaces.add(workspacePath)
    })
    workspaceClosePromises.set(workspacePath, closing)
    const release = () => {
      if (workspaceClosePromises.get(workspacePath) === closing) workspaceClosePromises.delete(workspacePath)
    }
    void closing.then(release, release)
    return closing
  }

  function closeAll() {
    if (closeAllPromise) return closeAllPromise
    closingAll = true
    reopenWorkspaces.clear()
    for (const operation of activeOperations) operation.controller.abort()
    abortAllTransfers()
    const targets = [...activeOperations].map((operation) => operation.settled)
    const closeDependency = resolveCloseAllDependency?.()
    if (typeof closeDependency === 'function') targets.push(Promise.resolve().then(() => closeDependency()))
    const closing = waitForLifecycle(targets).then(() => {
      activeOperations.clear()
      clearAllRegistries()
    })
    closeAllPromise = closing
    void closing.catch(() => {
      if (closeAllPromise === closing) closeAllPromise = undefined
    })
    return closing
  }

  function openWorkspace(workspacePath) {
    if (closingAll) return false
    reopenWorkspaces.add(workspacePath)
    const activate = () => {
      if (closingAll || !reopenWorkspaces.delete(workspacePath)) return
      closedWorkspaces.delete(workspacePath)
      cleanedWorkspaces.delete(workspacePath)
      openWorkspaceDependency?.(workspacePath)
    }
    const closing = workspaceClosePromises.get(workspacePath)
    if (closing) void closing.then(activate, () => undefined)
    else activate()
    return true
  }

  return {
    closeAll,
    closeWorkspace,
    getOperationCount: () => activeOperations.size,
    openWorkspace,
    withOperation,
  }
}

module.exports = { createRemoteOperationLifecycle }
