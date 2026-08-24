export { bridgeNamespace, getVincodeLabBridge, optionalVincodeLabBridge } from './electron/get-vincode-lab-bridge'
export type {
  ApplicationErrorCategory,
  ApplicationErrorSeverity,
  PublicApplicationError,
} from './contracts/application-error.types'
export type {
  AppAppearance,
  AppearanceApi,
} from './contracts/appearance.types'
export type {
  AiTerminalReloadResult,
  AiTerminalRestartResult,
  PiApi,
  PiSession,
  PiSessionActivity,
  PiSessionsState,
  PiSessionStatus,
} from './contracts/ai-terminal.types'
export type {
  AppMenuApi,
  AppMenuCommand,
  AppMenuSection,
} from './contracts/app-menu.types'
export type {
  BenchmarkApi,
  BenchmarkFault,
  BenchmarkWindowBounds,
  BenchmarkWindowRectangle,
} from './contracts/benchmark.types'
export type {
  ContextMenuAction,
  ContextMenuApi,
  ContextMenuCommand,
  ContextMenuFlags,
  ContextMenuKind,
  ContextMenuOpenRequest,
} from './contracts/context-menu.types'
export type {
  DatabaseApi,
  DatabaseCancelResult,
  DatabaseColumn,
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseHistoryEntry,
  DatabaseQueryResult,
  DatabaseRoutine,
  DatabaseSavedQuery,
  DatabaseSchemaPage,
  DatabaseTableChange,
  DatabaseTablePage,
  DatabaseTableSchema,
} from './contracts/database.types'
export type {
  FilesApi,
  ProjectFileIndexEntry,
  ProjectFileContentMatch,
  ProjectFileContentSearchResult,
  ProjectFileIndexResult,
  ProjectFileIndexStatus,
  ProjectFileReadResult,
  ProjectFileSaveResult,
  ProjectFileTreeNode,
} from './contracts/files.types'
export type {
  GitBranch,
  GitBranchPage,
  GitCommit,
  GitFileStatus,
  GitGraphCommit,
  GitStatus,
} from './contracts/git.types'
export type {
  CachedResult,
  CacheMetadata,
  CacheReadOptions,
  GitHubApi,
  GitHubData,
  GitHubIssue,
  GitHubProject,
  GitHubProjectBoard,
  GitHubProjectField,
  GitHubProjectItem,
  GitHubProjectItemUpdate,
} from './contracts/github.types'
export type {
  ManagedSshApi,
  ManagedSshConnection,
} from './contracts/managed-ssh.types'
export type {
  LifecycleApi,
  LifecycleCloseDecision,
  LifecycleCloseReason,
  LifecycleCloseRequest,
} from './contracts/lifecycle.types'
export type {
  PiConfigApi,
  PiConfigErrorEvent,
  PiConfigErrorRecovery,
  PiConfigOneWayOperation,
} from './contracts/pi-config.types'
export type {
  InstructionsApi,
  PiPackageSkill,
  PiRuntimeStatus,
  PiSystemApi,
  ProjectSkill,
  ProjectSkillIssue,
  ProjectSkillsApi,
  SystemSkillsApi,
} from './contracts/project-resources.types'
export type {
  AppPreferenceDefinition,
  AppPreferencesSnapshot,
  AppPreferenceValue,
  PreferencesApi,
} from './contracts/preferences.types'
export type {
  RedisApi,
  RedisConnection,
  RedisConnectionInput,
  RedisConnectionTestResult,
  RedisHashInspection,
  RedisInspectInput,
  RedisInspection,
  RedisJsonInspection,
  RedisKeySummary,
  RedisKeyType,
  RedisListInspection,
  RedisPayloadMatch,
  RedisPayloadSearchInput,
  RedisPayloadSearchProgress,
  RedisPayloadSearchResult,
  RedisScanInput,
  RedisScanPage,
  RedisSetInspection,
  RedisStreamInspection,
  RedisStringInspection,
  RedisZSetInspection,
} from './contracts/redis.types'
export type {
  RemoteCompareResult,
  RemoteEntry,
  RemoteFilesApi,
  RemoteTrackedFile,
  RemoteTransfer,
} from './contracts/remote-files.types'
export type {
  RuntimeCapabilitiesApi,
  RuntimeCapabilitiesSnapshot,
  RuntimeCapability,
} from './contracts/runtime-capabilities.types'
export type {
  ShellSessionDataEvent,
  ShellSessionErrorCategory,
  ShellSessionErrorEvent,
  ShellSessionErrorRecovery,
  ShellSessionExitEvent,
  ShellSessionList,
  ShellSessionMetadata,
  ShellSessionOneWayOperation,
  ShellSessionOutputAck,
  ShellSessionOutputBlock,
  ShellSessionRendererReady,
  ShellSessionResumeSnapshot,
  ShellSessionsApi,
  ShellSessionStatus,
} from './contracts/shell-sessions.types'
export type {
  TerminalApi,
  TerminalAttachment,
  TerminalDiagnosticsReport,
  TerminalErrorEvent,
  TerminalErrorRecovery,
  TerminalExitStatus,
  TerminalOneWayOperation,
  TerminalOutputAck,
  TerminalOutputBlock,
  TerminalPasteCancelResult,
  TerminalPasteChunkResult,
  TerminalPasteStartResult,
  TerminalRendererMetrics,
  TerminalResumeSnapshot,
  TerminalStreamState,
  TerminalStreamStatus,
} from './contracts/terminal.types'
export type {
  ManagedUpdate,
  UpdatesApi,
} from './contracts/updates.types'
export type {
  RendererDraftIdentity,
  RendererDraftScope,
  RendererDraftSnapshot,
  VolatileDraftsApi,
} from './contracts/volatile-drafts.types'
export type {
  WorkspaceSessionApi,
  WorkspaceSessionFileRef,
  WorkspaceSessionFileView,
  WorkspaceSessionFocusTarget,
  WorkspaceSessionSection,
  WorkspaceSessionSnapshot,
  WorkspaceSessionState,
  WorkspaceSessionWriteSnapshot,
} from './contracts/workspace-session.types'
export type {
  WorkspaceCommand,
  WorkspaceCommandCategory,
  WorkspaceCommandInput,
  WorkspaceCommandKind,
  WorkspaceCommandsApi,
} from './contracts/workspace-commands.types'
export type {
  RecentWorkspace,
  WorkspaceApi,
  WorkspaceInstanceStatus,
  WorkspaceLaunchResult,
  WorkspaceOpenResult,
} from './contracts/workspace.types'
export type { VincodeLabBridge } from './contracts/vincode-lab-bridge'
