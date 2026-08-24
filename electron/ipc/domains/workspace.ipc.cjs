const { IPC_CHANNELS, WORKSPACE_INVOKE_CHANNELS } = require('../channels.cjs')

function createWorkspaceHandlers({
  assertTrustedSender,
  chooseAndOpenWorkspace,
  getActiveWorkspaceError,
  getActiveWorkspaceIncident,
  getActiveWorkspacePath,
  getWorkspaceInstanceStatus,
  listRecentWorkspaces,
  openPath,
  openWorkspace,
  openWorkspaceInNewInstance,
  requireActiveWorkspace,
  revealWorkspace,
}) {
  return new Map([
    [IPC_CHANNELS.WORKSPACE_OPEN, (event) => {
      assertTrustedSender(event)
      return chooseAndOpenWorkspace()
    }],
    [IPC_CHANNELS.WORKSPACE_GET_ACTIVE, (event) => {
      assertTrustedSender(event)
      const workspacePath = getActiveWorkspacePath()
      return workspacePath ? { path: workspacePath, error: getActiveWorkspaceError(), errorIncident: getActiveWorkspaceIncident() } : null
    }],
    [IPC_CHANNELS.WORKSPACE_INSTANCE_STATUS, (event, workspacePath) => {
      assertTrustedSender(event)
      return getWorkspaceInstanceStatus(workspacePath)
    }],
    [IPC_CHANNELS.WORKSPACE_OPEN_IN_NEW_INSTANCE, async (event, workspacePath) => {
      assertTrustedSender(event)
      return await openWorkspaceInNewInstance(workspacePath)
    }],
    [IPC_CHANNELS.WORKSPACE_LIST_RECENT, (event) => {
      assertTrustedSender(event)
      return listRecentWorkspaces()
    }],
    [IPC_CHANNELS.WORKSPACE_REVEAL, (event) => {
      assertTrustedSender(event)
      return revealWorkspace(requireActiveWorkspace(), { openPath: (workspacePath) => openPath(workspacePath) })
    }],
    [IPC_CHANNELS.WORKSPACE_OPEN_RECENT, (event, workspacePath) => {
      assertTrustedSender(event)
      return openWorkspace(workspacePath)
    }],
  ])
}

function registerWorkspaceIpc({ ipcMain, ...dependencies }) {
  const handlers = createWorkspaceHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: WORKSPACE_INVOKE_CHANNELS })
}

module.exports = {
  WORKSPACE_INVOKE_CHANNELS,
  createWorkspaceHandlers,
  registerWorkspaceIpc,
}
