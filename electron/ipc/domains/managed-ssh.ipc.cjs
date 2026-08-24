const MANAGED_SSH_INVOKE_CHANNELS = Object.freeze([
  'managedSsh:list',
  'managedSsh:check',
  'managedSsh:disconnect',
])

function createManagedSshHandlers({
  assertTrustedSender,
  getManagedSsh,
  getSftpService,
  requireActiveWorkspace,
  requireManagedConnectionForWorkspace,
}) {
  return new Map([
    ['managedSsh:list', (event) => {
      assertTrustedSender(event)
      return getManagedSsh().list(requireActiveWorkspace())
    }],
    ['managedSsh:check', (event, connectionId) => {
      assertTrustedSender(event)
      requireManagedConnectionForWorkspace(connectionId)
      return getManagedSsh().check(connectionId)
    }],
    ['managedSsh:disconnect', async (event, connectionId) => {
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
