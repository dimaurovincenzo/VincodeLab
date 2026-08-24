function createWindowCloseCoordinator({ cleanup, closeWindow, onFailure = () => false }) {
  if (typeof cleanup !== 'function' || typeof closeWindow !== 'function' || typeof onFailure !== 'function') {
    throw new Error('Coordinator di chiusura finestra non configurato.')
  }

  let pending

  function request(context) {
    if (pending) return pending

    let operation
    operation = (async () => {
      while (true) {
        try {
          await cleanup(context)
          await closeWindow(context)
          return true
        } catch (error) {
          let retry = false
          try {
            retry = await onFailure(error, context) === true
          } catch {
            retry = false
          }
          if (!retry) return false
        }
      }
    })().finally(() => {
      if (pending === operation) pending = undefined
    })
    pending = operation
    return operation
  }

  function isPending() {
    return Boolean(pending)
  }

  return Object.freeze({ isPending, request })
}

module.exports = { createWindowCloseCoordinator }
