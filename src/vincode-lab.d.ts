interface PublicApplicationError {
  category: 'validation' | 'not-found' | 'permission' | 'authentication' | 'network' | 'timeout' | 'cancelled' | 'conflict' | 'process' | 'database' | 'filesystem' | 'git' | 'github' | 'remote' | 'configuration' | 'persistence' | 'internal'
  code: string
  correlationId: string
  message: string
  recoverable: boolean
  severity: 'info' | 'warning' | 'error'
}

interface WorkspaceOpenResult {
  path?: string
  error?: string
  errorIncident?: PublicApplicationError
}

interface RecentWorkspace {
  path: string
  lastOpenedAt: number
}

interface WorkspaceInstanceStatus {
  activeCount: number
  maxInstances: 2
  canOpenNew: boolean
  workspaceOpenElsewhere: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path'
}

interface WorkspaceLaunchResult {
  launched: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path' | 'launch-failed'
  message?: string
}

interface ProjectFileTreeNode {
  id: string
  name: string
  kind: 'file' | 'directory'
  children?: ProjectFileTreeNode[]
}

interface ProjectFileReadResult { id: string; name: string; content: string; revision: string; size: number }
interface ProjectFileSaveResult { id: string; revision: string; size: number }

interface ProjectFileIndexEntry {
  id: string
  name: string
  directory: string
  extension: string
  size: number
  modifiedAt: number
}

interface ProjectFileIndexResult {
  state: 'ready'
  workspacePath: string
  generation: number
  files: ProjectFileIndexEntry[]
  fileCount: number
  directoriesVisited: number
  entriesScanned: number
  truncated: boolean
  maxFiles: number
  startedAt: number
  completedAt: number
  durationMs: number
  cacheHit: boolean
}

interface ProjectFileIndexStatus {
  state: 'indexing' | 'ready' | 'error' | 'cancelled'
  workspacePath: string
  generation: number
  filesIndexed: number
  directoriesVisited: number
  entriesScanned: number
  truncated: boolean
  maxFiles: number
  startedAt: number
  updatedAt: number
  completedAt?: number
  error?: { code: string }
}

interface ProjectSkillIssue {
  level: 'error' | 'warning'
  message: string
}

interface ProjectSkill {
  id: string
  name: string
  description: string
  valid: boolean
  issues: ProjectSkillIssue[]
  content?: string
}

interface PiPackageSkill extends Omit<ProjectSkill, 'content'> {
  source: string
  packageName: string
  relativePath: string
}

type PiRuntimeStatus =
  | { state: 'ready'; executable: string; version: string }
  | { state: 'missing'; code: 'PI_NOT_INSTALLED'; executable: null; version: null }

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
    workspace: {
      open: () => Promise<WorkspaceOpenResult | null>
      getActive: () => Promise<WorkspaceOpenResult | null>
      listRecent: () => Promise<RecentWorkspace[]>
      reveal: () => Promise<{ revealed: true }>
      openRecent: (workspacePath: string) => Promise<WorkspaceOpenResult>
      instanceStatus: (workspacePath?: string) => Promise<WorkspaceInstanceStatus>
      openInNewInstance: (workspacePath: string) => Promise<WorkspaceLaunchResult>
      onOpened: (listener: (result: WorkspaceOpenResult | null) => void) => () => void
    }
    workspaceSession: import('./bridge').WorkspaceSessionApi
    volatileDrafts: import('./bridge').VolatileDraftsApi
    appearance: {
      get: () => Promise<'system' | 'light' | 'dark'>
      set: (appearance: 'system' | 'light' | 'dark') => Promise<'system' | 'light' | 'dark'>
    }
    preferences: import('./bridge').PreferencesApi
    updates: import('./bridge').UpdatesApi
    files: {
      list: () => Promise<{ entries: ProjectFileTreeNode[]; truncated: boolean }>
      listDirectory: (directoryId: string) => Promise<{ entries: ProjectFileTreeNode[]; truncated: boolean }>
      index: (options?: { force?: boolean }) => Promise<ProjectFileIndexResult>
      indexStatus: () => Promise<ProjectFileIndexStatus | null>
      read: (fileId: string) => Promise<ProjectFileReadResult>
      preview: (fileId: string) => Promise<{ id: string; name: string; kind: 'image' | 'pdf'; content: string; size: number }>
      prepareAttachment: (fileId: string) => Promise<import('./bridge').TerminalAttachment>
      create: (directoryId: string, fileName: string) => Promise<ProjectFileReadResult>
      createDirectory: (parentId: string, directoryName: string) => Promise<{ id: string; kind: 'directory'; name: string }>
      rename: (entryId: string, entryName: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; previousId: string; renamed: boolean }>
      duplicate: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; sourceId: string }>
      trash: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; trashed: true }>
      save: (fileId: string, content: string, options: { revision?: string; force?: boolean }) => Promise<ProjectFileSaveResult>
    }
    instructions: {
      get: () => Promise<{ exists: boolean; content: string }>
      save: (content: string) => Promise<{ exists: true; content: string }>
      clear: () => Promise<{ exists: false; content: string }>
    }
    skills: {
      list: () => Promise<ProjectSkill[]>
      get: (skillId: string) => Promise<ProjectSkill>
      create: (name: string) => Promise<ProjectSkill>
      update: (skillId: string, content: string) => Promise<ProjectSkill>
      delete: (skillId: string) => Promise<{ deleted: true }>
      reload: () => Promise<import('./bridge').AiTerminalReloadResult>
    }
    pi: import('./bridge').PiApi
    systemSkills: { list: () => Promise<ProjectSkill[]>; get: (id: string) => Promise<ProjectSkill>; create: (name: string) => Promise<ProjectSkill>; update: (id: string, content: string) => Promise<ProjectSkill>; delete: (id: string) => Promise<{ deleted: true }> }
    runtime: import('./bridge').RuntimeCapabilitiesApi
    piSystem: { status: () => Promise<PiRuntimeStatus>; list: () => Promise<string[]>; listSkills: () => Promise<PiPackageSkill[]>; install: (source: string) => Promise<{ output: string }>; update: (source: string) => Promise<{ output: string }>; remove: (source: string) => Promise<{ output: string }> }
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
