import { describe, expect, it } from 'vitest'
import type { DatabaseConnection } from '@/bridge'
import {
  connectionDraftFor,
  connectionDraftIdentity,
  connectionInput,
  databaseDriverLabel,
  defaultConnectionDraft,
  defaultDatabasePort,
  defaultSql,
  gridDraftIdentity,
  parseConnectionDraft,
  sameConnectionDraft,
  sqlDraftIdentity,
  tableLabel,
  tableSchemaName,
} from '@/features/database/model/database-connections'
import { databaseBridge } from '@/features/database/api/database.bridge'

describe('database connection model', () => {
  it('costruisce draft e input SQLite con un nome utile', () => {
    expect(defaultConnectionDraft()).toEqual({ name: '', driver: 'sqlite', sqlitePath: '' })
    expect(connectionInput({ name: '', driver: 'sqlite', sqlitePath: '/tmp/demo.sqlite' })).toEqual({
      name: 'demo.sqlite',
      driver: 'sqlite',
      sqlitePath: '/tmp/demo.sqlite',
    })
    expect(defaultSql).toBe('SELECT 1 AS risultato')
  })

  it('applica le porte standard soltanto alle connessioni remote', () => {
    expect(defaultDatabasePort).toEqual({ postgres: 5432, mysql: 3306, mssql: 1433 })
    expect(connectionInput({ name: 'Dati', driver: 'postgres', host: 'db.internal', database: 'app', user: 'dev' })).toEqual({
      name: 'Dati',
      driver: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'app',
      user: 'dev',
      password: '',
    })
  })

  it('separa il segreto dal DTO pubblico quando ricrea un draft', () => {
    const connection: DatabaseConnection = {
      id: 'db-1',
      name: 'Produzione',
      driver: 'mysql',
      host: 'mysql.internal',
      port: 3307,
      database: 'catalogo',
      user: 'reader',
      hasPassword: true,
    }
    const draft = connectionDraftFor(connection)
    expect(draft).toMatchObject({ password: '', hasPassword: true })
    expect(sameConnectionDraft(draft, { ...draft })).toBe(true)
    expect(sameConnectionDraft(draft, { ...draft, port: 3308 })).toBe(false)
  })

  it('valida le bozze senza lanciare e rifiuta porte o driver non supportati', () => {
    expect(parseConnectionDraft('{"name":"Locale","driver":"sqlite","sqlitePath":"/tmp/db.sqlite"}')).toMatchObject({ name: 'Locale', driver: 'sqlite' })
    expect(parseConnectionDraft('{"name":"X","driver":"oracle"}')).toBeNull()
    expect(parseConnectionDraft('{"name":"X","driver":"postgres","port":70000}')).toBeNull()
    expect(parseConnectionDraft('{')).toBeNull()
  })
})

describe('database persistent identities and labels', () => {
  it('mantiene invariati scope e risorse delle bozze', () => {
    expect(sqlDraftIdentity('/workspace', null)).toEqual({ scope: 'database-sql', workspace: '/workspace', resource: 'unbound' })
    expect(connectionDraftIdentity('/workspace', null)).toEqual({ scope: 'database-connection', workspace: '/workspace', resource: 'new' })
    expect(gridDraftIdentity('/workspace', 'db-1', 'public.users')).toEqual({
      scope: 'database-grid',
      workspace: '/workspace',
      resource: '["db-1","public.users"]',
    })
  })

  it('presenta driver e nomi schema in modo coerente', () => {
    expect(['sqlite', 'postgres', 'mysql', 'mssql'].map((driver) => databaseDriverLabel(driver as DatabaseConnection['driver']))).toEqual(['SQLite', 'PostgreSQL', 'MySQL', 'SQL Server'])
    expect(tableSchemaName('public.users')).toBe('public')
    expect(tableSchemaName('users')).toBe('Tabelle')
    expect(tableLabel('public.users')).toBe('users')
  })
})

describe('database renderer bridge', () => {
  it('risolve il namespace soltanto al momento dell’uso', () => {
    const api = { listConnections: () => Promise.resolve([]) }
    Object.defineProperty(window, 'vincodeLab', {
      configurable: true,
      value: { database: api } as unknown as Window['vincodeLab'],
    })
    expect(databaseBridge.database).toBe(api)
  })
})
