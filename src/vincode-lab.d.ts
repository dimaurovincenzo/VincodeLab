interface TerminalExitStatus {
  exitCode: number | null
  signal: number | string | null
  runtime?: AiTerminalRuntime
  piAvailable?: boolean
}

type AiTerminalRuntime = import('./bridge').AiTerminalRuntime
type AiTerminalFallbackReason = import('./bridge').AiTerminalFallbackReason
type AiTerminalReloadResult = import('./bridge').AiTerminalReloadResult
type AiTerminalRestartOptions = import('./bridge').AiTerminalRestartOptions
type AiTerminalRestartResult = import('./bridge').AiTerminalRestartResult

type ShellSessionStatus = 'starting' | 'running' | 'exited'
interface ShellSessionMetadata {
  sessionId: string
  title: string
  status: ShellSessionStatus
  active: boolean
  createdAt: number
  lastFocusedAt: number
  cols: number
  rows: number
  pid: number | null
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
interface ShellSessionList {
  activeSessionId: string | null
  sessions: ShellSessionMetadata[]
}
interface ShellSessionDataEvent {
  sessionId: string
  attachmentId: string
  generation: number
  sequence: number
  data: string
}
interface ShellSessionOutputAck {
  attachmentId: string
  generation: number
  sequence: number
}
interface ShellSessionRendererReady {
  attachmentId: string
  generation: number
  watermark: number
}
interface ShellSessionOutputBlock {
  sequence: number
  data: string
}
interface ShellSessionResumeSnapshot {
  sessionId: string
  attachmentId: string
  generation: number
  blocks: ShellSessionOutputBlock[]
  firstSequence: number
  watermark: number
  bytes: number
  truncated: boolean
  droppedBytes: number
  status: ShellSessionStatus
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
interface ShellSessionExitEvent {
  sessionId: string
  exitCode: number | null
  signal: number | string | null
  reason: 'exit' | 'closed'
}
type ShellSessionOneWayOperation = 'ready' | 'ack' | 'disconnect' | 'write' | 'resize'
type ShellSessionErrorRecovery = 'resume' | 'restart' | 'resize'
type ShellSessionErrorCategory =
  | 'validation'
  | 'not-found'
  | 'permission'
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'conflict'
  | 'process'
  | 'database'
  | 'filesystem'
  | 'git'
  | 'github'
  | 'remote'
  | 'configuration'
  | 'persistence'
  | 'internal'
interface ShellSessionErrorEvent {
  sessionId: string
  operation: ShellSessionOneWayOperation
  recovery: ShellSessionErrorRecovery
  error: {
    category: ShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}

type TerminalOneWayOperation = 'ready' | 'ack' | 'key' | 'resize'
type TerminalErrorRecovery = 'resume' | 'restart' | 'resize'
interface TerminalErrorEvent {
  operation: TerminalOneWayOperation
  recovery: TerminalErrorRecovery
  error: {
    category: ShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}

type PiConfigOneWayOperation = 'input' | 'resize'
type PiConfigErrorRecovery = 'restart' | 'resize'
interface PiConfigErrorEvent {
  operation: PiConfigOneWayOperation
  recovery: PiConfigErrorRecovery
  error: {
    category: ShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}

type TerminalStreamStatus = 'running' | 'paused' | 'stalled' | 'recovering' | 'ended'
type TerminalOutputBlock = { sessionId: string; sequence: number; data: string }
type TerminalOutputAck = { sessionId: string; sequence: number }
type TerminalResumeSnapshot = {
  sessionId: string
  snapshot: { data: string; firstSequence: number; watermark: number; bytes: number }
  status: TerminalStreamStatus
  exitStatus?: TerminalExitStatus
  runtime: AiTerminalRuntime
  fallbackReason?: AiTerminalFallbackReason
  piAvailable?: boolean
}
type TerminalStreamState = { sessionId: string; status: TerminalStreamStatus; queuedBytes: number }

interface TerminalAttachment {
  absolutePath: string
  name: string
}

type TerminalPasteStartResult =
  | { accepted: true; transferId: string; totalBytes: number }
  | { accepted: false; reason: 'invalid' | 'too-large' | 'not-running'; totalBytes: number; limit: number }
type TerminalPasteChunkResult =
  | { accepted: true; complete: boolean; sentBytes: number; totalBytes: number }
  | { accepted: false; reason: 'invalid-chunk' | 'cancelled' | 'not-running'; sentBytes: number; totalBytes: number }
type TerminalPasteCancelResult = { cancelled: boolean; sentBytes: number; totalBytes: number }
type TerminalRendererMetrics = { queuedBlocks: number; ackP50Ms: number; ackP95Ms: number; ackP99Ms: number; slowFrames: number; restoreCount: number; mode: 'standard' | 'webgl' }
interface TerminalDiagnosticsReport {
  version: 1
  generatedAt: string
  pipeline: { receivedBytes: number; renderedBytes: number; averageBlockBytes: number; maxBlockBytes: number; queuedBytes: number; peakQueuedBytes: number; pauseCount: number; pausedMs: number }
  renderer: TerminalRendererMetrics
  paste: { started: number; completed: number; cancelled: number; rejected: number; acceptedBytes: number; activeTransfers: number; pendingBytes: number }
}

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

interface GitFileStatus {
  path: string
  previousPath?: string
  index: string
  workingTree: string
  sensitive?: boolean
}

interface GitCommit {
  sha: string
  subject: string
  author: string
  date: string
}

interface GitGraphCommit { sha: string; parents: string[]; refs: string[]; subject: string }
interface GitBranch { name: string; current: boolean }
interface GitBranchPage { branches: GitBranch[]; hasMore: boolean; truncated: boolean }

interface GitStatus {
  isRepository: boolean
  branch?: string
  remote?: string | null
  upstream?: string | null
  ahead?: number
  behind?: number
  files: GitFileStatus[]
  commits: GitCommit[]
  graph: GitGraphCommit[]
  filesHasMore: boolean
  filesTruncated: boolean
  graphHasMore: boolean
  graphTruncated: boolean
  hasMore: boolean
  truncated: boolean
}

interface CacheMetadata { fetchedAt: number; expiresAt: number; stale: boolean; refreshError?: boolean }
interface CachedResult<T> { data: T; cache: CacheMetadata }
type CacheReadOptions = { force?: boolean }

interface GitHubIssue {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  author: { login: string } | null
  createdAt: string
  updatedAt: string
  url: string
  labels: { name: string }[]
  bodyTruncated?: boolean
  labelsHasMore?: boolean
}

interface GitHubProject {
  id: string
  number: number
  title: string
  shortDescription: string
  closed: boolean
  url: string
}

interface GitHubProjectBoard { project: GitHubProject; fields: GitHubProjectField[]; fieldsHasMore: boolean; fieldsTruncated: boolean; fieldOptionsTruncated: boolean; fieldsResultBytes: number; items: GitHubProjectItem[]; itemsHasMore: boolean; itemsTruncated: boolean; itemValuesTruncated: boolean; itemsResultBytes: number; hasMore: boolean; truncated: boolean }
interface GitHubProjectField { id: string; name: string; dataType: string; options?: { id: string; name: string; color?: string }[]; optionsHasMore?: boolean }
interface GitHubProjectItem { id: string; type: string; title?: string; content?: { title?: string; url?: string; number?: number; repository?: string }; parent?: { title: string; url: string; number: number; repository?: string }; assignees?: string[]; fieldValues?: Record<string, string>; status?: string; valuesTruncated?: boolean; [key: string]: unknown }
type GitHubProjectItemUpdate = { type: 'singleSelect'; optionId: string } | { type: 'text'; value: string } | { type: 'number'; value: number } | { type: 'date'; value: string } | { type: 'clear' }

interface GitHubData {
  repository: { nameWithOwner: string; url: string; owner: string } | null
  issues: GitHubIssue[]
  issuesHasMore: boolean
  issuesTruncated: boolean
  issuesResultBytes?: number
  projects: GitHubProject[]
  projectsHasMore: boolean
  projectsTruncated: boolean
  hasMore: boolean
  truncated: boolean
  githubDiagnostic: string | null
  projectsDiagnostic: string | null
}

type WorkspaceCommandKind = 'shell' | 'ssh'
interface WorkspaceCommand { id: string; categoryId: string; title: string; kind: WorkspaceCommandKind; command: string; note: string; sshDestination: string; remoteRoot: string }
interface WorkspaceCommandCategory { id: string; name: string; commands: WorkspaceCommand[] }
interface WorkspaceCommandInput { categoryId: string; title: string; kind: WorkspaceCommandKind; command: string; note: string; sshDestination: string; remoteRoot: string }
interface ManagedSshConnection { id: string; commandId: string; title: string; destination: string; remoteRoot: string; state: 'connecting' | 'connected' | 'disconnected' | 'error'; error?: string }
interface RemoteEntry { id: string; name: string; kind: 'file' | 'directory' | 'link' | 'unknown'; displayPath: string; size: number | null; modifiedAt: number | null; mode: number | null; destructiveAllowed: boolean }
interface RemoteTrackedFile { id: string; connectionId: string; name: string; remotePath: string; localState: 'synced' | 'modified' | 'conflict' | 'offline'; size: number | null; cacheSize: number; modifiedAt: number | null; mode: number | null; baselineHash: string; localHash: string; lastError: string | null; updatedAt: number }
interface RemoteTransfer { id: string; direction: 'download' | 'upload'; name: string; state: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'; bytes: number | null; total: number | null; error?: string }
interface RemoteCompareResult { baselineChanged: boolean; binary: boolean; remoteHash: string; baselineHash: string; localHash: string; remoteContent?: string; localContent?: string }

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
      prepareAttachment: (fileId: string) => Promise<TerminalAttachment>
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
      reload: () => Promise<AiTerminalReloadResult>
    }
    pi: {
      reload: () => Promise<AiTerminalReloadResult>
      restart: (options?: AiTerminalRestartOptions) => Promise<AiTerminalRestartResult>
    }
    systemSkills: { list: () => Promise<ProjectSkill[]>; get: (id: string) => Promise<ProjectSkill>; create: (name: string) => Promise<ProjectSkill>; update: (id: string, content: string) => Promise<ProjectSkill>; delete: (id: string) => Promise<{ deleted: true }> }
    runtime: import('./bridge').RuntimeCapabilitiesApi
    piSystem: { status: () => Promise<PiRuntimeStatus>; list: () => Promise<string[]>; listSkills: () => Promise<PiPackageSkill[]>; install: (source: string) => Promise<{ output: string }>; update: (source: string) => Promise<{ output: string }>; remove: (source: string) => Promise<{ output: string }> }
    piConfig: { start: () => Promise<{ started: boolean; reused: boolean }>; close: () => Promise<{ closed: true }>; write: (data: string) => void; resize: (dimensions: { cols: number; rows: number }) => void; onData: (listener: (data: string) => void) => () => void; onExit: (listener: (status: TerminalExitStatus) => void) => () => void; onError: (listener: (event: PiConfigErrorEvent) => void) => () => void }
    github: {
      gitStatus: (options?: CacheReadOptions) => Promise<CachedResult<GitStatus>>
      initRepository: () => Promise<GitStatus>
      addRemote: (remoteUrl: string) => Promise<GitStatus>
      createRepository: (repositoryName: string, visibility: 'private' | 'public') => Promise<GitStatus>
      stage: (filePaths: string[]) => Promise<GitStatus>
      unstage: (filePaths: string[]) => Promise<GitStatus>
      commit: (message: string) => Promise<GitStatus>
      push: () => Promise<GitStatus>
      fetch: () => Promise<GitStatus>
      pullRebase: () => Promise<GitStatus>
      branches: () => Promise<GitBranchPage>
      switchBranch: (branchName: string) => Promise<GitStatus>
      createBranch: (branchName: string) => Promise<GitStatus>
      fileDiff: (filePath: string) => Promise<string>
      revert: (sha: string) => Promise<GitStatus>
      data: (options?: CacheReadOptions) => Promise<CachedResult<GitHubData>>
      createIssue: (title: string, body: string) => Promise<GitHubData>
      updateIssue: (issueNumber: number, title: string, body: string, state: 'OPEN' | 'CLOSED') => Promise<GitHubData>
      projectBoard: (projectNumber: number, options?: CacheReadOptions) => Promise<CachedResult<GitHubProjectBoard>>
      createProject: (title: string) => Promise<GitHubProject[]>
      editProject: (projectNumber: number, title: string, description: string) => Promise<GitHubProject[]>
      closeProject: (projectNumber: number, undo: boolean) => Promise<GitHubProject[]>
      addIssueToProject: (projectNumber: number, issueUrl: string) => Promise<GitHubProjectBoard>
      updateProjectItem: (projectNumber: number, itemId: string, fieldId: string, update: GitHubProjectItemUpdate) => Promise<GitHubProjectBoard>
      projectItemFields: (projectNumber: number, itemId: string) => Promise<Record<string, string>>
      createProjectDraft: (projectNumber: number, title: string, body: string) => Promise<GitHubProjectBoard>
      archiveProjectItem: (projectNumber: number, itemId: string, undo: boolean) => Promise<GitHubProjectBoard>
    }
    workspaceCommands: {
      list: () => Promise<{ categories: WorkspaceCommandCategory[] }>
      createCategory: (name: string) => Promise<{ id: string; name: string }>
      updateCategory: (categoryId: string, name: string) => Promise<{ id: string; name: string }>
      deleteCategory: (categoryId: string) => Promise<{ deleted: true }>
      create: (input: WorkspaceCommandInput) => Promise<WorkspaceCommand>
      update: (commandId: string, input: WorkspaceCommandInput) => Promise<WorkspaceCommand>
      move: (commandId: string, categoryId: string) => Promise<{ moved: true }>
      delete: (commandId: string) => Promise<{ deleted: true }>
      run: (commandId: string) => Promise<{ executed: true; managedConnectionId?: string }>
    }
    managedSsh: {
      list: () => Promise<ManagedSshConnection[]>
      check: (connectionId: string) => Promise<boolean>
      disconnect: (connectionId: string) => Promise<{ disconnected: true }>
      onStatus: (listener: (status: ManagedSshConnection) => void) => () => void
    }
    remoteFiles: {
      browse: (connectionId: string, directoryId?: string | null) => Promise<{ path: string; entries: RemoteEntry[] }>
      downloadAndTrack: (entryId: string) => Promise<RemoteTrackedFile>
      downloadAs: (entryId: string) => Promise<{ saved: boolean }>
      read: (fileId: string) => Promise<{ file: RemoteTrackedFile; content: string }>
      preview: (fileId: string) => Promise<{ file: RemoteTrackedFile; binary: boolean; size: number }>
      saveLocal: (fileId: string, content: string) => Promise<RemoteTrackedFile>
      compare: (fileId: string) => Promise<RemoteCompareResult>
      upload: (fileId: string, options?: { force?: boolean }) => Promise<{ status: 'synced' | 'conflict'; uploaded: boolean; file?: RemoteTrackedFile }>
      chooseAndUpload: (connectionId: string, directoryId?: string | null) => Promise<Array<{ name: string; uploaded: true }>>
      cancelTransfer: (transferId: string) => Promise<{ cancelled: boolean }>
      createDirectory: (connectionId: string, parentId: string | null, name: string) => Promise<{ created: true }>
      rename: (entryId: string, name: string) => Promise<{ renamed: true }>
      remove: (entryId: string) => Promise<{ removed: true }>
      discard: (fileId: string, options?: { force?: boolean }) => Promise<{ removed: true }>
      listTracked: () => Promise<RemoteTrackedFile[]>
      revealLocal: (fileId: string) => Promise<{ revealed: true }>
      cleanup: (options?: { olderThan?: number }) => Promise<{ removed: number }>
      onTransfer: (listener: (transfer: RemoteTransfer) => void) => () => void
    }
    database: import('./bridge').DatabaseApi
    redis: VincodeRedisApi
    shellSessions: {
      list: () => Promise<ShellSessionList>
      resume: (sessionId: string) => Promise<ShellSessionResumeSnapshot>
      ready: (sessionId: string, message: ShellSessionRendererReady) => void
      ack: (sessionId: string, message: ShellSessionOutputAck) => void
      disconnect: (sessionId: string, message: { attachmentId: string; generation: number }) => void
      create: () => Promise<ShellSessionMetadata>
      focus: (sessionId: string) => Promise<ShellSessionMetadata>
      write: (sessionId: string, data: string) => void
      resize: (sessionId: string, dimensions: { cols: number; rows: number }) => void
      restart: (sessionId: string) => Promise<ShellSessionMetadata>
      close: (sessionId: string) => Promise<{ closed: boolean; activeSessionId: string | null }>
      onData: (listener: (event: ShellSessionDataEvent) => void) => () => void
      onExit: (listener: (event: ShellSessionExitEvent) => void) => () => void
      onError: (listener: (event: ShellSessionErrorEvent) => void) => () => void
    }
    terminal: {
      resume: (request: { knownSessionId?: string; lastAcknowledgedSequence?: number }) => Promise<TerminalResumeSnapshot>
      ready: (message: { sessionId: string; watermark: number }) => void
      ack: (message: TerminalOutputAck) => void
      chooseAttachments: () => Promise<TerminalAttachment[]>
      prepareDroppedAttachments: (files: File[]) => Promise<TerminalAttachment[]>
      writeKey: (data: string) => void
      writeInput: (data: string) => Promise<{ accepted: true; bytes: number }>
      startPaste: (input: { totalBytes: number }) => Promise<TerminalPasteStartResult>
      writePasteChunk: (input: { transferId: string; index: number; data: string }) => Promise<TerminalPasteChunkResult>
      cancelPaste: (transferId: string) => Promise<TerminalPasteCancelResult>
      reportRendererMetrics: (metrics: TerminalRendererMetrics) => void
      diagnostics: () => Promise<TerminalDiagnosticsReport>
      exportDiagnostics: () => Promise<{ exported: boolean; filePath?: string }>
      resize: (dimensions: { cols: number; rows: number }) => void
      onOutput: (listener: (block: TerminalOutputBlock) => void) => () => void
      onStreamState: (listener: (state: TerminalStreamState) => void) => () => void
      onExit: (listener: (status: TerminalExitStatus) => void) => () => void
      onError: (listener: (event: TerminalErrorEvent) => void) => () => void
    }
  }
}
