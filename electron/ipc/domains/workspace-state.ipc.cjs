const WORKSPACE_STATE_INVOKE_CHANNELS = Object.freeze([
  'workspaceSession:get',
  'workspaceSession:save',
  'volatileDrafts:list',
  'volatileDrafts:write',
  'volatileDrafts:discard',
])

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
    ['workspaceSession:get', (event) => {
      assertTrustedSender(event)
      beforeWorkspaceSessionRead?.()
      const snapshot = getWorkspaceSession(requireActiveWorkspace())
      if (snapshot.recovery) logWorkspaceSessionRecovery(snapshot.recovery)
      return snapshot
    }],
    ['workspaceSession:save', (event, snapshot) => {
      assertTrustedSender(event)
      return saveWorkspaceSession(requireActiveWorkspace(), snapshot)
    }],
    ['volatileDrafts:list', (event) => {
      assertTrustedSender(event)
      return volatileDrafts.list()
    }],
    ['volatileDrafts:write', (event, draft) => {
      assertTrustedSender(event)
      return volatileDrafts.write(draft)
    }],
    ['volatileDrafts:discard', (event, identity) => {
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
