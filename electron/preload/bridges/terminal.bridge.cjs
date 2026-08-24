function createTerminalBridge(ipcRenderer, webUtils) {
  return {
    shellSessions: {
      list: () => ipcRenderer.invoke('shellSessions:list'),
      resume: (sessionId) => ipcRenderer.invoke('shellSessions:resume', sessionId),
      ready: (sessionId, message) => ipcRenderer.send('shellSessions:ready', sessionId, message),
      ack: (sessionId, message) => ipcRenderer.send('shellSessions:ack', sessionId, message),
      disconnect: (sessionId, message) => ipcRenderer.send('shellSessions:disconnect', sessionId, message),
      create: () => ipcRenderer.invoke('shellSessions:create'),
      focus: (sessionId) => ipcRenderer.invoke('shellSessions:focus', sessionId),
      write: (sessionId, data) => ipcRenderer.send('shellSessions:write', sessionId, data),
      resize: (sessionId, dimensions) => ipcRenderer.send('shellSessions:resize', sessionId, dimensions),
      restart: (sessionId) => ipcRenderer.invoke('shellSessions:restart', sessionId),
      close: (sessionId) => ipcRenderer.invoke('shellSessions:close', sessionId),
      onData: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on('shellSessions:data', handler)
        return () => ipcRenderer.removeListener('shellSessions:data', handler)
      },
      onExit: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on('shellSessions:exit', handler)
        return () => ipcRenderer.removeListener('shellSessions:exit', handler)
      },
      onError: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on('shellSessions:error', handler)
        return () => ipcRenderer.removeListener('shellSessions:error', handler)
      },
    },
    terminal: {
      resume: (request) => ipcRenderer.invoke('terminal:resume', request),
      ready: (message) => ipcRenderer.send('terminal:ready', message),
      ack: (message) => ipcRenderer.send('terminal:ack', message),
      chooseAttachments: () => ipcRenderer.invoke('terminal:chooseAttachments'),
      prepareDroppedAttachments: (files) => ipcRenderer.invoke('terminal:prepareDroppedAttachments', files.map((file) => webUtils.getPathForFile(file))),
      writeKey: (data) => ipcRenderer.send('terminal:key', data),
      writeInput: (data) => ipcRenderer.invoke('terminal:writeInput', data),
      startPaste: (input) => ipcRenderer.invoke('terminal:pasteStart', input),
      writePasteChunk: (input) => ipcRenderer.invoke('terminal:pasteChunk', input),
      cancelPaste: (transferId) => ipcRenderer.invoke('terminal:pasteCancel', transferId),
      reportRendererMetrics: (metrics) => ipcRenderer.send('terminal:rendererMetrics', metrics),
      diagnostics: () => ipcRenderer.invoke('terminal:diagnostics'),
      exportDiagnostics: () => ipcRenderer.invoke('terminal:exportDiagnostics'),
      resize: (dimensions) => ipcRenderer.send('terminal:resize', dimensions),
      onOutput: (listener) => {
        const handler = (_event, block) => listener(block)
        ipcRenderer.on('terminal:output', handler)
        return () => ipcRenderer.removeListener('terminal:output', handler)
      },
      onStreamState: (listener) => {
        const handler = (_event, state) => listener(state)
        ipcRenderer.on('terminal:streamState', handler)
        return () => ipcRenderer.removeListener('terminal:streamState', handler)
      },
      onExit: (listener) => {
        const handler = (_event, status) => listener(status)
        ipcRenderer.on('terminal:exit', handler)
        return () => ipcRenderer.removeListener('terminal:exit', handler)
      },
      onError: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on('terminal:error', handler)
        return () => ipcRenderer.removeListener('terminal:error', handler)
      },
    },
  }
}

module.exports = { createTerminalBridge }
