import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const { createTerminalStreamController, TERMINAL_STREAM_LIMITS } = require('../electron/terminal-stream-controller.cjs')

async function runTerminalStreamBenchmark(totalBytes) {
  const sent = []
  const pty = { pause() {}, resume() {} }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'benchmark',
    sendBlock: (block) => sent.push(block),
    sendState: () => {},
  })
  controller.rendererReady({ sessionId: 'benchmark', watermark: 0 })
  const chunk = '0123456789abcdef'.repeat(2_048)
  let producedBytes = 0
  while (producedBytes < totalBytes) {
    const data = chunk.slice(0, Math.min(chunk.length, totalBytes - producedBytes))
    controller.push(data)
    producedBytes += Buffer.byteLength(data, 'utf8')
    while (sent.length > 0) {
      const block = sent.shift()
      controller.ack({ sessionId: block.sessionId, sequence: block.sequence })
    }
  }
  controller.end({ exitCode: 0, signal: 0 })
  while (sent.length > 0) {
    const block = sent.shift()
    controller.ack({ sessionId: block.sessionId, sequence: block.sequence })
  }
  const metrics = controller.getDiagnostics()
  controller.dispose()
  return {
    receivedBytes: metrics.receivedBytes,
    renderedBytes: metrics.renderedBytes,
    peakQueuedBytes: metrics.peakQueuedBytes,
    exact: metrics.receivedBytes === totalBytes && metrics.renderedBytes === totalBytes,
  }
}

const sizes = [1, 10, 100].map((mb) => ({ mb, bytes: mb * 1024 * 1024 }))
for (const sample of sizes) {
  const started = performance.now()
  const result = await runTerminalStreamBenchmark(sample.bytes)
  process.stdout.write(`${JSON.stringify({ ...sample, elapsedMs: performance.now() - started, ...result })}\n`)
  if (!result.exact || result.peakQueuedBytes > TERMINAL_STREAM_LIMITS.pauseBytes + TERMINAL_STREAM_LIMITS.blockBytes) {
    process.exitCode = 1
  }
}
