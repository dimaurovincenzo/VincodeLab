// Protocollo applicativo dell'incolla controllato nel terminale AI.
const DEFAULT_CHUNK_BYTES = 16 * 1024

function* splitUtf8Chunks(text, maxBytes = DEFAULT_CHUNK_BYTES) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new TypeError('Parametri paste non validi.')
  const encoder = new TextEncoder()
  let offset = 0

  while (offset < text.length) {
    let low = offset + 1
    let high = Math.min(text.length, offset + maxBytes)
    let end = offset
    while (low <= high) {
      const candidate = Math.floor((low + high) / 2)
      const bytes = encoder.encode(text.slice(offset, candidate)).byteLength
      if (bytes <= maxBytes) {
        end = candidate
        low = candidate + 1
      } else {
        high = candidate - 1
      }
    }
    // Un blocco non deve dividere una coppia UTF-16 che rappresenta un solo code point.
    if (end < text.length && end > offset && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end -= 1
    if (end <= offset) throw new Error('Il blocco UTF-8 non può essere suddiviso senza perdita.')
    yield text.slice(offset, end)
    offset = end
  }
}

function createTerminalPasteController({ startPaste, writePasteChunk, cancelPaste, chunkBytes = DEFAULT_CHUNK_BYTES }) {
  const encoder = new TextEncoder()
  let active = null

  async function send(text, onProgress = () => {}) {
    if (active) return { status: 'failed', reason: 'busy', sentBytes: 0, totalBytes: encoder.encode(text).byteLength }
    const totalBytes = encoder.encode(text).byteLength
    const token = { transferId: null, cancelled: false, cancellationError: null, sentBytes: 0, totalBytes }
    active = token
    onProgress({ status: 'starting', sentBytes: 0, totalBytes })

    try {
      const started = await startPaste({ totalBytes })
      if (!started.accepted) {
        const failed = { status: 'failed', reason: started.reason, sentBytes: 0, totalBytes, limit: started.limit }
        onProgress(failed)
        return failed
      }
      token.transferId = started.transferId
      if (totalBytes === 0) {
        const complete = { status: 'complete', sentBytes: 0, totalBytes: 0 }
        onProgress(complete)
        return complete
      }

      let index = 0
      for (const data of splitUtf8Chunks(text, chunkBytes)) {
        if (token.cancelled) return { status: 'cancelled', sentBytes: token.sentBytes, totalBytes }
        const result = await writePasteChunk({ transferId: started.transferId, index, data })
        if (token.cancelled) {
          const stopped = token.cancellationError
            ? { status: 'failed', reason: 'cancel-unavailable', sentBytes: result.sentBytes ?? token.sentBytes, totalBytes: result.totalBytes || totalBytes, error: token.cancellationError }
            : { status: 'cancelled', sentBytes: result.sentBytes ?? token.sentBytes, totalBytes: result.totalBytes || totalBytes }
          onProgress(stopped)
          return stopped
        }
        if (!result.accepted) {
          const status = result.reason === 'cancelled' || token.cancelled ? 'cancelled' : 'failed'
          const stopped = { status, reason: result.reason, sentBytes: result.sentBytes, totalBytes: result.totalBytes || totalBytes }
          onProgress(stopped)
          return stopped
        }
        token.sentBytes = result.sentBytes
        const progress = { status: result.complete ? 'complete' : 'running', sentBytes: result.sentBytes, totalBytes }
        onProgress(progress)
        index += 1
        if (result.complete) return progress
      }

      const failed = { status: 'failed', reason: 'incomplete', sentBytes: token.sentBytes, totalBytes }
      onProgress(failed)
      return failed
    } catch (error) {
      const cancellationUnconfirmed = Boolean(token.cancellationError)
      const failed = {
        status: token.cancelled && !cancellationUnconfirmed ? 'cancelled' : 'failed',
        reason: cancellationUnconfirmed ? 'cancel-unavailable' : token.cancelled ? 'cancelled' : 'unavailable',
        sentBytes: token.sentBytes,
        totalBytes,
      }
      onProgress(failed)
      return { ...failed, error: token.cancellationError ?? error }
    } finally {
      if (active === token) active = null
    }
  }

  async function cancel(onProgress = () => {}) {
    const token = active
    if (!token) return { status: 'cancelled', sentBytes: 0, totalBytes: 0 }
    token.cancelled = true
    try {
      const result = token.transferId ? await cancelPaste(token.transferId) : { cancelled: true, sentBytes: token.sentBytes, totalBytes: token.totalBytes }
      const cancelled = { status: 'cancelled', sentBytes: result.sentBytes, totalBytes: result.totalBytes || token.totalBytes }
      onProgress(cancelled)
      return cancelled
    } catch (error) {
      token.cancellationError = error
      const failed = { status: 'failed', reason: 'cancel-unavailable', sentBytes: token.sentBytes, totalBytes: token.totalBytes, error }
      onProgress(failed)
      return failed
    }
  }

  return { send, cancel, isActive: () => active !== null }
}

export { DEFAULT_CHUNK_BYTES, createTerminalPasteController, splitUtf8Chunks }
