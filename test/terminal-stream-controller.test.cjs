const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalStreamController } = require('../electron/terminal-stream-controller.cjs')

function harness(overrides = {}) {
  const sent = []
  const states = []
  const pty = {
    pauses: 0,
    resumes: 0,
    pause() { this.pauses += 1 },
    resume() { this.resumes += 1 },
  }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'session-a',
    sendBlock: (block) => sent.push(block),
    sendState: (state) => states.push(state),
    limits: { blockBytes: 4, batchMs: 8, pauseBytes: 8, resumeBytes: 3, stallMs: 2_000, historyBytes: 32 },
    ...overrides,
  })
  controller.rendererReady({ sessionId: 'session-a', watermark: 0 })
  return { controller, pty, sent, states }
}

test('invia un solo blocco e aspetta ACK prima del successivo', () => {
  const { controller, sent } = harness()
  controller.push('abcd')
  controller.push('efgh')
  assert.deepEqual(sent.map(({ sequence, data }) => [sequence, data]), [[1, 'abcd']])
  controller.ack({ sessionId: 'session-a', sequence: 1 })
  assert.deepEqual(sent.map(({ sequence, data }) => [sequence, data]), [[1, 'abcd'], [2, 'efgh']])
  controller.dispose()
})

test('applica isteresi e ignora ACK di sessioni obsolete', () => {
  const { controller, pty, sent } = harness()
  controller.push('abcd')
  controller.push('efgh')
  controller.push('ijkl')
  assert.equal(pty.pauses, 1)
  controller.ack({ sessionId: 'old-session', sequence: sent[0].sequence })
  assert.equal(pty.resumes, 0)
  controller.ack({ sessionId: 'session-a', sequence: 1 })
  controller.ack({ sessionId: 'session-a', sequence: 2 })
  controller.ack({ sessionId: 'session-a', sequence: 3 })
  assert.equal(pty.resumes, 1)
  controller.dispose()
})

test('include il blocco parziale nello snapshot finale', () => {
  const { controller } = harness()
  controller.push('abc')
  controller.end({ exitCode: 0, signal: 0 })
  assert.equal(controller.createResumeSnapshot().snapshot.data, 'abc')
  controller.dispose()
})

test('chiude un blocco parziale a fine turno e sospende soltanto su stall', () => {
  const batches = []
  const timers = []
  const { controller, pty, sent, states } = harness({
    scheduleBatch: (fn) => { batches.push(fn); return fn },
    cancelBatch: () => {},
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
  })
  controller.push('ab')
  assert.equal(batches.length, 1)
  assert.equal(timers.some((timer) => timer.ms === 8), false)
  batches.shift()()
  assert.equal(sent[0].data, 'ab')
  timers.find((timer) => timer.ms === 2_000).fn()
  assert.equal(pty.pauses, 1)
  assert.equal(states.at(-1).status, 'stalled')
  controller.dispose()
})

test('conserva integri i caratteri UTF-8 quando divide i blocchi', () => {
  const { controller, sent } = harness()
  controller.push('a🚀b')
  controller.end({ exitCode: 0, signal: 0 })
  const rendered = []
  while (sent.length > rendered.length) {
    const block = sent[rendered.length]
    rendered.push(block.data)
    controller.ack({ sessionId: block.sessionId, sequence: block.sequence })
  }
  assert.equal(rendered.join(''), 'a🚀b')
  controller.dispose()
})

test('rimuove e risolve un waiter di input quando il paste viene annullato', async () => {
  const { controller, pty } = harness()
  controller.push('abcdefghijkl')
  assert.equal(pty.pauses, 1)
  const abort = new AbortController()
  const capacity = controller.waitForInputCapacity(abort.signal)

  abort.abort()
  await Promise.race([
    capacity,
    new Promise((_, reject) => setTimeout(() => reject(new Error('capacity waiter non rilasciato')), 100)),
  ])
  assert.equal(pty.resumes, 0)
  controller.dispose()
})
