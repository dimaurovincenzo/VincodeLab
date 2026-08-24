const { SESSION_ID_PATTERN } = require('./shell-session-model.cjs')

const DEFAULT_SHELL_OUTPUT_HISTORY_BYTES = 4 * 1024 * 1024
const MAX_SHELL_OUTPUT_HISTORY_BYTES = 64 * 1024 * 1024
const SHELL_OUTPUT_BLOCK_BYTES = 64 * 1024
const DEFAULT_SHELL_OUTPUT_PAUSE_BYTES = 4 * 1024 * 1024
const DEFAULT_SHELL_OUTPUT_RESUME_BYTES = 1 * 1024 * 1024
const DEFAULT_SHELL_OUTPUT_STALL_MS = 2_000

function validateOutputOptions(options) {
  const maxHistoryBytes = options.maxHistoryBytes === undefined ? DEFAULT_SHELL_OUTPUT_HISTORY_BYTES : options.maxHistoryBytes
  const pauseBytes = options.pauseBytes === undefined ? DEFAULT_SHELL_OUTPUT_PAUSE_BYTES : options.pauseBytes
  const resumeBytes = options.resumeBytes === undefined ? DEFAULT_SHELL_OUTPUT_RESUME_BYTES : options.resumeBytes
  const stallMs = options.stallMs === undefined ? DEFAULT_SHELL_OUTPUT_STALL_MS : options.stallMs
  if (!Number.isSafeInteger(maxHistoryBytes) || maxHistoryBytes < 4 || maxHistoryBytes > MAX_SHELL_OUTPUT_HISTORY_BYTES) {
    throw new Error('Limite storico terminale non valido.')
  }
  if (!Number.isSafeInteger(pauseBytes) || pauseBytes < SHELL_OUTPUT_BLOCK_BYTES || pauseBytes > MAX_SHELL_OUTPUT_HISTORY_BYTES * 4) {
    throw new Error('Soglia pausa output terminale non valida.')
  }
  if (!Number.isSafeInteger(resumeBytes) || resumeBytes < 0 || resumeBytes >= pauseBytes) {
    throw new Error('Soglia ripresa output terminale non valida.')
  }
  if (!Number.isSafeInteger(stallMs) || stallMs < 10 || stallMs > 60_000) {
    throw new Error('Timeout output terminale non valido.')
  }
  return Object.freeze({ maxHistoryBytes, pauseBytes, resumeBytes, stallMs })
}

function splitUtf8Output(data, maxBytes) {
  const totalBytes = Buffer.byteLength(data, 'utf8')
  if (totalBytes <= maxBytes) return [{ data, bytes: totalBytes }]
  const blocks = []
  let characters = []
  let bytes = 0
  for (const character of data) {
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (characters.length > 0 && bytes + characterBytes > maxBytes) {
      blocks.push({ data: characters.join(''), bytes })
      characters = []
      bytes = 0
    }
    characters.push(character)
    bytes += characterBytes
  }
  if (characters.length > 0) blocks.push({ data: characters.join(''), bytes })
  return blocks
}

function createShellOutputTransport(options = {}) {
  const { maxHistoryBytes, pauseBytes, resumeBytes, stallMs } = validateOutputOptions(options)
  const onData = options.onData ?? (() => undefined)
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout

  function emit(payload) {
    try {
      onData(Object.freeze(payload))
    } catch {
      // Gli eventi non possono compromettere il lifecycle del processo PTY.
    }
  }

  function initialize(session) {
    session.outputBlocks = []
    session.outputBytes = 0
    session.outputDroppedBytes = 0
    session.outputTruncated = false
    session.outputSequence = 0
    session.outputQueue = []
    session.outputQueuedBytes = 0
    session.outputPeakQueuedBytes = 0
    session.outputInFlight = null
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputPendingSnapshot = null
    session.outputPausedForPressure = false
    session.outputPausedForStall = false
    session.outputPtyPaused = false
    session.outputStallTimer = null
    session.outputPauseCount = 0
    session.outputReceivedBytes = 0
    session.outputAcknowledgedBytes = 0
  }

  function resetHistory(session) {
    session.outputBlocks = []
    session.outputBytes = 0
    session.outputDroppedBytes = 0
    session.outputTruncated = false
  }

  function clearStallTimer(session) {
    if (session.outputStallTimer !== null) clearTimer(session.outputStallTimer)
    session.outputStallTimer = null
  }

  function syncPressure(session) {
    const shouldPause = session.outputPausedForPressure || session.outputPausedForStall
    const ptyProcess = session.process
    if (shouldPause && !session.outputPtyPaused && ptyProcess && session.status === 'running') {
      ptyProcess.pause()
      session.outputPtyPaused = true
      session.outputPauseCount += 1
    } else if (!shouldPause && session.outputPtyPaused && ptyProcess && session.status === 'running') {
      ptyProcess.resume()
      session.outputPtyPaused = false
    }
  }

  function updatePressure(session) {
    if (session.outputQueuedBytes > pauseBytes) session.outputPausedForPressure = true
    if (session.outputQueuedBytes < resumeBytes) session.outputPausedForPressure = false
    syncPressure(session)
  }

  function pump(session) {
    if (!session.outputRendererReady || !session.outputAttachmentId || session.outputInFlight || session.outputQueue.length === 0) return
    const block = session.outputQueue[0]
    session.outputInFlight = block
    const timer = setTimer(() => {
      if (session.outputInFlight !== block) return
      session.outputStallTimer = null
      session.outputPausedForStall = true
      syncPressure(session)
    }, stallMs)
    timer?.unref?.()
    session.outputStallTimer = timer
    emit({
      workspacePath: session.workspacePath,
      sessionId: session.sessionId,
      attachmentId: session.outputAttachmentId,
      generation: block.generation,
      sequence: block.sequence,
      data: block.data,
    })
  }

  function resetTransport(session) {
    clearStallTimer(session)
    session.outputQueue = []
    session.outputQueuedBytes = 0
    session.outputInFlight = null
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputPendingSnapshot = null
    session.outputPausedForPressure = false
    session.outputPausedForStall = false
    session.outputPtyPaused = false
  }

  function append(session, generation, data) {
    const blockLimit = Math.min(SHELL_OUTPUT_BLOCK_BYTES, maxHistoryBytes)
    for (const chunk of splitUtf8Output(data, blockLimit)) {
      const sequence = ++session.outputSequence
      session.outputReceivedBytes += chunk.bytes
      const previous = session.outputBlocks.at(-1)
      if (previous && previous.bytes + chunk.bytes <= blockLimit) {
        previous.data += chunk.data
        previous.bytes += chunk.bytes
        previous.sequence = sequence
      } else {
        session.outputBlocks.push({ firstSequence: sequence, sequence, data: chunk.data, bytes: chunk.bytes })
      }
      session.outputBytes += chunk.bytes
      while (session.outputBytes > maxHistoryBytes) {
        const removed = session.outputBlocks.shift()
        if (!removed) break
        session.outputBytes -= removed.bytes
        session.outputDroppedBytes += removed.bytes
        session.outputTruncated = true
      }
      const block = { generation, sequence, data: chunk.data, bytes: chunk.bytes }
      session.outputQueue.push(block)
      session.outputQueuedBytes += block.bytes
      session.outputPeakQueuedBytes = Math.max(session.outputPeakQueuedBytes, session.outputQueuedBytes)
      updatePressure(session)
      pump(session)
    }
  }

  function resume(session, attachmentId) {
    clearStallTimer(session)
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputInFlight = null
    session.outputPausedForStall = false
    updatePressure(session)
    const blocks = session.outputBlocks.map((block) => Object.freeze({ sequence: block.sequence, data: block.data }))
    const snapshot = Object.freeze({
      sessionId: session.sessionId,
      attachmentId,
      generation: session.generation,
      blocks: Object.freeze(blocks),
      firstSequence: session.outputBlocks[0]?.firstSequence ?? 0,
      watermark: session.outputSequence,
      bytes: session.outputBytes,
      truncated: session.outputTruncated,
      droppedBytes: session.outputDroppedBytes,
      status: session.status,
      exitStatus: session.exitStatus
        ? Object.freeze({ exitCode: session.exitStatus.exitCode, signal: session.exitStatus.signal })
        : null,
    })
    session.outputPendingSnapshot = {
      attachmentId,
      generation: snapshot.generation,
      watermark: snapshot.watermark,
      bytes: snapshot.bytes,
      droppedBytes: snapshot.droppedBytes,
    }
    return snapshot
  }

  function rendererReady(session, message) {
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const watermark = Number(message?.watermark)
    const pending = session.outputPendingSnapshot
    if (typeof attachmentId !== 'string' || !SESSION_ID_PATTERN.test(attachmentId)) return false
    if (!Number.isSafeInteger(generation) || generation < 1 || !Number.isSafeInteger(watermark) || watermark < 0) return false
    if (!pending || attachmentId !== pending.attachmentId || generation !== session.generation || generation !== pending.generation || watermark !== pending.watermark) return false

    while (session.outputQueue[0] && session.outputQueue[0].generation === generation && session.outputQueue[0].sequence <= watermark) {
      const block = session.outputQueue.shift()
      session.outputQueuedBytes -= block.bytes
    }
    session.outputPendingSnapshot = null
    session.outputAttachmentId = attachmentId
    session.outputRendererReady = true
    session.outputPausedForStall = false
    updatePressure(session)
    pump(session)
    return true
  }

  function acknowledge(session, message) {
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const sequence = Number(message?.sequence)
    const block = session.outputInFlight
    if (!block || attachmentId !== session.outputAttachmentId || generation !== block.generation || sequence !== block.sequence) return false
    clearStallTimer(session)
    if (session.outputQueue[0] !== block) return false
    session.outputQueue.shift()
    session.outputQueuedBytes -= block.bytes
    session.outputAcknowledgedBytes += block.bytes
    session.outputInFlight = null
    session.outputPausedForStall = false
    updatePressure(session)
    pump(session)
    return true
  }

  function disconnect(session, message) {
    const attachmentId = message?.attachmentId
    const generation = Number(message?.generation)
    const matchesActive = attachmentId === session.outputAttachmentId
    const matchesPending = attachmentId === session.outputPendingSnapshot?.attachmentId
    if ((!matchesActive && !matchesPending) || generation !== session.generation) return false
    clearStallTimer(session)
    session.outputRendererReady = false
    session.outputAttachmentId = null
    session.outputPendingSnapshot = null
    session.outputInFlight = null
    session.outputPausedForStall = false
    updatePressure(session)
    return true
  }

  function diagnostics(session) {
    return Object.freeze({
      generation: session.generation,
      receivedBytes: session.outputReceivedBytes,
      acknowledgedBytes: session.outputAcknowledgedBytes,
      queuedBytes: session.outputQueuedBytes,
      queuedBlocks: session.outputQueue.length,
      peakQueuedBytes: session.outputPeakQueuedBytes,
      inFlightSequence: session.outputInFlight?.sequence ?? null,
      rendererConnected: session.outputRendererReady,
      paused: session.outputPtyPaused,
      pauseCount: session.outputPauseCount,
    })
  }

  function processStopped(session) {
    session.outputPtyPaused = false
  }

  return Object.freeze({
    acknowledge,
    append,
    diagnostics,
    disconnect,
    initialize,
    processStopped,
    rendererReady,
    resetHistory,
    resetTransport,
    resume,
  })
}

module.exports = {
  DEFAULT_SHELL_OUTPUT_HISTORY_BYTES,
  DEFAULT_SHELL_OUTPUT_PAUSE_BYTES,
  DEFAULT_SHELL_OUTPUT_RESUME_BYTES,
  DEFAULT_SHELL_OUTPUT_STALL_MS,
  SHELL_OUTPUT_BLOCK_BYTES,
  createShellOutputTransport,
  splitUtf8Output,
  validateOutputOptions,
}
