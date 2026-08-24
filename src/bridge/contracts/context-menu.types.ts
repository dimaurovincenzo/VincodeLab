import type { AppMenuCommand } from './app-menu.types'

export type ContextMenuKind =
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

export type ContextMenuCommand =
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

export type ContextMenuAction = {
  command: ContextMenuCommand
  contextId: string | null
  contextKind: Exclude<ContextMenuKind, 'default' | 'terminal'>
}

export type ContextMenuFlags = {
  expanded?: boolean
  cancellable?: boolean
  retryable?: boolean
  stageable?: boolean
  operable?: boolean
  canCreate?: boolean
  dirty?: boolean
  hasOtherTabs?: boolean
  hasRightTabs?: boolean
  hasVisibleValue?: boolean
}

export type ContextMenuOpenRequest = {
  kind: ContextMenuKind
  editable: boolean
  hasSelection: boolean
  contextId?: string
  enabledCommands?: AppMenuCommand[]
  contextFlags?: ContextMenuFlags
}

export type ContextMenuApi = {
  open: (request: ContextMenuOpenRequest) => Promise<{ opened: true }>
  onAction: (listener: (action: ContextMenuAction) => void) => () => void
}
