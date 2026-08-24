function finite(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function sanitizeRendererMetrics(source = {}) {
  return {
    ackP50Ms: finite(source.ackP50Ms),
    ackP95Ms: finite(source.ackP95Ms),
    ackP99Ms: finite(source.ackP99Ms),
    slowFrames: finite(source.slowFrames),
    restoreCount: finite(source.restoreCount),
    queuedBlocks: finite(source.queuedBlocks),
    mode: source.mode === 'webgl' ? 'webgl' : 'standard',
  }
}

function createTerminalDiagnosticsReport(source = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pipeline: {
      receivedBytes: finite(source.receivedBytes),
      renderedBytes: finite(source.renderedBytes),
      averageBlockBytes: finite(source.averageBlockBytes),
      maxBlockBytes: finite(source.maxBlockBytes),
      queuedBytes: finite(source.queuedBytes),
      peakQueuedBytes: finite(source.peakQueuedBytes),
      pauseCount: finite(source.pauseCount),
      pausedMs: finite(source.pausedMs),
    },
    renderer: sanitizeRendererMetrics(source.renderer),
    paste: {
      started: finite(source.paste?.startedPastes),
      completed: finite(source.paste?.completedPastes),
      cancelled: finite(source.paste?.cancelledPastes),
      rejected: finite(source.paste?.rejectedPastes),
      acceptedBytes: finite(source.paste?.pasteAcceptedBytes),
      activeTransfers: finite(source.paste?.activeTransfers),
      pendingBytes: finite(source.paste?.pendingBytes),
    },
  }
}

module.exports = { createTerminalDiagnosticsReport, sanitizeRendererMetrics }
