export type RemoteTransferDirection = 'download' | 'upload'

export type RemoteTransferEvent = {
  id: string
  direction: RemoteTransferDirection
  name: string
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
}

export type RetryableRemoteTransferOperation = {
  direction: RemoteTransferDirection
  name: string | null
  acceptsMultiple?: boolean
  execute: () => Promise<void>
}

type PendingAttempt = {
  operation: RetryableRemoteTransferOperation
}

export function createRemoteTransferRetryController(onChange: () => void = () => undefined) {
  const pendingAttempts: PendingAttempt[] = []
  const retryableByTransferId = new Map<string, RetryableRemoteTransferOperation>()

  const removePendingAttempt = (attempt: PendingAttempt) => {
    const index = pendingAttempts.indexOf(attempt)
    if (index >= 0) pendingAttempts.splice(index, 1)
  }

  const run = async (operation: RetryableRemoteTransferOperation) => {
    const attempt = { operation }
    pendingAttempts.push(attempt)
    try {
      await operation.execute()
    } finally {
      removePendingAttempt(attempt)
    }
  }

  const observe = (transfer: RemoteTransferEvent) => {
    let changed = false
    if (!retryableByTransferId.has(transfer.id)) {
      const attempt = pendingAttempts.find(({ operation }) => operation.direction === transfer.direction && (operation.name === null || operation.name === transfer.name))
      if (attempt) {
        retryableByTransferId.set(transfer.id, attempt.operation)
        changed = true
        if (!attempt.operation.acceptsMultiple) removePendingAttempt(attempt)
      }
    }

    if (transfer.state === 'completed' || transfer.state === 'cancelled') {
      changed = retryableByTransferId.delete(transfer.id) || changed
    }
    if (changed) onChange()
  }

  const canRetry = (transferId: string) => retryableByTransferId.has(transferId)

  const retry = async (transferId: string) => {
    const operation = retryableByTransferId.get(transferId)
    if (!operation) return false

    let changed = false
    for (const [candidateId, candidateOperation] of retryableByTransferId) {
      if (candidateOperation !== operation) continue
      retryableByTransferId.delete(candidateId)
      changed = true
    }
    if (changed) onChange()

    await run(operation)
    return true
  }

  const reset = () => {
    const changed = pendingAttempts.length > 0 || retryableByTransferId.size > 0
    pendingAttempts.splice(0)
    retryableByTransferId.clear()
    if (changed) onChange()
  }

  return { canRetry, observe, reset, retry, run }
}

export type RemoteTransferRetryController = ReturnType<typeof createRemoteTransferRetryController>
