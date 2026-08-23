const DEFAULT_LATENCY_SAMPLE_LIMIT = 2_048

export function createXtermOutputController({
  write,
  ack,
  ready,
  onRendered,
  onWriteError,
  now = performance.now.bind(performance),
  writeTimeoutMs = 3_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  latencySampleLimit = DEFAULT_LATENCY_SAMPLE_LIMIT,
}) {
  let sessionId
  let disposed = false
  let writing = false
  let generation = 0
  let restoreCount = 0
  const queue = []
  const requestedLatencySampleLimit = Number.isFinite(latencySampleLimit) ? latencySampleLimit : DEFAULT_LATENCY_SAMPLE_LIMIT
  const boundedLatencySampleLimit = Math.min(65_536, Math.max(1, Math.floor(requestedLatencySampleLimit)))
  const latencies = new Array(boundedLatencySampleLimit)
  let latencyCount = 0
  let latencyCursor = 0
  let slowFrames = 0
  let writeTimer = null

  function recordLatency(value) {
    latencies[latencyCursor] = value
    latencyCursor = (latencyCursor + 1) % boundedLatencySampleLimit
    latencyCount = Math.min(latencyCount + 1, boundedLatencySampleLimit)
    if (value > 16.7) slowFrames += 1
  }

  function clearWriteTimer() {
    if (writeTimer === null) return
    clearTimer(writeTimer)
    writeTimer = null
  }

  function watchWrite(writeGeneration) {
    clearWriteTimer()
    writeTimer = setTimer(() => {
      writeTimer = null
      if (disposed || writeGeneration !== generation) return
      generation += 1
      writing = false
      onWriteError(new Error('xterm_write_timeout'))
    }, writeTimeoutMs)
  }

  function pump() {
    if (disposed || writing || queue.length === 0) return
    const block = queue[0]
    const writeGeneration = generation
    writing = true
    const startedAt = now()
    watchWrite(writeGeneration)
    try {
      write(block.data, () => {
        if (disposed || writeGeneration !== generation) return
        clearWriteTimer()
        queue.shift()
        writing = false
        recordLatency(Math.max(0, now() - startedAt))
        ack({ sessionId: block.sessionId, sequence: block.sequence })
        onRendered(block)
        pump()
      })
    } catch (error) {
      clearWriteTimer()
      writing = false
      onWriteError(error)
    }
  }

  function accept(block) {
    if (disposed || !block || block.sessionId !== sessionId) return false
    queue.push(block)
    pump()
    return true
  }

  function restore(payload) {
    if (disposed || !payload?.sessionId || !payload.snapshot) return false
    generation += 1
    restoreCount += 1
    sessionId = payload.sessionId
    queue.length = 0
    writing = false
    const restoreGeneration = generation
    const announceReady = () => {
      if (disposed || restoreGeneration !== generation) return
      clearWriteTimer()
      ready({ sessionId, watermark: payload.snapshot.watermark })
    }
    if (!payload.snapshot.data) announceReady()
    else {
      watchWrite(restoreGeneration)
      try { write(payload.snapshot.data, announceReady) }
      catch (error) { clearWriteTimer(); onWriteError(error) }
    }
    return true
  }

  async function reconnect(resume) {
    return restore(await resume())
  }

  function percentile(sortedValues, ratio) {
    if (sortedValues.length === 0) return 0
    return sortedValues[Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1)]
  }

  function metrics() {
    // Il campione resta limitato per tutta la sessione e viene ordinato una sola
    // volta per report: la diagnostica non deve mai competere con lo scroll.
    const sortedLatencies = latencies.slice(0, latencyCount).sort((a, b) => a - b)
    return {
      queuedBlocks: queue.length,
      ackP50Ms: percentile(sortedLatencies, 0.5),
      ackP95Ms: percentile(sortedLatencies, 0.95),
      ackP99Ms: percentile(sortedLatencies, 0.99),
      slowFrames,
      restoreCount,
      mode: 'standard',
    }
  }

  function dispose() {
    disposed = true
    clearWriteTimer()
    generation += 1
    writing = false
    queue.length = 0
  }

  return { accept, restore, reconnect, dispose, metrics }
}
