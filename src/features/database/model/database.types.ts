import type {
  DatabaseConnection,
  DatabaseConnectionInput,
  DatabaseRoutine,
  DatabaseSchemaPage as DatabaseSchemaTransportPage,
  DatabaseTableSchema,
  WorkspaceSessionState,
} from '@/bridge'
import type { UserError } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

export type DatabaseDriver = DatabaseConnection['driver']
export type DatabaseConnectionDraft = DatabaseConnectionInput & { hasPassword?: boolean }
export type DatabaseSchema = { tables: DatabaseTableSchema[]; routines: DatabaseRoutine[] }
export type DatabaseSchemaPage = DatabaseSchemaTransportPage & {
  offset?: number
}
export type DatabaseToolbarAction = 'schema' | 'begin' | 'commit' | 'rollback' | 'format' | null

export type DatabaseWorkbenchContext = {
  connectionId: string | null
  connectionName: string | null
  executing: boolean
  sql: string
  tableName: string | null
  transactionActive: boolean
}

export type DatabaseWorkspaceProps = {
  workspace: string
  focusRequest?: number
  initialState?: WorkspaceSessionState['database']
  onContextChange?: (context: DatabaseWorkbenchContext) => void
  onSessionChange?: (state: Pick<WorkspaceSessionState['database'], 'selectedConnectionId' | 'sidebarTab' | 'view' | 'expandedSchemaIds' | 'selectedTableName' | 'activeSavedQueryId'>) => void
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}

export type DatabaseSchemaTreeNode = {
  kind: 'root' | 'group' | 'table' | 'routine'
  value: string
  label: string
  children?: DatabaseSchemaTreeNode[]
  count?: number
  expansionKey?: string
  tableName?: string
  routine?: DatabaseRoutine
}

export type QueryHistoryRefreshFailure = {
  connectionId: string
  error: UserError
  recovery: 'copy-query' | 'refresh-history'
  sql?: string
}

export type DatabaseGuardFailure = { error: UserError; recovery: 'save' | 'discard' }
