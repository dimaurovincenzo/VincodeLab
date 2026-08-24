export { bridgeNamespace, getVincodeLabBridge, optionalVincodeLabBridge } from './electron/get-vincode-lab-bridge'
export type {
  AiTerminalFallbackReason,
  AiTerminalReloadResult,
  AiTerminalRestartOptions,
  AiTerminalRestartResult,
  AiTerminalRuntime,
  AiTerminalRuntimeState,
} from './contracts/ai-terminal.types'
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
  RuntimeCapabilitiesApi,
  RuntimeCapabilitiesSnapshot,
  RuntimeCapability,
} from './contracts/runtime-capabilities.types'
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
export type { VincodeLabBridge } from './contracts/vincode-lab-bridge'
