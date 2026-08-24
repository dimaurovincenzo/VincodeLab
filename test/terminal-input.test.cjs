const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_PASTE_BYTES, createTerminalInputController, writeTerminalKey } = require('../electron/domains/terminal/terminal-input.cjs')

test('accetta una sequenza interattiva breve senza round-trip', () => {
  const writes = []
  assert.equal(writeTerminalKey({ write: (data) => writes.push(data) }, '\x1b[A'), true)
  assert.deepEqual(writes, ['\x1b[A'])
})

test('rifiuta tasti invalidi o oltre il limite senza scrivere prefissi', () => {
  const writes = []
  const pty = { write: (data) => writes.push(data) }
  assert.equal(writeTerminalKey(null, 'x'), false)
  assert.equal(writeTerminalKey(pty, null), false)
  assert.equal(writeTerminalKey(pty, 'x'.repeat(65_537)), false)
  assert.deepEqual(writes, [])
})

test('trasferisce blocchi in ordine e consente di annullare', async () => {
  const writes = []
  const input = createTerminalInputController({ getPty: () => ({ write: (data) => writes.push(data) }), waitForCapacity: async () => {}, createId: () => 'paste-1' })
  const transfer = input.start({ totalBytes: 12 })
  assert.deepEqual(transfer, { accepted: true, transferId: 'paste-1', totalBytes: 12 })
  await input.chunk({ transferId: transfer.transferId, index: 0, data: 'Città ' })
  const result = input.cancel(transfer.transferId)
  assert.equal(result.cancelled, true)
  assert.equal(result.sentBytes, Buffer.byteLength('Città ', 'utf8'))
  assert.equal(writes.join(''), 'Città ')
})

test('rifiuta atomicamente paste oltre 5 MB e blocchi fuori sequenza', async () => {
  const writes = []
  const input = createTerminalInputController({ getPty: () => ({ write: (data) => writes.push(data) }), waitForCapacity: async () => {}, createId: () => 'paste-2' })
  assert.deepEqual(input.start({ totalBytes: MAX_PASTE_BYTES + 1 }), { accepted: false, reason: 'too-large', totalBytes: MAX_PASTE_BYTES + 1, limit: MAX_PASTE_BYTES })
  const transfer = input.start({ totalBytes: 2 })
  assert.equal((await input.chunk({ transferId: transfer.transferId, index: 1, data: 'x' })).reason, 'invalid-chunk')
  assert.deepEqual(writes, [])
})

test('riserva atomicamente l\'indice mentre attende la backpressure', async () => {
  let release
  let capacityWaits = 0
  const capacity = new Promise((resolve) => { release = resolve })
  const writes = []
  const input = createTerminalInputController({
    getPty: () => ({ write: (data) => writes.push(data) }),
    waitForCapacity: () => {
      capacityWaits += 1
      return capacity
    },
    createId: () => 'paste-concurrent',
  })
  const transfer = input.start({ totalBytes: 2 })

  const first = input.chunk({ transferId: transfer.transferId, index: 0, data: 'x' })
  const duplicate = input.chunk({ transferId: transfer.transferId, index: 0, data: 'x' })

  assert.equal(capacityWaits, 1)
  assert.deepEqual(await duplicate, { accepted: false, reason: 'invalid-chunk', sentBytes: 0, totalBytes: 2 })
  release()
  assert.deepEqual(await first, { accepted: true, complete: false, sentBytes: 1, totalBytes: 2 })
  assert.deepEqual(writes, ['x'])

  assert.deepEqual(await input.chunk({ transferId: transfer.transferId, index: 1, data: 'y' }), { accepted: true, complete: true, sentBytes: 2, totalBytes: 2 })
  assert.deepEqual(writes, ['x', 'y'])
  assert.equal(input.getDiagnostics().pasteAcceptedBytes, 2)
})

test('un annullamento durante la backpressure impedisce la scrittura differita', async () => {
  let release
  const capacity = new Promise((resolve) => { release = resolve })
  const writes = []
  const input = createTerminalInputController({ getPty: () => ({ write: (data) => writes.push(data) }), waitForCapacity: () => capacity, createId: () => 'paste-3' })
  const transfer = input.start({ totalBytes: 1 })
  const pending = input.chunk({ transferId: transfer.transferId, index: 0, data: 'x' })
  input.cancel(transfer.transferId)
  release()
  assert.equal((await pending).reason, 'cancelled')
  assert.deepEqual(writes, [])
})

test('un annullamento sveglia immediatamente il waiter di backpressure', async () => {
  const writes = []
  const input = createTerminalInputController({
    getPty: () => ({ write: (data) => writes.push(data) }),
    waitForCapacity: (signal) => new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })),
    createId: () => 'paste-abortable-capacity',
  })
  const transfer = input.start({ totalBytes: 1 })
  const pending = input.chunk({ transferId: transfer.transferId, index: 0, data: 'x' })

  assert.equal(input.cancel(transfer.transferId).cancelled, true)
  const outcome = await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error('paste cancellation timeout')), 100)),
  ])
  assert.equal(outcome.reason, 'cancelled')
  assert.deepEqual(writes, [])
})
