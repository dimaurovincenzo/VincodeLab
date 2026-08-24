// Coordinatore del flusso xterm specifico delle sessioni shell.
import type {
  ShellSessionDataEvent,
  ShellSessionOutputAck,
  ShellSessionRendererReady,
  ShellSessionResumeSnapshot,
} from '@/bridge'

type ShellXtermOutputControllerOptions = {
  sessionId: string
  write: (data: string, callback: () => void) => void
  ack: (message: ShellSessionOutputAck) => void
  ready: (message: ShellSessionRendererReady) => void
  onRendered?: (event: ShellSessionDataEvent) => void
  onWriteError: (error: unknown) => void
  onWriteTimeout?: (error: Error) => void
  writeTimeoutMs?: number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export function createShellXtermOutputController({
  sessionId,
  write,
  ack,
  ready,
  onRendered = () => undefined,
  onWriteError,
  onWriteTimeout = onWriteError,
  writeTimeoutMs = 3_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: ShellXtermOutputControllerOptions) {
  const queue: ShellSessionDataEvent[] = []
  let attachmentId = ''
  let generation = 0
  let epoch = 0
  let writing = false
  let disposed = false
  let lastAcceptedSequence = 0
  let writeTimer: ReturnType<typeof setTimeout> | null = null

  const clearWriteTimer = () => {
    if (writeTimer === null) return
    clearTimer(writeTimer)
    writeTimer = null
  }

  const watchWrite = (writeEpoch: number) => {
    clearWriteTimer()
    writeTimer = setTimer(() => {
      writeTimer = null
      if (disposed || writeEpoch !== epoch) return
      epoch += 1
      writing = false
      queue.length = 0
      onWriteTimeout(new Error('xterm_write_timeout'))
    }, writeTimeoutMs)
  }

  const pump = () => {
    if (disposed || writing || queue.length === 0) return
    const block = queue[0]
    const writeEpoch = epoch
    writing = true
    watchWrite(writeEpoch)
    try {
      write(block.data, () => {
        if (disposed || writeEpoch !== epoch || queue[0] !== block) return
        clearWriteTimer()
        queue.shift()
        writing = false
        ack({ attachmentId: block.attachmentId, generation: block.generation, sequence: block.sequence })
        onRendered(block)
        pump()
      })
    } catch (error) {
      clearWriteTimer()
      writing = false
      onWriteError(error)
    }
  }

  const accept = (block: ShellSessionDataEvent) => {
    if (
      disposed
      || block?.sessionId !== sessionId
      || block.attachmentId !== attachmentId
      || block.generation !== generation
      || !Number.isSafeInteger(block.sequence)
      || block.sequence <= lastAcceptedSequence
    ) return false
    lastAcceptedSequence = block.sequence
    queue.push(block)
    pump()
    return true
  }

  const restore = (snapshot: ShellSessionResumeSnapshot, renderedSnapshot: string) => {
    if (disposed || snapshot?.sessionId !== sessionId || typeof snapshot.attachmentId !== 'string' || !snapshot.attachmentId || !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) return false
    epoch += 1
    attachmentId = snapshot.attachmentId
    generation = snapshot.generation
    lastAcceptedSequence = snapshot.watermark
    writing = false
    queue.length = 0
    const restoreEpoch = epoch
    const restoreAttachmentId = attachmentId
    const restoreGeneration = generation
    const announceReady = () => {
      if (disposed || restoreEpoch !== epoch) return
      clearWriteTimer()
      ready({ attachmentId: restoreAttachmentId, generation: restoreGeneration, watermark: snapshot.watermark })
    }
    if (!renderedSnapshot) announceReady()
    else {
      watchWrite(restoreEpoch)
      try { write(renderedSnapshot, announceReady) }
      catch (error) { clearWriteTimer(); onWriteError(error) }
    }
    return true
  }

  const reconnect = async (
    resume: () => Promise<ShellSessionResumeSnapshot>,
    renderSnapshot: (snapshot: ShellSessionResumeSnapshot) => string,
  ) => {
    const snapshot = await resume()
    return restore(snapshot, renderSnapshot(snapshot))
  }

  const currentGeneration = () => generation

  const currentConnection = () => attachmentId
    ? Object.freeze({ attachmentId, generation })
    : null

  const diagnostics = () => Object.freeze({
    generation,
    queuedBlocks: queue.length,
    writing,
  })

  const dispose = () => {
    disposed = true
    clearWriteTimer()
    epoch += 1
    writing = false
    queue.length = 0
  }

  return Object.freeze({ accept, currentConnection, currentGeneration, diagnostics, dispose, reconnect, restore })
}
