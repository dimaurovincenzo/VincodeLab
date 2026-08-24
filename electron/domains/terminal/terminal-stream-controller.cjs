const { createTerminalHistoryBuffer } = require('./terminal-history-buffer.cjs')

const TERMINAL_STREAM_LIMITS = Object.freeze({
  blockBytes: 64 * 1024,
  pauseBytes: 4 * 1024 * 1024,
  resumeBytes: 1 * 1024 * 1024,
  stallMs: 2_000,
  historyBytes: 4 * 1024 * 1024,
})

function createTerminalStreamController({
  pty,
  sessionId,
  sendBlock,
  sendState,
  limits = TERMINAL_STREAM_LIMITS,
  scheduleBatch = setImmediate,
  cancelBatch = clearImmediate,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
}) {
  const history = createTerminalHistoryBuffer({ maxBytes: limits.historyBytes })
  const queue = []
  const inputWaiters = []
  let pending = ''
  let pendingBytes = 0
  let sequence = 0
  let queuedBytes = 0
  let inFlight = null
  let batchTimer = null
  let stallTimer = null
  let rendererPhase = 'detached'
  let pausedForPressure = false
  let pausedForStall = false
  let ptyPaused = false
  let disposed = false
  let endedStatus
  let receivedBytes = 0
  let renderedBytes = 0
  let blockCount = 0
  let maxBlockBytes = 0
  let peakQueuedBytes = 0
  let pauseCount = 0
  let pausedSince = null
  let pausedMs = 0
  let rendererMetrics = {}

  const setStatus = (status) => sendState({ sessionId, status, queuedBytes })

  const syncPty = () => {
    const shouldPause = pausedForPressure || pausedForStall
    if (shouldPause && !ptyPaused) {
      pty.pause()
      ptyPaused = true
      pausedSince = now()
      pauseCount += 1
    }
    if (!shouldPause && ptyPaused) {
      pty.resume()
      ptyPaused = false
      pausedMs += Math.max(0, now() - pausedSince)
      pausedSince = null
    }
    if (!shouldPause) inputWaiters.splice(0).forEach((release) => release())
  }

  const updatePressure = () => {
    if (queuedBytes > limits.pauseBytes) pausedForPressure = true
    if (queuedBytes < limits.resumeBytes) pausedForPressure = false
    syncPty()
    if (pausedForPressure) setStatus('paused')
  }

  const pump = () => {
    if (disposed || rendererPhase !== 'connected' || inFlight || queue.length === 0) return
    inFlight = queue[0]
    sendBlock({ sessionId, sequence: inFlight.sequence, data: inFlight.data })
    stallTimer = setTimer(() => {
      pausedForStall = true
      syncPty()
      setStatus('stalled')
    }, limits.stallMs)
  }

  const enqueue = (data) => {
    const block = { sequence: ++sequence, data, bytes: Buffer.byteLength(data, 'utf8') }
    blockCount += 1
    maxBlockBytes = Math.max(maxBlockBytes, block.bytes)
    history.append(block)
    if (rendererPhase === 'detached') return
    queue.push(block)
    queuedBytes += block.bytes
    peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes)
    updatePressure()
    pump()
  }

  const flushBatch = () => {
    if (batchTimer !== null) cancelBatch(batchTimer)
    batchTimer = null
    if (!pending) return
    const data = pending
    pending = ''
    pendingBytes = 0
    enqueue(data)
  }

  const push = (data) => {
    if (disposed || typeof data !== 'string' || data.length === 0) return
    receivedBytes += Buffer.byteLength(data, 'utf8')
    for (const character of data) {
      const characterBytes = Buffer.byteLength(character, 'utf8')
      if (pending && pendingBytes + characterBytes > limits.blockBytes) flushBatch()
      pending += character
      pendingBytes += characterBytes
    }
    if (pendingBytes >= limits.blockBytes) flushBatch()
    else if (batchTimer === null) batchTimer = scheduleBatch(flushBatch)
  }

  const ack = (message) => {
    if (disposed || message?.sessionId !== sessionId || message.sequence !== inFlight?.sequence) return false
    if (stallTimer !== null) clearTimer(stallTimer)
    stallTimer = null
    pausedForStall = false
    const block = queue.shift()
    queuedBytes -= block.bytes
    renderedBytes += block.bytes
    inFlight = null
    updatePressure()
    setStatus(endedStatus && queue.length === 0 ? 'ended' : 'running')
    pump()
    return true
  }

  const createResumeSnapshot = () => {
    flushBatch()
    rendererPhase = 'connecting'
    if (stallTimer !== null) clearTimer(stallTimer)
    stallTimer = null
    inFlight = null
    queue.length = 0
    queuedBytes = 0
    pausedForStall = false
    pausedForPressure = false
    syncPty()
    setStatus('recovering')
    return {
      sessionId,
      snapshot: history.snapshot(),
      status: endedStatus ? 'ended' : 'recovering',
      exitStatus: endedStatus,
    }
  }

  const markRendererReady = (message) => {
    if (message?.sessionId !== sessionId) return false
    while (queue[0] && queue[0].sequence <= message.watermark) {
      const block = queue.shift()
      queuedBytes -= block.bytes
      renderedBytes += block.bytes
    }
    rendererPhase = 'connected'
    updatePressure()
    setStatus(endedStatus && queue.length === 0 ? 'ended' : 'running')
    pump()
    return true
  }

  const disconnect = (message) => {
    if (disposed || message?.sessionId !== sessionId || rendererPhase === 'detached') return false
    if (stallTimer !== null) clearTimer(stallTimer)
    stallTimer = null
    rendererPhase = 'detached'
    inFlight = null
    queue.length = 0
    queuedBytes = 0
    pausedForPressure = false
    pausedForStall = false
    syncPty()
    return true
  }

  const waitForInputCapacity = (signal) => pausedForPressure || pausedForStall
    ? new Promise((resolve) => {
        let released = false
        const release = () => {
          if (released) return
          released = true
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          const index = inputWaiters.indexOf(release)
          if (index >= 0) inputWaiters.splice(index, 1)
          release()
        }
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        inputWaiters.push(release)
      })
    : Promise.resolve()

  const end = (status) => {
    flushBatch()
    endedStatus = status
    if (rendererPhase === 'connected' && queue.length === 0) setStatus('ended')
  }

  const dispose = () => {
    disposed = true
    if (batchTimer !== null) cancelBatch(batchTimer)
    if (stallTimer !== null) clearTimer(stallTimer)
    if (ptyPaused) {
      pty.resume()
      ptyPaused = false
      pausedMs += Math.max(0, now() - pausedSince)
      pausedSince = null
    }
    inputWaiters.splice(0).forEach((release) => release())
    rendererPhase = 'detached'
    queue.length = 0
    history.clear()
  }

  const updateRendererMetrics = (metrics) => { rendererMetrics = { ...metrics } }
  const getDiagnostics = () => ({
    receivedBytes,
    renderedBytes,
    queuedBytes,
    peakQueuedBytes,
    averageBlockBytes: blockCount === 0 ? 0 : receivedBytes / blockCount,
    maxBlockBytes,
    pauseCount,
    pausedMs: pausedMs + (ptyPaused ? Math.max(0, now() - pausedSince) : 0),
    renderer: rendererMetrics,
    rendererConnected: rendererPhase === 'connected',
  })

  return {
    push,
    ack,
    createResumeSnapshot,
    disconnect,
    rendererReady: markRendererReady,
    waitForInputCapacity,
    end,
    dispose,
    updateRendererMetrics,
    getDiagnostics,
  }
}

module.exports = { TERMINAL_STREAM_LIMITS, createTerminalStreamController }
