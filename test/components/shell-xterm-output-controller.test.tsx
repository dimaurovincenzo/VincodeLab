import { describe, expect, it, vi } from 'vitest'
import { createShellXtermOutputController } from '@/lib/shell-xterm-output-controller'

const sessionId = 'session-0001'

function snapshot({
  attachmentId,
  generation = 1,
  data = '',
  sequence = 0,
}: {
  attachmentId: string
  generation?: number
  data?: string
  sequence?: number
}): ShellSessionResumeSnapshot {
  return {
    sessionId,
    attachmentId,
    generation,
    blocks: data ? [{ sequence, data }] : [],
    firstSequence: data ? sequence : 0,
    watermark: sequence,
    bytes: new TextEncoder().encode(data).byteLength,
    truncated: false,
    droppedBytes: 0,
    status: 'running',
    exitStatus: null,
  }
}

function harness() {
  const writes: Array<{ data: string; callback: () => void }> = []
  const ack = vi.fn()
  const ready = vi.fn()
  const onRendered = vi.fn()
  const onWriteError = vi.fn()
  const controller = createShellXtermOutputController({
    sessionId,
    write: (data, callback) => writes.push({ data, callback }),
    ack,
    ready,
    onRendered,
    onWriteError,
  })
  return { controller, writes, ack, ready, onRendered, onWriteError }
}

describe('shell xterm output controller', () => {
  it('invia ACK soltanto dal callback xterm e conserva Unicode e identità del collegamento', () => {
    const { controller, writes, ack, ready, onRendered } = harness()
    const restored = snapshot({ attachmentId: 'attach-0001' })
    expect(controller.restore(restored, '')).toBe(true)
    expect(ready).toHaveBeenCalledWith({ attachmentId: 'attach-0001', generation: 1, watermark: 0 })

    const event: ShellSessionDataEvent = {
      sessionId,
      attachmentId: 'attach-0001',
      generation: 1,
      sequence: 1,
      data: 'A🚀é漢字\r\n',
    }
    expect(controller.accept(event)).toBe(true)
    expect(writes.at(-1)?.data).toBe(event.data)
    expect(ack).not.toHaveBeenCalled()

    writes.at(-1)?.callback()
    expect(ack).toHaveBeenCalledOnce()
    expect(ack).toHaveBeenCalledWith({ attachmentId: 'attach-0001', generation: 1, sequence: 1 })
    expect(onRendered).toHaveBeenCalledWith(event)
    expect(controller.diagnostics()).toMatchObject({ queuedBlocks: 0, writing: false })
  })

  it('annuncia ready solo dopo che xterm ha completato lo snapshot', () => {
    const { controller, writes, ready } = harness()
    const restored = snapshot({ attachmentId: 'attach-0002', data: 'storico 🚀', sequence: 7 })

    expect(controller.restore(restored, 'storico 🚀')).toBe(true)
    expect(ready).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    writes[0].callback()
    expect(ready).toHaveBeenCalledWith({ attachmentId: 'attach-0002', generation: 1, watermark: 7 })
  })

  it('un reconnect invalida callback, eventi e ACK del collegamento precedente', () => {
    const { controller, writes, ack, ready } = harness()
    controller.restore(snapshot({ attachmentId: 'attach-old1', data: 'vecchio', sequence: 1 }), 'vecchio')
    const staleSnapshotCallback = writes[0].callback

    controller.restore(snapshot({ attachmentId: 'attach-new1', generation: 2, data: 'nuovo', sequence: 2 }), 'nuovo')
    staleSnapshotCallback()
    expect(ready).not.toHaveBeenCalled()
    writes[1].callback()
    expect(ready).toHaveBeenCalledWith({ attachmentId: 'attach-new1', generation: 2, watermark: 2 })

    expect(controller.accept({ sessionId, attachmentId: 'attach-old1', generation: 1, sequence: 3, data: 'stale' })).toBe(false)
    expect(controller.accept({ sessionId, attachmentId: 'attach-new1', generation: 2, sequence: 3, data: 'live' })).toBe(true)
    const staleLiveCallback = writes[2].callback
    controller.restore(snapshot({ attachmentId: 'attach-new2', generation: 2, sequence: 3 }), '')
    staleLiveCallback()
    expect(ack).not.toHaveBeenCalled()
    expect(controller.currentConnection()).toEqual({ attachmentId: 'attach-new2', generation: 2 })
  })

  it('dispose invalida il callback in volo e svuota ogni coda renderer', () => {
    const { controller, writes, ack } = harness()
    controller.restore(snapshot({ attachmentId: 'attach-0004' }), '')
    controller.accept({ sessionId, attachmentId: 'attach-0004', generation: 1, sequence: 1, data: 'in volo' })
    expect(controller.diagnostics()).toMatchObject({ queuedBlocks: 1, writing: true })

    controller.dispose()
    writes.at(-1)?.callback()
    expect(ack).not.toHaveBeenCalled()
    expect(controller.diagnostics()).toMatchObject({ queuedBlocks: 0, writing: false })
  })

  it('un errore sincrono di xterm non produce un ACK falso', () => {
    const ack = vi.fn()
    const onWriteError = vi.fn()
    const controller = createShellXtermOutputController({
      sessionId,
      write: () => { throw new Error('xterm write fallito') },
      ack,
      ready: vi.fn(),
      onWriteError,
    })
    controller.restore(snapshot({ attachmentId: 'attach-0005' }), '')

    expect(controller.accept({ sessionId, attachmentId: 'attach-0005', generation: 1, sequence: 1, data: 'non scritto' })).toBe(true)
    expect(onWriteError).toHaveBeenCalledOnce()
    expect(ack).not.toHaveBeenCalled()
    expect(controller.diagnostics()).toMatchObject({ queuedBlocks: 1, writing: false })
  })

  it('un callback mancante invalida la coda e richiede recovery senza ACK falso', () => {
    const timers: Array<() => void> = []
    const ack = vi.fn()
    const onWriteTimeout = vi.fn()
    const controller = createShellXtermOutputController({
      sessionId,
      write: () => undefined,
      ack,
      ready: vi.fn(),
      onWriteError: vi.fn(),
      onWriteTimeout,
      setTimer: ((callback: () => void) => { timers.push(callback); return callback }) as unknown as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
    })
    controller.restore(snapshot({ attachmentId: 'attach-timeout' }), '')
    controller.accept({ sessionId, attachmentId: 'attach-timeout', generation: 1, sequence: 1, data: 'bloccato' })

    timers.shift()?.()
    expect(onWriteTimeout).toHaveBeenCalledOnce()
    expect(ack).not.toHaveBeenCalled()
    expect(controller.diagnostics()).toMatchObject({ queuedBlocks: 0, writing: false })
    controller.dispose()
  })
})
