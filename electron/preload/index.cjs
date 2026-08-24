const { contextBridge, ipcRenderer: electronIpcRenderer, webUtils } = require('electron')
const { createSafeIpcRenderer } = require('./ipc-renderer.cjs')
const { createBenchmarkBridge } = require('./bridges/benchmark.bridge.cjs')
const { createCoreBridge } = require('./bridges/core.bridge.cjs')
const { createDeveloperToolsBridge } = require('./bridges/developer-tools.bridge.cjs')
const { createGitHubRemoteBridge } = require('./bridges/github-remote.bridge.cjs')
const { createDataBridge } = require('./bridges/data.bridge.cjs')
const { createTerminalBridge } = require('./bridges/terminal.bridge.cjs')

const ipcRenderer = createSafeIpcRenderer(electronIpcRenderer)

contextBridge.exposeInMainWorld('vincodeLab', {
  ...createBenchmarkBridge(ipcRenderer),
  ...createCoreBridge(ipcRenderer),
  ...createDeveloperToolsBridge(ipcRenderer),
  ...createGitHubRemoteBridge(ipcRenderer),
  ...createDataBridge(ipcRenderer),
  ...createTerminalBridge(ipcRenderer, webUtils),
})
