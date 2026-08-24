const { IPC_CHANNELS, MANAGED_SSH_INVOKE_CHANNELS } = require('../channels.cjs')

function createManagedSshHandlers({
  assertTrustedSender,
  getManagedSsh,
  getSftpService,
  requireActiveWorkspace,
  requireManagedConnectionForWorkspace,
}) {
  return new Map([
    [IPC_CHANNELS.MANAGED_SSH_LIST, (event) => {
      assertTrustedSender(event)
      return getManagedSsh().list(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.MANAGED_SSH_CHECK, (event, connectionId) => {
      assertTrustedSender(event)
      requireManagedConnectionForWorkspace(connectionId)
      return getManagedSsh().check(connectionId)
    }],
    [IPC_CHANNELS.MANAGED_SSH_DISCONNECT, async (event, connectionId) => {
      assertTrustedSender(event)
      requireManagedConnectionForWorkspace(connectionId)
      const sftpService = getSftpService()
      if (sftpService) await sftpService.closeConnection(connectionId)
      await getManagedSsh().disconnect(connectionId)
      return { disconnected: true }
    }],
  ])
}

function registerManagedSshIpc({ ipcMain, ...dependencies }) {
  const handlers = createManagedSshHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: MANAGED_SSH_INVOKE_CHANNELS })
}

module.exports = {
  MANAGED_SSH_INVOKE_CHANNELS,
  createManagedSshHandlers,
  registerManagedSshIpc,
}
