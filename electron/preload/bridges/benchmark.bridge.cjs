function createBenchmarkBridge(ipcRenderer) {
  const benchmarkMode = process.argv.includes('--vincodelab-reliability-benchmark')
  const benchmarkFaultInjectionMode = benchmarkMode && process.argv.includes('--vincodelab-reliability-fault-injection')
  const screenshotCaptureMode = benchmarkMode && process.argv.includes('--vincodelab-screenshot-capture')
  return benchmarkMode
    ? { benchmark: {
        dispatchCommand: (command) => ipcRenderer.invoke('benchmark:dispatchCommand', command),
        ...(benchmarkFaultInjectionMode ? {
          injectFault: (fault) => ipcRenderer.invoke('benchmark:injectFault', fault),
          probe: () => ipcRenderer.invoke('benchmark:probe'),
        } : {}),
        ...(screenshotCaptureMode ? {
          captureWindowBounds: () => ipcRenderer.invoke('benchmark:captureWindowBounds'),
        } : {}),
        shutdown: () => ipcRenderer.invoke('benchmark:shutdown'),
      } }
    : {}
}

module.exports = { createBenchmarkBridge }
