export interface DatabaseConnection {
  id: string
  name: string
  driver: 'sqlite' | 'postgres' | 'mysql' | 'mssql'
  sqlitePath?: string
  host?: string
  port?: number
  database?: string
  user?: string
  hasPassword: boolean
}

export interface DatabaseConnectionInput {
  name: string
  driver: DatabaseConnection['driver']
  sqlitePath?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
}

export interface DatabaseQueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  affectedRows: number | null
  durationMs: number
  hasMore: boolean
  resultBytes: number
  historyRecorded?: boolean
}

export interface DatabaseCancelResult {
  cancelled: boolean
  mutative: boolean
}

export interface DatabaseColumn {
  name: string
  type?: string
  nullable: boolean
  primaryKeyPosition?: number
  editable: boolean
}

export interface DatabaseTableSchema {
  name: string
  columns: DatabaseColumn[]
  primaryKey: string[]
}

export interface DatabaseRoutine {
  name: string
  kind: 'procedure' | 'function'
  definition: string | null
  definitionTruncated?: boolean
}

export interface DatabaseSchemaPage {
  tables: DatabaseTableSchema[]
  routines: DatabaseRoutine[]
  hasMore?: boolean
  nextOffset?: number | null
  totalResources?: number
}

export interface DatabaseTablePage {
  table: DatabaseTableSchema
  rows: Record<string, unknown>[]
  offset: number
  hasMore: boolean
  durationMs: number
  resultBytes: number
  readOnlyReason?: string
}

export interface DatabaseTableChange {
  key: Record<string, unknown>
  values: Record<string, unknown>
}

export interface DatabaseSavedQuery {
  id: string
  connectionId: string
  name: string
  sql: string
  updatedAt?: number
}

export interface DatabaseHistoryEntry {
  id: string
  connectionId: string
  sql: string
  executedAt: number
  durationMs: number
  affectedRows: number | null
}

export type DatabaseApi = {
  listConnections: () => Promise<DatabaseConnection[]>
  createConnection: (input: DatabaseConnectionInput) => Promise<DatabaseConnection>
  updateConnection: (id: string, input: DatabaseConnectionInput) => Promise<DatabaseConnection>
  deleteConnection: (id: string) => Promise<{ deleted: true }>
  connect: (id: string) => Promise<{ connected: true }>
  disconnect: (id: string) => Promise<{ disconnected: true }>
  execute: (
    id: string,
    sql: string,
    options: {
      operationId: string
      confirmed?: boolean
      offset?: number
      limit?: number
      timeoutMs?: number
    },
  ) => Promise<DatabaseQueryResult>
  cancel: (operationId: string) => Promise<DatabaseCancelResult>
  begin: (id: string) => Promise<{ active: true }>
  commit: (id: string) => Promise<{ active: false }>
  rollback: (id: string) => Promise<{ active: false }>
  inspectSchema: (id: string, options?: { force?: boolean; offset?: number; limit?: number }) => Promise<DatabaseSchemaPage>
  inspectRoutine: (id: string, routineName: string, kind: DatabaseRoutine['kind']) => Promise<DatabaseRoutine>
  tableRows: (id: string, tableName: string, options?: { offset?: number; limit?: number; filter?: string }) => Promise<DatabaseTablePage>
  updateTableRows: (id: string, tableName: string, changes: DatabaseTableChange[]) => Promise<{ updated: number }>
  listSavedQueries: (id: string) => Promise<DatabaseSavedQuery[]>
  saveQuery: (input: { connectionId: string; name: string; sql: string }) => Promise<DatabaseSavedQuery>
  updateSavedQuery: (id: string, input: { name: string; sql: string }) => Promise<DatabaseSavedQuery>
  deleteSavedQuery: (id: string) => Promise<{ deleted: true }>
  listHistory: (id: string, limit?: number) => Promise<DatabaseHistoryEntry[]>
  clearHistory: (id: string) => Promise<{ deleted: number }>
}
