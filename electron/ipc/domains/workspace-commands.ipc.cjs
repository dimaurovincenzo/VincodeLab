const WORKSPACE_COMMANDS_INVOKE_CHANNELS = Object.freeze([
  'workspaceCommands:list',
  'workspaceCommands:createCategory',
  'workspaceCommands:updateCategory',
  'workspaceCommands:deleteCategory',
  'workspaceCommands:create',
  'workspaceCommands:update',
  'workspaceCommands:move',
  'workspaceCommands:delete',
  'workspaceCommands:run',
])

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
    ['workspaceCommands:list', (event) => {
      assertTrustedSender(event)
      return listWorkspaceCommands(requireActiveWorkspace())
    }],
    ['workspaceCommands:createCategory', (event, name) => {
      assertTrustedSender(event)
      return createCommandCategory(requireActiveWorkspace(), name)
    }],
    ['workspaceCommands:updateCategory', (event, categoryId, name) => {
      assertTrustedSender(event)
      return updateCommandCategory(requireActiveWorkspace(), categoryId, name)
    }],
    ['workspaceCommands:deleteCategory', (event, categoryId) => {
      assertTrustedSender(event)
      deleteCommandCategory(requireActiveWorkspace(), categoryId)
      return { deleted: true }
    }],
    ['workspaceCommands:create', (event, input) => {
      assertTrustedSender(event)
      return createWorkspaceCommand(requireActiveWorkspace(), input)
    }],
    ['workspaceCommands:update', (event, commandId, input) => {
      assertTrustedSender(event)
      return updateWorkspaceCommand(requireActiveWorkspace(), commandId, input)
    }],
    ['workspaceCommands:move', (event, commandId, categoryId) => {
      assertTrustedSender(event)
      moveWorkspaceCommand(requireActiveWorkspace(), commandId, categoryId)
      return { moved: true }
    }],
    ['workspaceCommands:delete', (event, commandId) => {
      assertTrustedSender(event)
      deleteWorkspaceCommand(requireActiveWorkspace(), commandId)
      return { deleted: true }
    }],
    ['workspaceCommands:run', (event, commandId) => {
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
