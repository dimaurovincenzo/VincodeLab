import type {
  AppearanceApi,
  AppMenuApi as BridgeAppMenuApi,
  AppMenuCommand as BridgeAppMenuCommand,
  AppMenuSection as BridgeAppMenuSection,
  BenchmarkApi as BridgeBenchmarkApi,
  BenchmarkFault as BridgeBenchmarkFault,
  BenchmarkWindowBounds as BridgeBenchmarkWindowBounds,
  BenchmarkWindowRectangle as BridgeBenchmarkWindowRectangle,
  ContextMenuAction as BridgeContextMenuAction,
  ContextMenuApi as BridgeContextMenuApi,
  ContextMenuCommand as BridgeContextMenuCommand,
  ContextMenuFlags as BridgeContextMenuFlags,
  ContextMenuKind as BridgeContextMenuKind,
  ContextMenuOpenRequest as BridgeContextMenuOpenRequest,
  DatabaseApi,
  FilesApi,
  GitHubApi,
  InstructionsApi,
  LifecycleApi as BridgeLifecycleApi,
  LifecycleCloseDecision as BridgeLifecycleCloseDecision,
  LifecycleCloseReason as BridgeLifecycleCloseReason,
  LifecycleCloseRequest as BridgeLifecycleCloseRequest,
  ManagedSshApi,
  PiApi,
  PiConfigApi,
  PiSystemApi,
  PreferencesApi,
  ProjectSkillsApi,
  RedisApi,
  RemoteFilesApi,
  RuntimeCapabilitiesApi,
  ShellSessionsApi,
  SystemSkillsApi,
  TerminalApi,
  UpdatesApi,
  VincodeLabBridge as BridgeContract,
  VolatileDraftsApi,
  WorkspaceApi,
  WorkspaceCommandsApi,
  WorkspaceSessionApi,
} from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedAppMenuSection =
  | 'home'
  | 'ai'
  | 'ai-skills'
  | 'ai-instructions'
  | 'editor'
  | 'terminal'
  | 'github'
  | 'database'
  | 'redis'
  | 'settings'

type ExpectedAppMenuCommand =
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

type ExpectedAppMenuApi = {
  setContext: (section: ExpectedAppMenuSection) => void
  onCommand: (listener: (command: ExpectedAppMenuCommand) => void) => () => void
}

type ExpectedContextMenuKind =
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

type ExpectedContextMenuCommand =
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

type ExpectedContextMenuAction = {
  command: ExpectedContextMenuCommand
  contextId: string | null
  contextKind: Exclude<ExpectedContextMenuKind, 'default' | 'terminal'>
}

type ExpectedContextMenuFlags = {
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

type ExpectedContextMenuOpenRequest = {
  kind: ExpectedContextMenuKind
  editable: boolean
  hasSelection: boolean
  contextId?: string
  enabledCommands?: ExpectedAppMenuCommand[]
  contextFlags?: ExpectedContextMenuFlags
}

type ExpectedContextMenuApi = {
  open: (request: ExpectedContextMenuOpenRequest) => Promise<{ opened: true }>
  onAction: (listener: (action: ExpectedContextMenuAction) => void) => () => void
}

type ExpectedLifecycleCloseReason = 'window' | 'quit'
type ExpectedLifecycleCloseDecision = 'proceed' | 'cancel'
type ExpectedLifecycleCloseRequest = { requestId: string; reason: ExpectedLifecycleCloseReason }
type ExpectedLifecycleApi = {
  respondToClose: (requestId: string, decision: ExpectedLifecycleCloseDecision) => void
  onCloseRequested: (listener: (request: ExpectedLifecycleCloseRequest) => void) => () => void
}

type ExpectedBenchmarkFault =
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

type ExpectedBenchmarkWindowRectangle = {
  height: number
  width: number
  x: number
  y: number
}

type ExpectedBenchmarkWindowBounds = {
  bounds: ExpectedBenchmarkWindowRectangle
  contentBounds: ExpectedBenchmarkWindowRectangle
  maximized: boolean
  visible: boolean
}

type ExpectedBenchmarkApi = {
  captureWindowBounds?: () => Promise<ExpectedBenchmarkWindowBounds>
  dispatchCommand: (command: 'workbench.commandPalette' | 'workbench.quickOpen') => Promise<{ dispatched: true }>
  injectFault?: <Fault extends ExpectedBenchmarkFault>(fault: Fault) => Promise<{ armed: true; fault: Fault }>
  probe?: () => Promise<{ ok: true }>
  shutdown: () => Promise<{ accepted: true }>
}

type ExpectedVincodeLabBridge = {
  benchmark?: BridgeBenchmarkApi
  lifecycle: BridgeLifecycleApi
  appMenu: BridgeAppMenuApi
  contextMenu: BridgeContextMenuApi
  workspace: WorkspaceApi
  workspaceSession: WorkspaceSessionApi
  volatileDrafts: VolatileDraftsApi
  appearance: AppearanceApi
  preferences: PreferencesApi
  updates: UpdatesApi
  files: FilesApi
  instructions: InstructionsApi
  skills: ProjectSkillsApi
  pi: PiApi
  systemSkills: SystemSkillsApi
  runtime: RuntimeCapabilitiesApi
  piSystem: PiSystemApi
  piConfig: PiConfigApi
  github: GitHubApi
  workspaceCommands: WorkspaceCommandsApi
  managedSsh: ManagedSshApi
  remoteFiles: RemoteFilesApi
  database: DatabaseApi
  redis: RedisApi
  shellSessions: ShellSessionsApi
  terminal: TerminalApi
}

declare const rendererWindow: Window
declare const injectFault: NonNullable<BridgeBenchmarkApi['injectFault']>
const databaseFaultResult = injectFault('database-query')

export type VincodeLabBridgeContractAssertions = [
  Expect<Equal<BridgeAppMenuSection, ExpectedAppMenuSection>>,
  Expect<Equal<BridgeAppMenuCommand, ExpectedAppMenuCommand>>,
  Expect<Equal<BridgeAppMenuApi, ExpectedAppMenuApi>>,
  Expect<Equal<BridgeContextMenuKind, ExpectedContextMenuKind>>,
  Expect<Equal<BridgeContextMenuCommand, ExpectedContextMenuCommand>>,
  Expect<Equal<BridgeContextMenuAction, ExpectedContextMenuAction>>,
  Expect<Equal<BridgeContextMenuFlags, ExpectedContextMenuFlags>>,
  Expect<Equal<BridgeContextMenuOpenRequest, ExpectedContextMenuOpenRequest>>,
  Expect<Equal<BridgeContextMenuApi, ExpectedContextMenuApi>>,
  Expect<Equal<BridgeLifecycleCloseReason, ExpectedLifecycleCloseReason>>,
  Expect<Equal<BridgeLifecycleCloseDecision, ExpectedLifecycleCloseDecision>>,
  Expect<Equal<BridgeLifecycleCloseRequest, ExpectedLifecycleCloseRequest>>,
  Expect<Equal<BridgeLifecycleApi, ExpectedLifecycleApi>>,
  Expect<Equal<BridgeBenchmarkFault, ExpectedBenchmarkFault>>,
  Expect<Equal<BridgeBenchmarkWindowRectangle, ExpectedBenchmarkWindowRectangle>>,
  Expect<Equal<BridgeBenchmarkWindowBounds, ExpectedBenchmarkWindowBounds>>,
  Expect<Equal<BridgeBenchmarkApi, ExpectedBenchmarkApi>>,
  Expect<Equal<Awaited<typeof databaseFaultResult>, { armed: true; fault: 'database-query' }>>,
  Expect<Equal<BridgeContract, ExpectedVincodeLabBridge>>,
  Expect<Equal<keyof BridgeContract,
    | 'benchmark'
    | 'lifecycle'
    | 'appMenu'
    | 'contextMenu'
    | 'workspace'
    | 'workspaceSession'
    | 'volatileDrafts'
    | 'appearance'
    | 'preferences'
    | 'updates'
    | 'files'
    | 'instructions'
    | 'skills'
    | 'pi'
    | 'systemSkills'
    | 'runtime'
    | 'piSystem'
    | 'piConfig'
    | 'github'
    | 'workspaceCommands'
    | 'managedSsh'
    | 'remoteFiles'
    | 'database'
    | 'redis'
    | 'shellSessions'
    | 'terminal'
  >>,
  Expect<Equal<typeof rendererWindow.vincodeLab, BridgeContract>>,
]

// @ts-expect-error I comandi menu devono essere importati dal bridge, non dichiarati globalmente.
export type AppMenuCommandContractMustNotBeGlobal = AppMenuCommand
// @ts-expect-error Le azioni del menu contestuale devono essere importate dal bridge, non dichiarate globalmente.
export type ContextMenuActionContractMustNotBeGlobal = ContextMenuAction
// @ts-expect-error Il lifecycle deve essere importato dal bridge, non dichiarato globalmente.
export type LifecycleCloseRequestContractMustNotBeGlobal = LifecycleCloseRequest
// @ts-expect-error Il benchmark deve essere importato dal bridge, non dichiarato globalmente.
export type BenchmarkApiContractMustNotBeGlobal = BenchmarkApi
// @ts-expect-error Il bridge concreto deve essere importato dal public entry, non dichiarato globalmente.
export type VincodeLabBridgeContractMustNotBeGlobal = VincodeLabBridge
