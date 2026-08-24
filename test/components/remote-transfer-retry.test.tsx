import { describe, expect, it, vi } from 'vitest'
import { createRemoteTransferRetryController, type RemoteTransferEvent, type RetryableRemoteTransferOperation } from '@/features/remote-files/model/remote-transfer-retry'

function transfer(id: string, state: RemoteTransferEvent['state'], direction: RemoteTransferEvent['direction'] = 'download', name = 'report.md'): RemoteTransferEvent {
  return { id, direction, name, state }
}

describe('Remote transfer retry controller', () => {
  it('consuma atomicamente Riprova e ripete una sola volta la stessa chiamata con lo stesso ID opaco', async () => {
    const downloadAndTrack = vi.fn(async (_entryId: string) => undefined)
    const controller = createRemoteTransferRetryController()
    const operation: RetryableRemoteTransferOperation = {
      direction: 'download',
      name: 'report.md',
      execute: () => downloadAndTrack('opaque-entry-id'),
    }

    const initialRun = controller.run(operation)
    controller.observe(transfer('transfer-1', 'running'))
    await initialRun
    controller.observe(transfer('transfer-1', 'error'))

    expect(controller.canRetry('transfer-1')).toBe(true)
    const results = await Promise.all([
      controller.retry('transfer-1'),
      controller.retry('transfer-1'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(downloadAndTrack).toHaveBeenCalledTimes(2)
    expect(downloadAndTrack).toHaveBeenNthCalledWith(1, 'opaque-entry-id')
    expect(downloadAndTrack).toHaveBeenNthCalledWith(2, 'opaque-entry-id')
  })

  it('rende retryabile il nuovo transfer se anche il tentativo successivo fallisce', async () => {
    const controller = createRemoteTransferRetryController()
    let attempt = 0
    const operation: RetryableRemoteTransferOperation = {
      direction: 'download',
      name: 'report.md',
      execute: async () => {
        attempt += 1
        controller.observe(transfer(`transfer-${attempt}`, 'running'))
        controller.observe(transfer(`transfer-${attempt}`, 'error'))
      },
    }

    await controller.run(operation)
    expect(controller.canRetry('transfer-1')).toBe(true)

    await controller.retry('transfer-1')
    expect(controller.canRetry('transfer-1')).toBe(false)
    expect(controller.canRetry('transfer-2')).toBe(true)
    expect(attempt).toBe(2)
  })

  it('consuma insieme i transfer dello stesso upload multiplo per evitare di rieseguire il batch due volte', async () => {
    const controller = createRemoteTransferRetryController()
    let firstRun = true
    const execute = vi.fn(async () => {
      if (!firstRun) return
      firstRun = false
      controller.observe(transfer('upload-1', 'running', 'upload', 'first.txt'))
      controller.observe(transfer('upload-1', 'error', 'upload', 'first.txt'))
      controller.observe(transfer('upload-2', 'running', 'upload', 'second.txt'))
      controller.observe(transfer('upload-2', 'error', 'upload', 'second.txt'))
    })
    const operation: RetryableRemoteTransferOperation = {
      acceptsMultiple: true,
      direction: 'upload',
      name: null,
      execute,
    }

    await controller.run(operation)
    expect(controller.canRetry('upload-1')).toBe(true)
    expect(controller.canRetry('upload-2')).toBe(true)

    expect(await controller.retry('upload-1')).toBe(true)
    expect(await controller.retry('upload-2')).toBe(false)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('non propone retry per transfer completati, annullati, estranei o di un workspace resettato', async () => {
    const controller = createRemoteTransferRetryController()
    const operation: RetryableRemoteTransferOperation = {
      direction: 'download',
      name: 'report.md',
      execute: async () => undefined,
    }

    const completedRun = controller.run(operation)
    controller.observe(transfer('completed', 'running'))
    controller.observe(transfer('completed', 'completed'))
    await completedRun
    expect(controller.canRetry('completed')).toBe(false)

    const cancelledRun = controller.run(operation)
    controller.observe(transfer('cancelled', 'running'))
    controller.observe(transfer('cancelled', 'cancelled'))
    await cancelledRun
    expect(controller.canRetry('cancelled')).toBe(false)

    controller.observe(transfer('external', 'error'))
    expect(controller.canRetry('external')).toBe(false)

    const failedRun = controller.run(operation)
    controller.observe(transfer('failed', 'running'))
    controller.observe(transfer('failed', 'error'))
    await failedRun
    controller.reset()
    expect(controller.canRetry('failed')).toBe(false)
  })
})
