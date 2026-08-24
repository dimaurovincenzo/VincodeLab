/**
 * Contratto pubblico e valori di default della sessione workspace.
 *
 * Questo modulo descrive esclusivamente lo schema usato dal renderer: la
 * normalizzazione e la persistenza vivono nei rispettivi owner.
 */

export const WORKSPACE_SESSION_VERSION = 2 as const
export const WORKSPACE_SESSION_DEBOUNCE_MS = 400
export const MAX_WORKSPACE_SESSION_BYTES = 256 * 1024

export type WorkspaceSessionClientState = WorkspaceSessionState
export type WorkspaceSessionStorage = Pick<Window['vincodeLab']['workspaceSession'], 'get' | 'save'>
export type WorkspaceSessionUpdater = (current: Readonly<WorkspaceSessionState>) => WorkspaceSessionState
export type WorkspaceSessionLoadSource = 'stored' | 'default' | 'fallback' | 'cancelled' | 'superseded'
export type WorkspaceSessionRecovery = Readonly<{
  correlationId: string
  kind: 'corrupt'
}>

export type WorkspaceSessionClientSnapshot = Readonly<{
  state: WorkspaceSessionState
  generation: number
  revision: number
  persistedRevision: number
  loaded: boolean
  dirty: boolean
  saving: boolean
  updatedAt: number | null
  lastError: Error | null
}>

export type WorkspaceSessionLoadResult = Readonly<{
  state: WorkspaceSessionState
  generation: number
  applied: boolean
  source: WorkspaceSessionLoadSource
  recovery: WorkspaceSessionRecovery | null
}>

export type WorkspaceSessionClientOptions = Readonly<{
  storage?: WorkspaceSessionStorage
  debounceMs?: number
  onError?: (error: Error) => void
}>

export function createDefaultWorkspaceSessionState(): WorkspaceSessionState {
  return {
    navigation: { section: 'ai', aiTab: 'terminal' },
    editor: { openFiles: [], activeFile: null, expandedDirectoryIds: [], fileViews: [] },
    terminal: {
      tab: 'shell',
      remoteView: 'server',
      selectedProfileCommandId: null,
      openSessionCount: 0,
      activeSessionOrdinal: null,
    },
    github: {
      tab: 'changes',
      selectedDiffPath: null,
      selectedProjectNumber: null,
      issueStateFilter: 'OPEN',
      scroll: { changes: 0, graph: 0, issues: 0, projects: 0 },
    },
    database: {
      selectedConnectionId: null,
      sidebarTab: 'items',
      view: 'sql',
      expandedSchemaIds: [],
      selectedTableName: null,
      activeSavedQueryId: null,
      scroll: { explorer: 0, editor: 0, results: 0 },
    },
    redis: {
      selectedConnectionId: null,
      databaseIndex: 0,
      view: 'keys',
      typeFilter: 'all',
      inspectorTab: 'value',
    },
    panels: {
      editorExplorer: null,
      terminalCommands: null,
      remoteConnections: null,
      databaseSidebar: null,
      githubProjectPicker: null,
    },
    focus: { view: 'ai', target: null },
  }
}
