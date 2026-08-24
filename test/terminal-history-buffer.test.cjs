const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalHistoryBuffer } = require('../electron/domains/terminal/terminal-history-buffer.cjs')

test('espelle blocchi interi e conserva ordine e watermark', () => {
  const history = createTerminalHistoryBuffer({ maxBytes: 6 })
  history.append({ sequence: 1, data: 'abc', bytes: 3 })
  history.append({ sequence: 2, data: 'def', bytes: 3 })
  history.append({ sequence: 3, data: 'ghi', bytes: 3 })
  assert.deepEqual(history.snapshot(), { data: 'defghi', firstSequence: 2, watermark: 3, bytes: 6 })
})

test('misura UTF-8 e non muta i blocchi ricevuti', () => {
  const history = createTerminalHistoryBuffer({ maxBytes: 5 })
  const block = Object.freeze({ sequence: 4, data: '🚀' })
  history.append(block)
  assert.equal(history.size().bytes, 4)
  assert.equal(history.snapshot().data, '🚀')
})

test('svuota lo storico e ripristina uno snapshot neutro', () => {
  const history = createTerminalHistoryBuffer({ maxBytes: 8 })
  history.append({ sequence: 1, data: 'output' })
  history.clear()
  assert.deepEqual(history.size(), { blocks: 0, bytes: 0 })
  assert.deepEqual(history.snapshot(), { data: '', firstSequence: 0, watermark: 0, bytes: 0 })
})
