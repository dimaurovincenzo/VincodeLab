type AppMenuSection = 'home' | 'ai' | 'ai-skills' | 'ai-instructions' | 'editor' | 'terminal' | 'github' | 'database' | 'redis' | 'settings'
type LifecycleCloseReason = 'window' | 'quit'
type LifecycleCloseDecision = 'proceed' | 'cancel'
type LifecycleCloseRequest = { requestId: string; reason: LifecycleCloseReason }
type AppMenuCommand =
  | 'workspace.open'
  | 'workspace.reveal'
  | 'workbench.commandPalette'
  | 'workbench.quickOpen'
  | 'navigation.ai'
  | 'navigation.editor'
  | 'navigation.terminal'
  | 'navigation.github'
  | 'navigation.database'
  | 'navigation.redis'
  | 'navigation.settings'
  | 'ai.reload'
  | 'ai.restart'
  | 'ai.save'
  | 'ai.skills'
  | 'ai.instructions'
  | 'ai.copy'
  | 'ai.paste'
  | 'ai.search'
  | 'ai.selectAll'
  | 'ai.clear'
  | 'ai.zoomIn'
  | 'ai.zoomOut'
  | 'ai.zoomReset'
  | 'editor.save'
  | 'editor.search'
  | 'editor.focusExplorer'
  | 'editor.focus'
  | 'editor.nextTab'
  | 'editor.previousTab'
  | 'editor.close'
  | 'editor.refresh'
  | 'editor.openCurrentDiff'
  | 'editor.sendFileToAi'
  | 'editor.sendSelectionToAi'
  | 'terminal.search'
  | 'terminal.focus'
  | 'terminal.new'
  | 'terminal.previous'
  | 'terminal.next'
  | 'terminal.close'
  | 'terminal.clear'
  | 'terminal.restart'
  | 'terminal.copy'
  | 'terminal.paste'
  | 'terminal.selectAll'
  | 'terminal.zoomIn'
  | 'terminal.zoomOut'
  | 'terminal.zoomReset'
  | 'github.focusChanges'
  | 'github.refresh'
  | 'github.fetch'
  | 'database.focus'
  | 'database.execute'
  | 'database.cancel'
  | 'database.format'
  | 'database.schema'
  | 'database.saveQuery'
  | 'database.begin'
  | 'database.commit'
  | 'database.rollback'
  | 'redis.focusSearch'
  | 'redis.refresh'
  | 'redis.newConnection'
  | 'redis.disconnect'
  | 'redis.reconnect'
  | 'redis.cancel'
  | 'settings.refresh'
  | 'settings.resetWorkspacePreferences'

type ContextMenuKind =
  | 'default'
  | 'terminal'
  | 'remote-file'
  | 'remote-directory'
  | 'remote-local-file'
  | 'remote-transfer'
  | 'workspace-file'
  | 'workspace-directory'
  | 'workspace-root'
  | 'editor-workspace-tab'
  | 'editor-remote-tab'
  | 'terminal-tab'
  | 'recent-workspace'
  | 'git-unstaged-file'
  | 'git-staged-file'
  | 'redis-key'

type ContextMenuAction = {
  command:
    | 'remote.downloadOpen'
    | 'remote.downloadAs'
    | 'remote.copyPath'
    | 'remote.rename'
    | 'remote.delete'
    | 'remote.openDirectory'
    | 'remoteLocal.open'
    | 'remoteLocal.reveal'
    | 'remoteLocal.copyPath'
    | 'remoteLocal.discard'
    | 'remoteTransfer.cancel'
    | 'remoteTransfer.retry'
    | 'workspaceFile.open'
    | 'workspaceFile.openWith'
    | 'workspaceFile.rename'
    | 'workspaceFile.duplicate'
    | 'workspaceFile.trash'
    | 'workspaceDirectory.newFile'
    | 'workspaceDirectory.newDirectory'
    | 'workspaceDirectory.expand'
    | 'workspaceDirectory.collapse'
    | 'workspaceDirectory.rename'
    | 'workspaceDirectory.duplicate'
    | 'workspaceDirectory.trash'
    | 'workspaceExplorer.refresh'
    | 'workspaceExplorer.collapseAll'
    | 'workspaceEntry.copyName'
    | 'workspaceEntry.copyRelativePath'
    | 'workspaceEntry.copyAbsolutePath'
    | 'workspaceEntry.reveal'
    | 'editorTab.save'
    | 'editorTab.close'
    | 'editorTab.closeOthers'
    | 'editorTab.closeRight'
    | 'editorTab.closeAll'
    | 'editorRemote.compare'
    | 'editorRemote.upload'
    | 'editorRemote.reveal'
    | 'terminalTab.activate'
    | 'terminalTab.new'
    | 'terminalTab.restart'
    | 'terminalTab.close'
    | 'recentWorkspace.open'
    | 'recentWorkspace.openNew'
    | 'recentWorkspace.copyPath'
    | 'recentWorkspace.reveal'
    | 'gitFile.diff'
    | 'gitFile.open'
    | 'gitFile.stage'
    | 'gitFile.unstage'
    | 'gitFile.copyPath'
    | 'gitFile.reveal'
    | 'redisKey.open'
    | 'redisKey.searchPayload'
    | 'redisKey.refresh'
    | 'redisKey.copyName'
    | 'redisKey.copyVisibleValue'
  contextId: string | null
  contextKind: Exclude<ContextMenuKind, 'default' | 'terminal'>
}

type VincodeRedisApi = import('./bridge').RedisApi

interface Window {
  vincodeLab: {
    benchmark?: {
      captureWindowBounds?: () => Promise<{
        bounds: { height: number; width: number; x: number; y: number }
        contentBounds: { height: number; width: number; x: number; y: number }
        maximized: boolean
        visible: boolean
      }>
      dispatchCommand: (command: 'workbench.commandPalette' | 'workbench.quickOpen') => Promise<{ dispatched: true }>
      injectFault?: (fault:
        | 'ipc-rejection'
        | 'persistence-corrupt'
        | 'ai-crash'
        | 'pty-failure'
        | 'file-not-found'
        | 'file-permission'
        | 'git-failure'
        | 'github-network'
        | 'database-connection'
        | 'database-query'
        | 'sftp-failure'
      ) => Promise<{ armed: true; fault: 'persistence-corrupt' }>
      probe?: () => Promise<{ ok: true }>
      shutdown: () => Promise<{ accepted: true }>
    }
    lifecycle: {
      respondToClose: (requestId: string, decision: LifecycleCloseDecision) => void
      onCloseRequested: (listener: (request: LifecycleCloseRequest) => void) => () => void
    }
    appMenu: {
      setContext: (section: AppMenuSection) => void
      onCommand: (listener: (command: AppMenuCommand) => void) => () => void
    }
    contextMenu: {
      open: (request: {
        kind: ContextMenuKind
        editable: boolean
        hasSelection: boolean
        contextId?: string
        enabledCommands?: AppMenuCommand[]
        contextFlags?: { expanded?: boolean; cancellable?: boolean; retryable?: boolean; stageable?: boolean; operable?: boolean; canCreate?: boolean; dirty?: boolean; hasOtherTabs?: boolean; hasRightTabs?: boolean; hasVisibleValue?: boolean }
      }) => Promise<{ opened: true }>
      onAction: (listener: (action: ContextMenuAction) => void) => () => void
    }
    workspace: import('./bridge').WorkspaceApi
    workspaceSession: import('./bridge').WorkspaceSessionApi
    volatileDrafts: import('./bridge').VolatileDraftsApi
    appearance: import('./bridge').AppearanceApi
    preferences: import('./bridge').PreferencesApi
    updates: import('./bridge').UpdatesApi
    files: import('./bridge').FilesApi
    instructions: import('./bridge').InstructionsApi
    skills: import('./bridge').ProjectSkillsApi
    pi: import('./bridge').PiApi
    systemSkills: import('./bridge').SystemSkillsApi
    runtime: import('./bridge').RuntimeCapabilitiesApi
    piSystem: import('./bridge').PiSystemApi
    piConfig: import('./bridge').PiConfigApi
    github: import('./bridge').GitHubApi
    workspaceCommands: import('./bridge').WorkspaceCommandsApi
    managedSsh: import('./bridge').ManagedSshApi
    remoteFiles: import('./bridge').RemoteFilesApi
    database: import('./bridge').DatabaseApi
    redis: VincodeRedisApi
    shellSessions: import('./bridge').ShellSessionsApi
    terminal: import('./bridge').TerminalApi
  }
}
