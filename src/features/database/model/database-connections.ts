import type { DatabaseConnection, DatabaseConnectionInput } from '@/bridge'
import type { VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import type { DatabaseConnectionDraft, DatabaseDriver } from './database.types'

export const defaultSql = 'SELECT 1 AS risultato'
export const defaultDatabasePort: Record<Exclude<DatabaseDriver, 'sqlite'>, number> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
}

export function defaultConnectionDraft(): DatabaseConnectionDraft {
  return { name: '', driver: 'sqlite', sqlitePath: '' }
}

export function sameConnectionDraft(left: DatabaseConnectionDraft, right: DatabaseConnectionDraft) {
  return left.name === right.name
    && left.driver === right.driver
    && (left.sqlitePath ?? '') === (right.sqlitePath ?? '')
    && (left.host ?? '') === (right.host ?? '')
    && left.port === right.port
    && (left.database ?? '') === (right.database ?? '')
    && (left.user ?? '') === (right.user ?? '')
    && (left.password ?? '') === (right.password ?? '')
    && Boolean(left.hasPassword) === Boolean(right.hasPassword)
}

export function connectionInput(draft: DatabaseConnectionDraft): DatabaseConnectionInput {
  return draft.driver === 'sqlite'
    ? { name: draft.name || draft.sqlitePath?.split('/').at(-1) || 'SQLite', driver: 'sqlite', sqlitePath: draft.sqlitePath ?? '' }
    : {
        name: draft.name,
        driver: draft.driver,
        host: draft.host ?? '',
        port: draft.port ?? defaultDatabasePort[draft.driver],
        database: draft.database ?? '',
        user: draft.user ?? '',
        password: draft.password ?? '',
      }
}

export function databaseDriverLabel(driver: DatabaseDriver) {
  return driver === 'sqlite' ? 'SQLite' : driver === 'postgres' ? 'PostgreSQL' : driver === 'mysql' ? 'MySQL' : 'SQL Server'
}

export function connectionDraftFor(connection: DatabaseConnection): DatabaseConnectionDraft {
  return {
    name: connection.name,
    driver: connection.driver,
    sqlitePath: connection.sqlitePath ?? '',
    host: connection.host ?? '',
    port: connection.port,
    database: connection.database ?? '',
    user: connection.user ?? '',
    password: '',
    hasPassword: connection.hasPassword,
  }
}

export function sqlDraftIdentity(workspace: string, connectionId: string | null): VolatileDraftIdentity {
  return { scope: 'database-sql', workspace, resource: connectionId ?? 'unbound' }
}

export function connectionDraftIdentity(workspace: string, connectionId: string | null): VolatileDraftIdentity {
  return { scope: 'database-connection', workspace, resource: connectionId ?? 'new' }
}

export function gridDraftIdentity(workspace: string, connectionId: string, tableName: string): VolatileDraftIdentity {
  return { scope: 'database-grid', workspace, resource: JSON.stringify([connectionId, tableName]) }
}

export function parseConnectionDraft(value: string): DatabaseConnectionDraft | null {
  try {
    const draft = JSON.parse(value) as Partial<DatabaseConnectionDraft>
    if (!draft || typeof draft !== 'object' || !['sqlite', 'postgres', 'mysql', 'mssql'].includes(String(draft.driver)) || typeof draft.name !== 'string') return null
    if (draft.sqlitePath !== undefined && typeof draft.sqlitePath !== 'string') return null
    if (draft.host !== undefined && typeof draft.host !== 'string') return null
    if (draft.database !== undefined && typeof draft.database !== 'string') return null
    if (draft.user !== undefined && typeof draft.user !== 'string') return null
    if (draft.password !== undefined && typeof draft.password !== 'string') return null
    if (draft.port !== undefined && (!Number.isInteger(draft.port) || Number(draft.port) < 1 || Number(draft.port) > 65_535)) return null
    return draft as DatabaseConnectionDraft
  } catch {
    // La bozza locale non è attendibile: il chiamante la scarta senza registrare contenuti potenzialmente sensibili.
    return null
  }
}

export function tableSchemaName(name: string) {
  return name.includes('.') ? name.split('.')[0] : 'Tabelle'
}

export function tableLabel(name: string) {
  return name.includes('.') ? name.slice(name.indexOf('.') + 1) : name
}
