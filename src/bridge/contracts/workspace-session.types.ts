export type WorkspaceSessionSection = 'ai' | 'editor' | 'terminal' | 'github' | 'database' | 'redis' | 'settings'

export type WorkspaceSessionFocusTarget =
  | 'ai.terminal'
  | 'ai.instructions'
  | 'ai.skills'
  | 'editor.code'
  | 'editor.tabs'
  | 'editor.tree'
  | 'terminal.shell'
  | 'terminal.commands'
  | 'terminal.remote'
  | 'github.changes'
  | 'github.diff'
  | 'github.graph'
  | 'github.issues'
  | 'github.projects'
  | 'database.query'
  | 'database.results'
  | 'database.schema'
  | 'redis.keys'
  | 'redis.search'
  | 'redis.inspector'
  | 'settings.primary'

export interface WorkspaceSessionFileRef {
  source: 'workspace' | 'remote'
  id: string
  mode?: 'source' | 'preview'
}

export interface WorkspaceSessionFileView extends WorkspaceSessionFileRef {
  selection: { anchor: number; head: number }
  scroll: { top: number; left: number }
}

export interface WorkspaceSessionState {
  navigation: {
    section: WorkspaceSessionSection
    aiTab: 'terminal' | 'skills' | 'instructions'
  }
  editor: {
    openFiles: WorkspaceSessionFileRef[]
    activeFile: WorkspaceSessionFileRef | null
    expandedDirectoryIds: string[]
    fileViews: WorkspaceSessionFileView[]
  }
  terminal: {
    tab: 'shell' | 'remote'
    remoteView: 'server' | 'local'
    selectedProfileCommandId: string | null
    openSessionCount: number
    activeSessionOrdinal: number | null
  }
  github: {
    tab: 'changes' | 'graph' | 'issues' | 'projects'
    selectedDiffPath: string | null
    selectedProjectNumber: number | null
    issueStateFilter: 'all' | 'OPEN' | 'CLOSED'
    scroll: { changes: number; graph: number; issues: number; projects: number }
  }
  database: {
    selectedConnectionId: string | null
    sidebarTab: 'items' | 'queries' | 'history'
    view: 'sql' | 'data'
    expandedSchemaIds: string[]
    selectedTableName: string | null
    activeSavedQueryId: string | null
    scroll: { explorer: number; editor: number; results: number }
  }
  redis: {
    selectedConnectionId: string | null
    databaseIndex: number
    view: 'keys' | 'search'
    typeFilter: 'all' | 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'json'
    inspectorTab: 'value' | 'metadata'
  }
  panels: {
    editorExplorer: number | null
    terminalCommands: number | null
    remoteConnections: number | null
    databaseSidebar: number | null
    githubProjectPicker: number | null
  }
  focus: {
    view: WorkspaceSessionSection
    target: WorkspaceSessionFocusTarget | null
  }
}

export interface WorkspaceSessionWriteSnapshot {
  version: 2
  state: WorkspaceSessionState
}

export interface WorkspaceSessionSnapshot extends WorkspaceSessionWriteSnapshot {
  updatedAt: number | null
  recovery?: {
    correlationId: string
    kind: 'corrupt'
  }
}

export type WorkspaceSessionApi = {
  get: () => Promise<WorkspaceSessionSnapshot>
  save: (snapshot: WorkspaceSessionWriteSnapshot) => Promise<WorkspaceSessionSnapshot>
}
