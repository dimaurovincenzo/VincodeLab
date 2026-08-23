const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalStreamController, TERMINAL_STREAM_LIMITS } = require('../electron/terminal-stream-controller.cjs')

function createHarnessController(overrides = {}) {
  const sent = []
  const pty = {
    pauses: 0,
    resumes: 0,
    pause() { this.pauses += 1 },
    resume() { this.resumes += 1 },
  }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'bench',
    sendBlock: (block) => sent.push(block),
    sendState: () => {},
    limits: overrides.limits ?? TERMINAL_STREAM_LIMITS,
  })
  controller.rendererReady({ sessionId: 'bench', watermark: 0 })
  return { controller, pty, sent }
}

function drainSent({ controller, sent }, onBlock = () => {}) {
  while (sent.length > 0) {
    const block = sent.shift()
    onBlock(block)
    assert.equal(controller.ack({ sessionId: block.sessionId, sequence: block.sequence }), true)
  }
}

test('consegna 100 MB senza perdita e con coda limitata', () => {
  const source = '0123456789abcdef'.repeat(6_553_600)
  const rendered = []
  const harness = createHarnessController()
  for (let offset = 0; offset < source.length; offset += 32_768) {
    harness.controller.push(source.slice(offset, offset + 32_768))
    drainSent(harness, (block) => rendered.push(block.data))
  }
  harness.controller.end({ exitCode: 0, signal: 0 })
  drainSent(harness, (block) => rendered.push(block.data))
  assert.equal(rendered.join(''), source)
  assert.ok(harness.controller.getDiagnostics().peakQueuedBytes <= 4 * 1024 * 1024 + 64 * 1024)
  harness.controller.dispose()
})

test('sospende il PTY con ACK ritardati e lo riprende dopo il drenaggio', () => {
  const limits = { ...TERMINAL_STREAM_LIMITS, blockBytes: 32, pauseBytes: 64, resumeBytes: 16 }
  const harness = createHarnessController({ limits })
  harness.controller.push('x'.repeat(256))
  assert.equal(harness.pty.pauses, 1)
  drainSent(harness)
  assert.equal(harness.pty.resumes, 1)
  harness.controller.dispose()
})
