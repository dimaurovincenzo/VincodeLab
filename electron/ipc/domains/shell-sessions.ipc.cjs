const { IPC_CHANNELS, SHELL_SESSIONS_INVOKE_CHANNELS, SHELL_SESSIONS_SEND_CHANNELS } = require('../channels.cjs')

function createShellSessionsHandlers({
  assertTrustedSender,
  requireActiveWorkspace,
  shellSessionManager,
}) {
  return new Map([
    [IPC_CHANNELS.SHELL_SESSIONS_LIST, (event) => {
      assertTrustedSender(event)
      const { activeSessionId, sessions } = shellSessionManager.list(requireActiveWorkspace())
      return { activeSessionId, sessions }
    }],
    [IPC_CHANNELS.SHELL_SESSIONS_RESUME, (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.resume(requireActiveWorkspace(), sessionId)
    }],
    [IPC_CHANNELS.SHELL_SESSIONS_CREATE, (event) => {
      assertTrustedSender(event)
      return shellSessionManager.create(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.SHELL_SESSIONS_FOCUS, (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.focus(requireActiveWorkspace(), sessionId)
    }],
    [IPC_CHANNELS.SHELL_SESSIONS_RESTART, (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.restart(requireActiveWorkspace(), sessionId)
    }],
    [IPC_CHANNELS.SHELL_SESSIONS_CLOSE, (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.close(requireActiveWorkspace(), sessionId)
    }],
  ])
}

function createShellSessionsListeners({
  assertTrustedSender,
  handleShellSessionOneWay,
  requireActiveWorkspace,
  shellSessionManager,
}) {
  const invokeOneWay = (event, sessionId, operation, perform) => {
    assertTrustedSender(event)
    handleShellSessionOneWay(event, sessionId, operation, perform)
  }

  return new Map([
    [IPC_CHANNELS.SHELL_SESSIONS_READY, (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'ready',
      () => shellSessionManager.rendererReady(requireActiveWorkspace(), sessionId, message),
    )],
    [IPC_CHANNELS.SHELL_SESSIONS_ACK, (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'ack',
      () => shellSessionManager.ack(requireActiveWorkspace(), sessionId, message),
    )],
    [IPC_CHANNELS.SHELL_SESSIONS_DISCONNECT, (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'disconnect',
      () => shellSessionManager.disconnect(requireActiveWorkspace(), sessionId, message),
    )],
    [IPC_CHANNELS.SHELL_SESSIONS_WRITE, (event, sessionId, data) => invokeOneWay(
      event,
      sessionId,
      'write',
      () => shellSessionManager.write(requireActiveWorkspace(), sessionId, data),
    )],
    [IPC_CHANNELS.SHELL_SESSIONS_RESIZE, (event, sessionId, dimensions) => invokeOneWay(
      event,
      sessionId,
      'resize',
      () => shellSessionManager.resize(requireActiveWorkspace(), sessionId, dimensions),
    )],
  ])
}

function registerShellSessionsIpc({ confineIpcOneWay, ipcMain, ...dependencies }) {
  const handlers = createShellSessionsHandlers(dependencies)
  const listeners = createShellSessionsListeners(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  for (const [channel, listener] of listeners) ipcMain.on(channel, confineIpcOneWay(channel, listener))
  return Object.freeze({
    invokeChannels: SHELL_SESSIONS_INVOKE_CHANNELS,
    sendChannels: SHELL_SESSIONS_SEND_CHANNELS,
  })
}

module.exports = {
  SHELL_SESSIONS_INVOKE_CHANNELS,
  SHELL_SESSIONS_SEND_CHANNELS,
  createShellSessionsHandlers,
  createShellSessionsListeners,
  registerShellSessionsIpc,
}
