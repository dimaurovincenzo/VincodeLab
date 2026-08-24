const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createTerminalBridge(ipcRenderer, webUtils) {
  return {
    shellSessions: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_LIST),
      resume: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_RESUME, sessionId),
      ready: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.SHELL_SESSIONS_READY, sessionId, message),
      ack: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.SHELL_SESSIONS_ACK, sessionId, message),
      disconnect: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.SHELL_SESSIONS_DISCONNECT, sessionId, message),
      create: () => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_CREATE),
      focus: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_FOCUS, sessionId),
      write: (sessionId, data) => ipcRenderer.send(IPC_CHANNELS.SHELL_SESSIONS_WRITE, sessionId, data),
      resize: (sessionId, dimensions) => ipcRenderer.send(IPC_CHANNELS.SHELL_SESSIONS_RESIZE, sessionId, dimensions),
      restart: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_RESTART, sessionId),
      close: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_SESSIONS_CLOSE, sessionId),
      onData: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on(IPC_CHANNELS.SHELL_SESSIONS_DATA, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.SHELL_SESSIONS_DATA, handler)
      },
      onExit: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on(IPC_CHANNELS.SHELL_SESSIONS_EXIT, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.SHELL_SESSIONS_EXIT, handler)
      },
      onError: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on(IPC_CHANNELS.SHELL_SESSIONS_ERROR, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.SHELL_SESSIONS_ERROR, handler)
      },
    },
    terminal: {
      resume: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_RESUME, sessionId),
      ready: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_READY, sessionId, message),
      ack: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_ACK, sessionId, message),
      disconnect: (sessionId, message) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_DISCONNECT, sessionId, message),
      chooseAttachments: () => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_CHOOSE_ATTACHMENTS),
      prepareDroppedAttachments: (files) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PREPARE_DROPPED_ATTACHMENTS, files.map((file) => webUtils.getPathForFile(file))),
      writeKey: (sessionId, data) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_KEY, sessionId, data),
      writeInput: (sessionId, data) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_WRITE_INPUT, sessionId, data),
      startPaste: (sessionId, input) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PASTE_START, sessionId, input),
      writePasteChunk: (sessionId, input) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PASTE_CHUNK, sessionId, input),
      cancelPaste: (sessionId, transferId) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_PASTE_CANCEL, sessionId, transferId),
      reportRendererMetrics: (sessionId, metrics) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_RENDERER_METRICS, sessionId, metrics),
      diagnostics: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_DIAGNOSTICS, sessionId),
      exportDiagnostics: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.TERMINAL_EXPORT_DIAGNOSTICS, sessionId),
      resize: (sessionId, dimensions) => ipcRenderer.send(IPC_CHANNELS.TERMINAL_RESIZE, sessionId, dimensions),
      onOutput: (listener) => {
        const handler = (_event, block) => listener(block)
        ipcRenderer.on(IPC_CHANNELS.TERMINAL_OUTPUT, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_OUTPUT, handler)
      },
      onStreamState: (listener) => {
        const handler = (_event, state) => listener(state)
        ipcRenderer.on(IPC_CHANNELS.TERMINAL_STREAM_STATE, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_STREAM_STATE, handler)
      },
      onExit: (listener) => {
        const handler = (_event, status) => listener(status)
        ipcRenderer.on(IPC_CHANNELS.TERMINAL_EXIT, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_EXIT, handler)
      },
      onError: (listener) => {
        const handler = (_event, payload) => listener(payload)
        ipcRenderer.on(IPC_CHANNELS.TERMINAL_ERROR, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL_ERROR, handler)
      },
    },
  }
}

module.exports = { createTerminalBridge }
