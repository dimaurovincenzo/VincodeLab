const { IPC_CHANNELS, WORKSPACE_STATE_INVOKE_CHANNELS } = require('../channels.cjs')

function createWorkspaceStateHandlers({
  assertTrustedSender,
  beforeWorkspaceSessionRead,
  getWorkspaceSession,
  logWorkspaceSessionRecovery,
  requireActiveWorkspace,
  saveWorkspaceSession,
  volatileDrafts,
}) {
  return new Map([
    [IPC_CHANNELS.WORKSPACE_SESSION_GET, (event) => {
      assertTrustedSender(event)
      beforeWorkspaceSessionRead?.()
      const snapshot = getWorkspaceSession(requireActiveWorkspace())
      if (snapshot.recovery) logWorkspaceSessionRecovery(snapshot.recovery)
      return snapshot
    }],
    [IPC_CHANNELS.WORKSPACE_SESSION_SAVE, (event, snapshot) => {
      assertTrustedSender(event)
      return saveWorkspaceSession(requireActiveWorkspace(), snapshot)
    }],
    [IPC_CHANNELS.VOLATILE_DRAFTS_LIST, (event) => {
      assertTrustedSender(event)
      return volatileDrafts.list()
    }],
    [IPC_CHANNELS.VOLATILE_DRAFTS_WRITE, (event, draft) => {
      assertTrustedSender(event)
      return volatileDrafts.write(draft)
    }],
    [IPC_CHANNELS.VOLATILE_DRAFTS_DISCARD, (event, identity) => {
      assertTrustedSender(event)
      return volatileDrafts.discard(identity)
    }],
  ])
}

function registerWorkspaceStateIpc({ ipcMain, ...dependencies }) {
  const handlers = createWorkspaceStateHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: WORKSPACE_STATE_INVOKE_CHANNELS })
}

module.exports = {
  WORKSPACE_STATE_INVOKE_CHANNELS,
  createWorkspaceStateHandlers,
  registerWorkspaceStateIpc,
}
