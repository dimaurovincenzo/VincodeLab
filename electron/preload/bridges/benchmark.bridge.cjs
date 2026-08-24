const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createBenchmarkBridge(ipcRenderer) {
  const benchmarkMode = process.argv.includes('--vincodelab-reliability-benchmark')
  const benchmarkFaultInjectionMode = benchmarkMode && process.argv.includes('--vincodelab-reliability-fault-injection')
  const screenshotCaptureMode = benchmarkMode && process.argv.includes('--vincodelab-screenshot-capture')
  return benchmarkMode
    ? { benchmark: {
        dispatchCommand: (command) => ipcRenderer.invoke(IPC_CHANNELS.BENCHMARK_DISPATCH_COMMAND, command),
        ...(benchmarkFaultInjectionMode ? {
          injectFault: (fault) => ipcRenderer.invoke(IPC_CHANNELS.BENCHMARK_INJECT_FAULT, fault),
          probe: () => ipcRenderer.invoke(IPC_CHANNELS.BENCHMARK_PROBE),
        } : {}),
        ...(screenshotCaptureMode ? {
          captureWindowBounds: () => ipcRenderer.invoke(IPC_CHANNELS.BENCHMARK_CAPTURE_WINDOW_BOUNDS),
        } : {}),
        shutdown: () => ipcRenderer.invoke(IPC_CHANNELS.BENCHMARK_SHUTDOWN),
      } }
    : {}
}

module.exports = { createBenchmarkBridge }
