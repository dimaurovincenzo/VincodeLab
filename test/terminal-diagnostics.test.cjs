const assert = require('node:assert/strict')
const test = require('node:test')

const { createTerminalDiagnosticsReport, sanitizeRendererMetrics } = require('../electron/terminal-diagnostics.cjs')

test('esporta solo metriche numeriche consentite', () => {
  const report = createTerminalDiagnosticsReport({
    sessionId: 'secret-session',
    queuedBytes: 12,
    peakQueuedBytes: 24,
    command: 'token=secret',
    output: 'password',
    renderer: { ackP95Ms: 7, arbitrary: 'private' },
  })
  const json = JSON.stringify(report)
  assert.equal(report.pipeline.queuedBytes, 12)
  assert.equal(report.renderer.ackP95Ms, 7)
  assert.doesNotMatch(json, /secret-session|token|password|private/)
})

test('normalizza metriche renderer non finite e modalità sconosciute', () => {
  assert.deepEqual(sanitizeRendererMetrics({ ackP50Ms: 1, ackP95Ms: Infinity, ackP99Ms: '3', slowFrames: 2, restoreCount: 1, queuedBlocks: 4, mode: 'custom', content: 'segreto' }), {
    ackP50Ms: 1,
    ackP95Ms: 0,
    ackP99Ms: 0,
    slowFrames: 2,
    restoreCount: 1,
    queuedBlocks: 4,
    mode: 'standard',
  })
})
