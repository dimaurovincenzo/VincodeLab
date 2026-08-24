const { IPC_CHANNELS, WORKSPACE_COMMANDS_INVOKE_CHANNELS } = require('../channels.cjs')

function createWorkspaceCommandsHandlers({
  assertTrustedSender,
  createCommandCategory,
  createWorkspaceCommand,
  deleteCommandCategory,
  deleteWorkspaceCommand,
  getManagedSsh,
  getWorkspaceCommand,
  listWorkspaceCommands,
  moveWorkspaceCommand,
  requireActiveWorkspace,
  requireRunningShellSession,
  shellSessionManager,
  updateCommandCategory,
  updateWorkspaceCommand,
}) {
  return new Map([
    [IPC_CHANNELS.WORKSPACE_COMMANDS_LIST, (event) => {
      assertTrustedSender(event)
      return listWorkspaceCommands(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_CREATE_CATEGORY, (event, name) => {
      assertTrustedSender(event)
      return createCommandCategory(requireActiveWorkspace(), name)
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_UPDATE_CATEGORY, (event, categoryId, name) => {
      assertTrustedSender(event)
      return updateCommandCategory(requireActiveWorkspace(), categoryId, name)
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_DELETE_CATEGORY, (event, categoryId) => {
      assertTrustedSender(event)
      deleteCommandCategory(requireActiveWorkspace(), categoryId)
      return { deleted: true }
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_CREATE, (event, input) => {
      assertTrustedSender(event)
      return createWorkspaceCommand(requireActiveWorkspace(), input)
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_UPDATE, (event, commandId, input) => {
      assertTrustedSender(event)
      return updateWorkspaceCommand(requireActiveWorkspace(), commandId, input)
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_MOVE, (event, commandId, categoryId) => {
      assertTrustedSender(event)
      moveWorkspaceCommand(requireActiveWorkspace(), commandId, categoryId)
      return { moved: true }
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_DELETE, (event, commandId) => {
      assertTrustedSender(event)
      deleteWorkspaceCommand(requireActiveWorkspace(), commandId)
      return { deleted: true }
    }],
    [IPC_CHANNELS.WORKSPACE_COMMANDS_RUN, (event, commandId) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const activeSession = requireRunningShellSession(workspacePath)
      const command = getWorkspaceCommand(workspacePath, commandId)
      if (!command) throw new Error('Comando del workspace non trovato.')
      if (command.kind === 'ssh') {
        const service = getManagedSsh()
        const launch = service.buildTerminalCommand(workspacePath, command)
        shellSessionManager.write(workspacePath, activeSession.sessionId, `${launch.command}\r`)
        void service.waitUntilConnected(launch.connection.id)
        return { executed: true, managedConnectionId: launch.connection.id }
      }
      shellSessionManager.write(workspacePath, activeSession.sessionId, `${command.command}\r`)
      return { executed: true }
    }],
  ])
}

function registerWorkspaceCommandsIpc({ ipcMain, ...dependencies }) {
  const handlers = createWorkspaceCommandsHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: WORKSPACE_COMMANDS_INVOKE_CHANNELS })
}

module.exports = {
  WORKSPACE_COMMANDS_INVOKE_CHANNELS,
  createWorkspaceCommandsHandlers,
  registerWorkspaceCommandsIpc,
}
