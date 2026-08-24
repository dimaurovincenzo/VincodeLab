const SHELL_SESSIONS_INVOKE_CHANNELS = Object.freeze([
  'shellSessions:list',
  'shellSessions:resume',
  'shellSessions:create',
  'shellSessions:focus',
  'shellSessions:restart',
  'shellSessions:close',
])

const SHELL_SESSIONS_SEND_CHANNELS = Object.freeze([
  'shellSessions:ready',
  'shellSessions:ack',
  'shellSessions:disconnect',
  'shellSessions:write',
  'shellSessions:resize',
])

function createShellSessionsHandlers({
  assertTrustedSender,
  requireActiveWorkspace,
  shellSessionManager,
}) {
  return new Map([
    ['shellSessions:list', (event) => {
      assertTrustedSender(event)
      const { activeSessionId, sessions } = shellSessionManager.list(requireActiveWorkspace())
      return { activeSessionId, sessions }
    }],
    ['shellSessions:resume', (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.resume(requireActiveWorkspace(), sessionId)
    }],
    ['shellSessions:create', (event) => {
      assertTrustedSender(event)
      return shellSessionManager.create(requireActiveWorkspace())
    }],
    ['shellSessions:focus', (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.focus(requireActiveWorkspace(), sessionId)
    }],
    ['shellSessions:restart', (event, sessionId) => {
      assertTrustedSender(event)
      return shellSessionManager.restart(requireActiveWorkspace(), sessionId)
    }],
    ['shellSessions:close', (event, sessionId) => {
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
    ['shellSessions:ready', (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'ready',
      () => shellSessionManager.rendererReady(requireActiveWorkspace(), sessionId, message),
    )],
    ['shellSessions:ack', (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'ack',
      () => shellSessionManager.ack(requireActiveWorkspace(), sessionId, message),
    )],
    ['shellSessions:disconnect', (event, sessionId, message) => invokeOneWay(
      event,
      sessionId,
      'disconnect',
      () => shellSessionManager.disconnect(requireActiveWorkspace(), sessionId, message),
    )],
    ['shellSessions:write', (event, sessionId, data) => invokeOneWay(
      event,
      sessionId,
      'write',
      () => shellSessionManager.write(requireActiveWorkspace(), sessionId, data),
    )],
    ['shellSessions:resize', (event, sessionId, dimensions) => invokeOneWay(
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
