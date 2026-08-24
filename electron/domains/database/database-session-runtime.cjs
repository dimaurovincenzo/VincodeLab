const { createPublicError } = require('../errors/public-error.cjs')
const { sqliteInfrastructurePublicError, toDatabasePublicError } = require('./database-error-mapper.cjs')
const { buildDriverConfig, sessionKey } = require('./sql-model.cjs')
const { createRemoteSessionLifecycleController, remoteSessions } = require('./remote-session-lifecycle.cjs')

function openMssqlConnection(config, Connection, onInstance = () => undefined) {
  return new Promise((resolve, reject) => {
    const instance = new Connection(config)
    onInstance(instance)
    const cleanup = () => {
      instance.removeListener?.('connect', onConnect)
      instance.removeListener?.('end', onEnd)
      instance.removeListener?.('error', onError)
    }
    const onConnect = (error) => {
      cleanup()
      if (error) reject(error)
      else resolve(instance)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('Connessione SQL Server chiusa durante l’apertura.'))
    }
    instance.once('connect', onConnect)
    instance.once('end', onEnd)
    instance.once('error', onError)
    // tedious costruisce solo l'oggetto Connection: il socket viene aperto
    // esclusivamente con connect(). Senza questa chiamata l'UI resta in attesa.
    instance.connect()
  })
}

function createDatabaseSessionRuntime({
  getConnectionWithSecrets,
  invalidateSchema,
  invalidateWorkspaceSchema,
} = {}) {
  if (typeof getConnectionWithSecrets !== 'function') throw new TypeError('Porta connessioni database non valida.')
  if (typeof invalidateSchema !== 'function') throw new TypeError('Invalidazione schema database non valida.')
  if (typeof invalidateWorkspaceSchema !== 'function') throw new TypeError('Invalidazione schema workspace non valida.')

  const sqliteSessions = new Map()
  let sqliteRuntime = null
  const remoteSessionLifecycle = createRemoteSessionLifecycleController({
    closeSession: (key) => remoteSessions.close(key),
    invalidateSchema,
  })

  function configureRuntime(runtime) {
    if (!runtime || typeof runtime.createSqliteWorkerSession !== 'function' || typeof runtime.sqliteWorkerDiagnostics !== 'function') {
      throw new TypeError('Runtime database non valido.')
    }
    sqliteRuntime = Object.freeze({
      createSqliteWorkerSession: runtime.createSqliteWorkerSession,
      sqliteWorkerDiagnostics: runtime.sqliteWorkerDiagnostics,
    })
  }

  function createSqliteWorkerSession(...args) {
    if (!sqliteRuntime) throw new Error('Runtime database non configurato.')
    return sqliteRuntime.createSqliteWorkerSession(...args)
  }

  function sqliteWorkerDiagnostics() {
    if (!sqliteRuntime) return { activeWorkers: 0, pendingRequests: 0 }
    return sqliteRuntime.sqliteWorkerDiagnostics()
  }

  async function requestSqlite(session, operation, payload, options) {
    try {
      return await session.sqlite.request(operation, payload, options)
    } catch (error) {
      // Solo i failure infrastrutturali ricevono copy pubblico qui; sintassi,
      // vincoli e conflitti continuano a seguire il normale owner dell'operazione.
      throw sqliteInfrastructurePublicError(error) ?? error
    }
  }

  async function getSqliteSession(workspacePath, connectionId) {
    const key = sessionKey(workspacePath, connectionId)
    const existing = sqliteSessions.get(key)
    if (existing) {
      await existing.ready
      return existing
    }
    const connection = getConnectionWithSecrets(workspacePath, connectionId)
    if (!connection) throw new Error('Connessione del workspace non trovata.')
    if (connection.driver !== 'sqlite') throw new Error('Driver database non ancora disponibile.')
    const session = { driver: 'sqlite', connection, sqlite: null, ready: null }
    session.sqlite = createSqliteWorkerSession(connection.sqlitePath, () => {
      if (sqliteSessions.get(key) === session) sqliteSessions.delete(key)
      invalidateSchema(key)
    })
    session.ready = session.sqlite.ready()
    sqliteSessions.set(key, session)
    try {
      await session.ready
      return session
    } catch (error) {
      await session.sqlite.close(error)
      throw sqliteInfrastructurePublicError(error, { phase: 'connection' }) ?? error
    }
  }

  async function getSession(workspacePath, connectionId) {
    const key = sessionKey(workspacePath, connectionId)
    const previousFailure = remoteSessionLifecycle.consumeFailure(key)
    if (previousFailure) throw previousFailure
    const existing = sqliteSessions.get(key)
    if (existing) {
      await existing.ready
      return existing
    }
    const connection = getConnectionWithSecrets(workspacePath, connectionId)
    if (!connection) throw createPublicError('DATABASE_CONNECTION_NOT_FOUND', 'La connessione database non è più disponibile.')
    if (connection.driver === 'sqlite') return getSqliteSession(workspacePath, connectionId)
    try {
      const session = await remoteSessions.acquire(key, async ({ setCandidate }) => {
        const config = buildDriverConfig(connection)
        if (connection.driver === 'postgres') {
          // Una sola connessione per sessione preserva la transazione tra le azioni
          // della griglia; un Pool potrebbe eseguire BEGIN e UPDATE su socket diversi.
          const { Client, Query } = require('pg')
          const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, connectionTimeoutMillis: 10_000, query_timeout: 30_000 })
          const candidate = { driver: 'postgres', connection, client, Query }
          setCandidate(candidate)
          remoteSessionLifecycle.track(key, candidate)
          await client.connect()
          return candidate
        }
        if (connection.driver === 'mysql') {
          const mysql = require('mysql2/promise')
          const client = await mysql.createConnection({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, connectTimeout: 10_000 })
          const candidate = { driver: 'mysql', connection, client }
          setCandidate(candidate)
          remoteSessionLifecycle.track(key, candidate)
          return candidate
        }
        const { Connection, Request, TYPES } = require('tedious')
        let candidate
        const client = await openMssqlConnection({ server: config.host, authentication: { type: 'default', options: { userName: config.user, password: config.password } }, options: { port: config.port, database: config.database, connectTimeout: 10_000, requestTimeout: 30_000, trustServerCertificate: true } }, Connection, (instance) => {
          candidate = { driver: 'mssql', connection, client: instance, Request, TYPES }
          setCandidate(candidate)
          remoteSessionLifecycle.track(key, candidate)
        })
        return candidate ?? { driver: 'mssql', connection, client, Request, TYPES }
      })
      const openingFailure = remoteSessionLifecycle.consumeFailure(key)
      if (openingFailure) throw openingFailure
      return session
    } catch (error) {
      remoteSessionLifecycle.prepareClose(key, { clearFailure: false })
      throw remoteSessionLifecycle.consumeFailure(key) ?? toDatabasePublicError(error, { phase: 'connection' })
    }
  }

  function closeWorkspaceSessions(workspacePath) {
    const closing = []
    for (const [key, session] of sqliteSessions) {
      if (!key.startsWith(`${workspacePath}\u0000`)) continue
      closing.push(session.sqlite.close())
      sqliteSessions.delete(key)
      invalidateSchema(key)
    }
    invalidateWorkspaceSchema(workspacePath)
    const matchesWorkspace = (key) => key.startsWith(`${workspacePath}\u0000`)
    remoteSessionLifecycle.prepareCloseMatching(matchesWorkspace)
    closing.push(remoteSessions.closeMatching(matchesWorkspace))
    return Promise.allSettled(closing)
  }

  function closeConnectionSession(workspacePath, connectionId, { clearFailure = true } = {}) {
    const key = sessionKey(workspacePath, connectionId)
    const session = sqliteSessions.get(key)
    sqliteSessions.delete(key)
    invalidateSchema(key)
    remoteSessionLifecycle.prepareClose(key, { clearFailure })
    return Promise.allSettled([
      session?.sqlite.close(),
      remoteSessions.close(key),
    ])
  }

  return {
    closeConnectionSession,
    closeWorkspaceSessions,
    configureRuntime,
    getSession,
    requestSqlite,
    sqliteWorkerDiagnostics,
  }
}

module.exports = { createDatabaseSessionRuntime, openMssqlConnection }
