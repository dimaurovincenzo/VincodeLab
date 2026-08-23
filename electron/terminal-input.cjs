const { randomUUID } = require('node:crypto')

const MAX_KEY_BYTES = 64 * 1024
const MAX_PASTE_BYTES = 5 * 1024 * 1024
const MAX_PASTE_CHUNK_BYTES = 16 * 1024

function utf8Bytes(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : -1
}

function writeTerminalKey(ptyProcess, data) {
  const bytes = utf8Bytes(data)
  if (!ptyProcess || typeof ptyProcess.write !== 'function' || bytes < 0 || bytes > MAX_KEY_BYTES) return false
  ptyProcess.write(data)
  return true
}

function createTerminalInputController({ getPty, waitForCapacity = async () => {}, createId = randomUUID } = {}) {
  const transfers = new Map()
  let disposed = false
  let startedPastes = 0
  let completedPastes = 0
  let cancelledPastes = 0
  let rejectedPastes = 0
  let pasteAcceptedBytes = 0
  let nextTransferGeneration = 0

  function start({ totalBytes } = {}) {
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
      rejectedPastes += 1
      return { accepted: false, reason: 'invalid', totalBytes, limit: MAX_PASTE_BYTES }
    }
    if (totalBytes > MAX_PASTE_BYTES) {
      rejectedPastes += 1
      return { accepted: false, reason: 'too-large', totalBytes, limit: MAX_PASTE_BYTES }
    }
    if (disposed || typeof getPty !== 'function' || !getPty()) {
      rejectedPastes += 1
      return { accepted: false, reason: 'not-running', totalBytes, limit: MAX_PASTE_BYTES }
    }

    const transferId = createId()
    startedPastes += 1
    if (totalBytes === 0) completedPastes += 1
    if (totalBytes > 0) {
      transfers.set(transferId, {
        transferId,
        generation: ++nextTransferGeneration,
        totalBytes,
        sentBytes: 0,
        nextIndex: 0,
        pendingIndex: null,
        cancelled: false,
        capacityController: new AbortController(),
      })
    }
    return { accepted: true, transferId, totalBytes }
  }

  async function chunk({ transferId, index, data } = {}) {
    const transfer = transfers.get(transferId)
    const bytes = utf8Bytes(data)
    if (!transfer || transfer.cancelled) return { accepted: false, reason: 'cancelled', sentBytes: transfer?.sentBytes ?? 0, totalBytes: transfer?.totalBytes ?? 0 }
    if (!Number.isSafeInteger(index) || index !== transfer.nextIndex || transfer.pendingIndex !== null || bytes < 0 || bytes > MAX_PASTE_CHUNK_BYTES || transfer.sentBytes + bytes > transfer.totalBytes) {
      return { accepted: false, reason: 'invalid-chunk', sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
    }

    const generation = transfer.generation
    transfer.pendingIndex = index
    try {
      await waitForCapacity(transfer.capacityController.signal)
      if (disposed || transfer.cancelled || transfer.generation !== generation || transfers.get(transferId) !== transfer) {
        return { accepted: false, reason: 'cancelled', sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
      }
      const ptyProcess = getPty()
      if (!ptyProcess || typeof ptyProcess.write !== 'function') {
        transfers.delete(transferId)
        return { accepted: false, reason: 'not-running', sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
      }

      ptyProcess.write(data)
      transfer.sentBytes += bytes
      pasteAcceptedBytes += bytes
      transfer.nextIndex += 1
      const complete = transfer.sentBytes === transfer.totalBytes
      if (complete) {
        completedPastes += 1
        transfers.delete(transferId)
      }
      return { accepted: true, complete, sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
    } finally {
      if (transfer.generation === generation && transfer.pendingIndex === index) transfer.pendingIndex = null
    }
  }

  function cancel(transferId) {
    const transfer = transfers.get(transferId)
    if (!transfer) return { cancelled: false, sentBytes: 0, totalBytes: 0 }
    transfer.cancelled = true
    transfer.generation += 1
    transfer.capacityController.abort()
    transfers.delete(transferId)
    cancelledPastes += 1
    return { cancelled: true, sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
  }

  function dispose() {
    disposed = true
    for (const transfer of transfers.values()) {
      transfer.cancelled = true
      transfer.generation += 1
      transfer.capacityController.abort()
    }
    transfers.clear()
  }

  function getDiagnostics() {
    return {
      activeTransfers: transfers.size,
      pendingBytes: [...transfers.values()].reduce((total, transfer) => total + transfer.totalBytes - transfer.sentBytes, 0),
      startedPastes,
      completedPastes,
      cancelledPastes,
      rejectedPastes,
      pasteAcceptedBytes,
    }
  }

  return { start, chunk, cancel, dispose, getDiagnostics }
}

module.exports = {
  MAX_KEY_BYTES,
  MAX_PASTE_BYTES,
  MAX_PASTE_CHUNK_BYTES,
  createTerminalInputController,
  writeTerminalKey,
}
