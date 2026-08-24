const crypto = require('node:crypto')

function createRemoteTransferRegistry({ notify }) {
  const transfers = new Map()

  function transferDto(transfer) {
    const { controller: _controller, workspacePath: _workspacePath, ...dto } = transfer
    return dto
  }

  function updateTransfer(transfer, patch) {
    Object.assign(transfer, patch)
    const dto = transferDto(transfer)
    notify(dto)
    return dto
  }

  function startTransfer({ workspacePath, direction, name, lifecycleSignal }) {
    const transfer = {
      id: crypto.randomUUID(), workspacePath, direction, name,
      state: 'queued', bytes: null, total: null, error: undefined,
      controller: new AbortController(),
    }
    const abortFromLifecycle = () => transfer.controller.abort()
    if (lifecycleSignal?.aborted) transfer.controller.abort()
    else lifecycleSignal?.addEventListener('abort', abortFromLifecycle, { once: true })
    transfers.set(transfer.id, transfer)
    updateTransfer(transfer, { state: 'running' })
    return {
      finish() {
        lifecycleSignal?.removeEventListener('abort', abortFromLifecycle)
        transfers.delete(transfer.id)
      },
      transfer,
    }
  }

  function cancelTransfer(workspacePath, transferId) {
    const transfer = transfers.get(transferId)
    if (!transfer || transfer.workspacePath !== workspacePath || transfer.state !== 'running') return false
    transfer.controller.abort()
    return true
  }

  function abortRunningForWorkspace(workspacePath) {
    for (const transfer of transfers.values()) {
      if (transfer.workspacePath === workspacePath && transfer.state === 'running') transfer.controller.abort()
    }
  }

  function abortAllRunning() {
    for (const transfer of transfers.values()) {
      if (transfer.state === 'running') transfer.controller.abort()
    }
  }

  function clearWorkspace(workspacePath) {
    for (const [id, transfer] of transfers) {
      if (transfer.workspacePath === workspacePath) transfers.delete(id)
    }
  }

  return {
    abortAllRunning,
    abortRunningForWorkspace,
    cancelTransfer,
    clear: () => transfers.clear(),
    clearWorkspace,
    getSize: () => transfers.size,
    startTransfer,
    updateTransfer,
  }
}

module.exports = { createRemoteTransferRegistry }
