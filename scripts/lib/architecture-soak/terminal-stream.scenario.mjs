import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { setImmediate as yieldImmediate } from 'node:timers/promises'

import { UNICODE_PATTERN } from './scenario-fixture.mjs'

const require = createRequire(import.meta.url)
const { TERMINAL_STREAM_LIMITS, createTerminalStreamController } = require('../../../electron/domains/terminal/terminal-stream-controller.cjs')

const UNICODE_PATTERN_BYTES = Buffer.byteLength(UNICODE_PATTERN, 'utf8')

function exactUnicodeBlock(bytes) {
  const repetitions = Math.floor(bytes / UNICODE_PATTERN_BYTES)
  return UNICODE_PATTERN.repeat(repetitions) + 'x'.repeat(bytes - repetitions * UNICODE_PATTERN_BYTES)
}

export async function runTerminalStreamScenario(config) {
  const totalBytes = config.terminalBytes
  assert.equal(totalBytes % TERMINAL_STREAM_LIMITS.blockBytes, 0, 'Il carico terminale deve usare blocchi esatti.')
  const sourceHash = createHash('sha256')
  const renderedHash = createHash('sha256')
  const sent = []
  let expectedSequence = 0
  let pauseCalls = 0
  let resumeCalls = 0
  let ptyPaused = false
  let blocks = 0
  const pty = {
    pause() {
      assert.equal(ptyPaused, false, 'PTY messa in pausa due volte.')
      ptyPaused = true
      pauseCalls += 1
    },
    resume() {
      assert.equal(ptyPaused, true, 'PTY ripresa senza pausa.')
      ptyPaused = false
      resumeCalls += 1
    },
  }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'architecture-soak',
    sendBlock: (block) => sent.push(block),
    sendState: () => undefined,
  })
  controller.rendererReady({ sessionId: 'architecture-soak', watermark: 0 })

  const drain = () => {
    while (sent.length > 0) {
      const block = sent.shift()
      expectedSequence += 1
      blocks += 1
      assert.equal(block.sequence, expectedSequence, 'Sequenza terminale non monotona.')
      assert.ok(Buffer.byteLength(block.data, 'utf8') <= TERMINAL_STREAM_LIMITS.blockBytes, 'Blocco terminale oltre limite.')
      assert.doesNotMatch(block.data, /�/u, 'Unicode terminale corrotto.')
      renderedHash.update(block.data)
      assert.equal(controller.ack({ sessionId: block.sessionId, sequence: block.sequence }), true, 'ACK terminale rifiutato.')
    }
  }

  try {
    const block = exactUnicodeBlock(TERMINAL_STREAM_LIMITS.blockBytes)
    for (let producedBytes = 0; producedBytes < totalBytes; producedBytes += TERMINAL_STREAM_LIMITS.blockBytes) {
      sourceHash.update(block)
      controller.push(block)
      drain()
      if ((producedBytes / TERMINAL_STREAM_LIMITS.blockBytes) % 8 === 7) await yieldImmediate()
    }
    controller.end({ exitCode: 0, signal: 0 })
    drain()
    const diagnostics = controller.getDiagnostics()
    const sourceDigest = sourceHash.digest('hex')
    const renderedDigest = renderedHash.digest('hex')
    assert.equal(diagnostics.receivedBytes, totalBytes, 'Byte terminale ricevuti non esatti.')
    assert.equal(diagnostics.renderedBytes, totalBytes, 'Byte terminale renderizzati non esatti.')
    assert.equal(diagnostics.queuedBytes, 0, 'Coda terminale residua.')
    assert.equal(sourceDigest, renderedDigest, 'Contenuto Unicode terminale alterato.')
    assert.ok(diagnostics.peakQueuedBytes <= TERMINAL_STREAM_LIMITS.pauseBytes + TERMINAL_STREAM_LIMITS.blockBytes, 'Backpressure terminale oltre soglia.')
    assert.equal(ptyPaused, false, 'PTY rimasta in pausa.')
    assert.equal(pauseCalls, resumeCalls, 'Lifecycle pausa/ripresa PTY non bilanciato.')
    return {
      totalBytes,
      receivedBytes: diagnostics.receivedBytes,
      renderedBytes: diagnostics.renderedBytes,
      blocks,
      maxBlockBytes: diagnostics.maxBlockBytes,
      peakQueuedBytes: diagnostics.peakQueuedBytes,
      pauseCalls,
      checksumMatch: true,
      residualQueuedBytes: diagnostics.queuedBytes,
    }
  } finally {
    controller.dispose()
  }
}
