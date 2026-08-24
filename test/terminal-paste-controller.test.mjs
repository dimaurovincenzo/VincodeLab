import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalPasteController, splitUtf8Chunks } from '../src/features/ai/services/terminal-paste-controller.js'

test('non spezza surrogate pair e rispetta il limite byte', () => {
  const chunks = [...splitUtf8Chunks('a🚀b'.repeat(20), 9)]
  assert.equal(chunks.join(''), 'a🚀b'.repeat(20))
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 9))
})

test('consegna integralmente Unicode da 200 KB, 1 MB e 5 MB', async () => {
  for (const totalBytes of [200 * 1024, 1024 * 1024, 5 * 1024 * 1024]) {
    const text = 'è'.repeat(totalBytes / 2)
    let acceptedBytes = 0
    const received = []
    const controller = createTerminalPasteController({
      startPaste: async (input) => ({ accepted: true, transferId: `paste-${input.totalBytes}`, totalBytes: input.totalBytes }),
      writePasteChunk: async ({ data }) => { received.push(data); acceptedBytes += new TextEncoder().encode(data).byteLength; return { accepted: true, complete: acceptedBytes === totalBytes, sentBytes: acceptedBytes, totalBytes } },
      cancelPaste: async () => ({ cancelled: true, sentBytes: acceptedBytes, totalBytes }),
    })
    const result = await controller.send(text, () => {})
    assert.equal(result.status, 'complete')
    assert.equal(result.sentBytes, totalBytes)
    assert.equal(received.join(''), text)
  }
})

test('impedisce due paste contemporanei', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const controller = createTerminalPasteController({
    startPaste: async () => ({ accepted: true, transferId: 'one' }),
    writePasteChunk: async ({ data }) => { await blocked; return { accepted: true, complete: true, sentBytes: new TextEncoder().encode(data).byteLength } },
    cancelPaste: async () => ({ cancelled: true, sentBytes: 0 }),
  })
  const first = controller.send('uno', () => {})
  await Promise.resolve()
  const second = await controller.send('due', () => {})
  assert.equal(second.reason, 'busy')
  release()
  assert.equal((await first).status, 'complete')
})

test('mantiene visibile il fallimento quando il PTY non conferma l’annullamento', async () => {
  let releaseChunk
  let chunkStarted
  const chunkIsStarted = new Promise((resolve) => { chunkStarted = resolve })
  const blockedChunk = new Promise((resolve) => { releaseChunk = resolve })
  const progress = []
  const controller = createTerminalPasteController({
    startPaste: async () => ({ accepted: true, transferId: 'paste-cancel-failure' }),
    writePasteChunk: async ({ data }) => {
      chunkStarted()
      await blockedChunk
      return { accepted: true, complete: true, sentBytes: new TextEncoder().encode(data).byteLength }
    },
    cancelPaste: async () => { throw new Error('token=non-mostrare PTY_CANCEL_FAILED') },
  })

  const sending = controller.send('contenuto', (next) => progress.push(next))
  await chunkIsStarted
  const cancellation = await controller.cancel((next) => progress.push(next))
  assert.equal(cancellation.status, 'failed')
  assert.equal(cancellation.reason, 'cancel-unavailable')
  assert.match(cancellation.error.message, /PTY_CANCEL_FAILED/u)

  releaseChunk()
  const result = await sending
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'cancel-unavailable')
  assert.equal(progress.at(-1).status, 'failed')
  assert.equal(progress.at(-1).reason, 'cancel-unavailable')
})
