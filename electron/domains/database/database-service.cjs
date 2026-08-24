const { createResultBudget, measureResultRows } = require('./database-result-budget.cjs')
const { createDatabaseSessionRegistry } = require('./database-session-registry.cjs')
const {
  mapRemoteRoutines,
  mapRemoteTables,
  normalizeSchemaPageOptions,
  remotePrimaryKeyQuery,
  remoteRoutineDefinitionQuery,
  remoteRoutinePageSql,
  remoteTableColumnsExactQuery,
  remoteTableColumnsPageSql,
  schemaPageCacheKey,
  uniqueRemoteTableIdentities,
} = require('./database-schema-model.cjs')
const {
  normalizeDatabaseError,
  sanitizeDatabaseDiagnostic,
  toDatabasePublicError,
} = require('./database-error-mapper.cjs')
const { createDatabaseSessionRuntime, openMssqlConnection } = require('./database-session-runtime.cjs')
const {
  buildDriverConfig,
  classifySql,
  isEditableColumn,
  makeTableSchema,
  normalizeAffectedRows,
  quoteIdentifier,
  quoteTableIdentifier,
  remoteParameterMarker,
  routineMetadataSql,
  sessionKey,
  tableFilterExpression,
  tablePageParameters,
  validateConnectionConfig,
} = require('./sql-model.cjs')
const {
  attachRemoteSessionLifecycle,
  createRemoteSessionLifecycleController,
  detachRemoteSessionLifecycle,
  disposeRemoteSession,
  forceCloseRemoteSession,
  raceRemoteSessionFailure,
} = require('./remote-session-lifecycle.cjs')
const schemaCache = new Map()
const SCHEMA_CACHE_PAGE_LIMIT = 8
const RESULT_ROW_LIMIT = 500
let databasePersistence = null

function configureDatabasePersistence(persistence) {
  if (!persistence || typeof persistence.getConnectionWithSecrets !== 'function' || typeof persistence.recordHistory !== 'function') {
    throw new TypeError('Persistenza database non valida.')
  }
  databasePersistence = Object.freeze({
    getConnectionWithSecrets: persistence.getConnectionWithSecrets,
    recordHistory: persistence.recordHistory,
  })
}

function getConnectionWithSecrets(...args) {
  if (!databasePersistence) throw new Error('Persistenza database non configurata.')
  return databasePersistence.getConnectionWithSecrets(...args)
}

function recordHistory(...args) {
  if (!databasePersistence) throw new Error('Persistenza database non configurata.')
  return databasePersistence.recordHistory(...args)
}

function invalidateWorkspaceSchema(workspacePath) {
  for (const key of schemaCache.keys()) {
    if (key.startsWith(`${workspacePath}\u0000`)) schemaCache.delete(key)
  }
}

const {
  closeConnectionSession,
  closeWorkspaceSessions,
  configureRuntime: configureDatabaseRuntime,
  getSession,
  requestSqlite,
  sqliteWorkerDiagnostics,
} = createDatabaseSessionRuntime({
  getConnectionWithSecrets,
  invalidateSchema: (key) => schemaCache.delete(key),
  invalidateWorkspaceSchema,
})

async function openConnection(workspacePath, connectionId) {
  await getSession(workspacePath, connectionId)
  return { connected: true }
}

async function readTableRows(workspacePath, connectionId, tableName, options = {}) {
  const session = await getSession(workspacePath, connectionId)
  const table = await inspectTableSchema(workspacePath, connectionId, session, tableName)
  if (!table) throw new Error('Tabella non disponibile nello schema.')
  const limit = Number.isInteger(options.limit) ? options.limit : 100
  const offset = Number.isInteger(options.offset) ? options.offset : 0
  if (limit < 1 || limit > 500 || offset < 0) throw new Error('Paginazione tabella non valida.')
  const filter = typeof options.filter === 'string' ? options.filter.trim() : ''
  const driver = session.driver ?? 'sqlite'
  const textColumns = table.columns.filter((column) => /char|text|clob|varchar|nchar/iu.test(String(column.type))).map((column) => quoteIdentifier(driver, column.name))
  const parameters = filter && textColumns.length ? textColumns.map(() => `%${filter}%`) : []
  const where = filter && textColumns.length
    ? ` WHERE ${textColumns.map((column, index) => tableFilterExpression(driver, column, driver === 'sqlite' ? '?' : remoteParameterMarker(driver, index))).join(' OR ')}`
    : ''
  const startedAt = Date.now()
  let rows
  let workerHasMore = false
  if (driver === 'sqlite') {
    ;({ rows, hasMore: workerHasMore = false } = await requestSqlite(session, 'all', {
      sql: `SELECT * FROM ${quoteTableIdentifier(driver, tableName)}${where} LIMIT ? OFFSET ?`,
      parameters: [...parameters, limit + 1, offset],
      budgetRowLimit: limit,
    }))
  } else {
    const paginationStart = parameters.length
    const query = driver === 'mssql'
      ? `SELECT * FROM ${quoteTableIdentifier(driver, tableName)}${where} ORDER BY (SELECT NULL) OFFSET ${remoteParameterMarker(driver, paginationStart)} ROWS FETCH NEXT ${remoteParameterMarker(driver, paginationStart + 1)} ROWS ONLY`
      : `SELECT * FROM ${quoteTableIdentifier(driver, tableName)}${where} LIMIT ${remoteParameterMarker(driver, paginationStart)} OFFSET ${remoteParameterMarker(driver, paginationStart + 1)}`
    ;({ rows } = await executeRemote(session, query, [...parameters, ...tablePageParameters(driver, limit, offset)]))
  }
  const resultRows = rows.slice(0, limit)
  const resultBytes = measureResultRows(resultRows)
  return { table, rows: resultRows, offset, hasMore: workerHasMore || rows.length > limit, durationMs: Date.now() - startedAt, resultBytes, readOnlyReason: table.primaryKey.length ? undefined : 'Sola lettura: manca una chiave primaria.' }
}

async function updateTableRows(workspacePath, connectionId, tableName, changes) {
  const session = await getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Transazione attiva richiesta per salvare le modifiche.')
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('Modifiche tabella non valide.')
  const table = await inspectTableSchema(workspacePath, connectionId, session, tableName)
  if (!table?.primaryKey.length) throw new Error('Tabella non modificabile senza chiave primaria.')
  const driver = session.driver ?? 'sqlite'
  const updates = changes.map((change) => {
    const values = change?.values ?? {}; const key = change?.key ?? {}
    const columns = Object.keys(values)
    if (!columns.length || columns.some((name) => !table.columns.find((column) => column.name === name)?.editable) || table.primaryKey.some((name) => !(name in key))) throw new Error('Modifica tabella non valida.')
    const parameters = [...columns.map((name) => values[name]), ...table.primaryKey.map((name) => key[name])]
    const set = columns.map((name, index) => `${quoteIdentifier(driver, name)} = ${driver === 'sqlite' ? '?' : remoteParameterMarker(driver, index)}`).join(', ')
    const where = table.primaryKey.map((name, index) => `${quoteIdentifier(driver, name)} = ${driver === 'sqlite' ? '?' : remoteParameterMarker(driver, columns.length + index)}`).join(' AND ')
    return { sql: `UPDATE ${quoteTableIdentifier(driver, tableName)} SET ${set} WHERE ${where}`, parameters }
  })
  if (driver === 'sqlite') {
    await requestSqlite(session, 'updateRows', { updates })
    schemaCache.delete(sessionKey(workspacePath, connectionId))
    return { updated: changes.length }
  }
  const savepoint = 'vincodelab_table_update'
  await executeRemote(session, session.driver === 'mssql' ? `SAVE TRANSACTION ${savepoint}` : `SAVEPOINT ${savepoint}`)
  try {
    for (const update of updates) {
      const affectedRows = (await executeRemote(session, update.sql, update.parameters)).affectedRows
      if (affectedRows !== 1) throw new Error('La riga è cambiata o non è più disponibile.')
    }
  } catch (error) {
    await executeRemote(session, session.driver === 'mssql' ? `ROLLBACK TRANSACTION ${savepoint}` : `ROLLBACK TO SAVEPOINT ${savepoint}`)
    throw error
  }
  if (session.driver !== 'mssql') await executeRemote(session, `RELEASE SAVEPOINT ${savepoint}`)
  schemaCache.delete(sessionKey(workspacePath, connectionId))
  return { updated: changes.length }
}

function safeQueryErrorMessage(error) {
  return normalizeDatabaseError(error, { phase: 'query' }).message
}

function enqueueRemoteOperation(session, operation) {
  const previous = session.remoteOperationQueue ?? Promise.resolve()
  const execution = previous.catch(() => {
    // Il failure precedente è già stato restituito al suo chiamante; la coda della
    // connessione viene guarita per consentire una nuova query o recovery.
  }).then(operation)
  // La coda deve restare utilizzabile anche se una singola richiesta fallisce.
  // Il chiamante riceve comunque il rigetto originale tramite `execution`.
  session.remoteOperationQueue = execution.then(() => undefined, () => undefined)
  return execution
}

function runMssqlTransactionOperation(session, operation) {
  const method = {
    begin: 'beginTransaction',
    commit: 'commitTransaction',
    rollback: 'rollbackTransaction',
  }[operation]
  if (session?.driver !== 'mssql' || !method || typeof session.client?.[method] !== 'function') throw new Error('Operazione transazionale SQL Server non valida.')
  // Tedious deve aggiornare il proprio transaction descriptor: inviare BEGIN
  // come normale query lascia il driver fuori sincronia con SQL Server.
  return enqueueRemoteOperation(session, () => raceRemoteSessionFailure(session, new Promise((resolve, reject) => {
    session.client[method]((error) => error ? reject(error) : resolve())
  }))).catch((error) => { throw toDatabasePublicError(error, { phase: 'query' }) })
}

function abortError() {
  const error = new Error('database_query_cancelled')
  error.name = 'AbortError'
  return error
}

function resultCollector(options) {
  return createResultBudget(options?.resultBudget)
}

function executePostgres(session, sql, parameters, timeoutMs, options) {
  return new Promise((resolve, reject) => {
    const collector = resultCollector(options)
    const Query = session.Query ?? require('pg').Query
    const query = new Query({ text: sql, values: parameters })
    query.query_timeout = timeoutMs
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({
        rows: collector.rows,
        affectedRows: typeof result?.rowCount === 'number' && result.command !== 'SELECT' ? result.rowCount : null,
      })
    }
    const failAndClose = (error) => {
      finish(error)
      forceCloseRemoteSession(session)
    }
    const onAbort = () => failAndClose(abortError())
    query.on('row', (row) => {
      if (settled) return
      try { collector.add(row) } catch (error) { failAndClose(error) }
    })
    query.on('error', (error) => finish(error))
    query.on('end', (result) => finish(undefined, Array.isArray(result) ? result.at(-1) : result))
    if (options.signal?.aborted) return onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try { session.client.query(query) } catch (error) { finish(error) }
  })
}

function executeMysql(session, sql, parameters, timeoutMs, options) {
  return new Promise((resolve, reject) => {
    const collector = resultCollector(options)
    let affectedRows = null
    let hasFields = false
    let settled = false
    let command
    const finish = (error) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({ rows: collector.rows, affectedRows })
    }
    const failAndClose = (error) => {
      finish(error)
      forceCloseRemoteSession(session)
    }
    const onAbort = () => failAndClose(abortError())
    if (options.signal?.aborted) return onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const rawClient = session.client.connection ?? session.client
      command = rawClient.query({ sql, values: parameters, timeout: timeoutMs })
      command.on('fields', () => { hasFields = true })
      command.on('result', (row) => {
        if (settled) return
        if (!hasFields && !Array.isArray(row) && Number.isFinite(row?.affectedRows)) {
          affectedRows = row.affectedRows
          return
        }
        try { collector.add(row) } catch (error) { failAndClose(error) }
      })
      command.on('error', (error) => finish(error))
      command.on('end', () => finish())
    } catch (error) {
      finish(error)
    }
  })
}

function executeMssql(session, sql, parameters, timeoutMs, options) {
  return new Promise((resolve, reject) => {
    const collector = resultCollector(options)
    let affectedRows = null
    let settled = false
    let request
    const Request = session.Request ?? require('tedious').Request
    const TYPES = session.TYPES ?? require('tedious').TYPES
    const finish = (error, count) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve({ rows: collector.rows, affectedRows: count ?? affectedRows })
    }
    const cancelAndFail = (error) => {
      try { request?.cancel?.() } catch {
        // La richiesta sta già terminando con `error`: il cancel è best effort e
        // non deve mascherare la causa che verrà classificata per il renderer.
      }
      finish(error)
    }
    const onAbort = () => cancelAndFail(abortError())
    request = new Request(sql, (error, count) => finish(error, count))
    if (typeof request.setTimeout === 'function') request.setTimeout(timeoutMs)
    parameters.forEach((value, index) => {
      const type = typeof value === 'boolean' ? TYPES.Bit : typeof value === 'number' ? (Number.isInteger(value) ? TYPES.Int : TYPES.Float) : TYPES.NVarChar
      request.addParameter(`p${index}`, type, value)
    })
    request.on('row', (columns) => {
      if (settled) return
      try { collector.add(Object.fromEntries(columns.map((column) => [column.metadata.colName, column.value]))) } catch (error) { cancelAndFail(error) }
    })
    request.on('doneInProc', (count) => { affectedRows = count })
    if (options.signal?.aborted) return onAbort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try { session.client.execSql(request) } catch (error) { finish(error) }
  })
}

function executeRemote(session, sql, parameters = [], timeoutMs = 30_000, options = {}) {
  return enqueueRemoteOperation(session, () => {
    if (options.signal?.aborted) throw abortError()
    const operation = session.driver === 'postgres'
      ? executePostgres(session, sql, parameters, timeoutMs, options)
      : session.driver === 'mysql'
        ? executeMysql(session, sql, parameters, timeoutMs, options)
        : executeMssql(session, sql, parameters, timeoutMs, options)
    return raceRemoteSessionFailure(session, operation)
  }).catch((error) => { throw toDatabasePublicError(error, { phase: 'query' }) })
}

function limitReadSql(sql, offset, keyword, rowLimit = RESULT_ROW_LIMIT) {
  const statement = sql.trim().replace(/;$/u, '')
  // LIMIT può essere aggiunto solo a query tabellari: PRAGMA e comandi di
  // diagnostica restano validi e sono comunque troncati nel DTO renderer.
  if (!['SELECT', 'WITH', 'EXPLAIN'].includes(keyword)) return statement
  if (/\blimit\s+\d+/iu.test(statement)) return `SELECT * FROM (${statement}) AS vincodelab_page LIMIT ${rowLimit + 1} OFFSET ${offset}`
  return `${statement} LIMIT ${rowLimit + 1} OFFSET ${offset}`
}

function limitRemoteReadSql(sql, offset, keyword, driver, rowLimit = RESULT_ROW_LIMIT) {
  const statement = sql.trim().replace(/;$/u, '')
  if (!['SELECT', 'WITH', 'EXPLAIN'].includes(keyword)) return statement
  if (driver === 'mssql') return `SELECT * FROM (${statement}) AS vincodelab_page ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${rowLimit + 1} ROWS ONLY`
  return `SELECT * FROM (${statement}) AS vincodelab_page LIMIT ${rowLimit + 1} OFFSET ${offset}`
}

function recordQueryHistoryOutcome(workspacePath, entry, writeHistory = recordHistory) {
  try {
    writeHistory(workspacePath, entry)
    return true
  } catch {
    // La query è già conclusa: una failure della cronologia è degradata e non
    // deve trasformare il successo in un errore che invita a rieseguirla.
    return false
  }
}

async function executeQuery(workspacePath, connectionId, sql, options = {}) {
  const classification = classifySql(sql)
  if (classification.mutative && !options.confirmed) throw new Error('Conferma richiesta per la query mutativa.')
  if (!Number.isInteger(options.offset ?? 0) || (options.offset ?? 0) < 0) throw new Error('Offset risultati non valido.')
  const rowLimit = options.limit ?? RESULT_ROW_LIMIT
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 5_000) throw new Error('Limite risultati non valido.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error('Timeout query non valido.')
  const startedAt = Date.now()
  const session = await getSession(workspacePath, connectionId)
  try {
    let rows = []
    let affectedRows = null
    let workerHasMore = false
    if (session.driver === 'sqlite') {
      ;({ rows, affectedRows, hasMore: workerHasMore = false } = await requestSqlite(session, 'execute', {
        sql: classification.mutative ? sql : limitReadSql(sql, options.offset ?? 0, classification.keyword, rowLimit),
        budgetRowLimit: rowLimit,
      }, { signal: options.signal, timeoutMs }))
    } else ({ rows, affectedRows } = await executeRemote(session, classification.mutative ? sql : limitRemoteReadSql(sql, options.offset ?? 0, classification.keyword, session.driver, rowLimit), [], timeoutMs, { signal: options.signal }))
    const hasMore = workerHasMore || rows.length > rowLimit
    const resultRows = rows.slice(0, rowLimit)
    const result = { columns: rows[0] ? Object.keys(rows[0]) : [], rows: resultRows, affectedRows: normalizeAffectedRows(affectedRows, classification.mutative), durationMs: Date.now() - startedAt, hasMore, resultBytes: measureResultRows(resultRows) }
    const historyRecorded = recordQueryHistoryOutcome(workspacePath, { connectionId, sql, durationMs: result.durationMs, affectedRows })
    if (classification.mutative) schemaCache.delete(sessionKey(workspacePath, connectionId))
    return { ...result, historyRecorded }
  } catch (error) {
    // Un errore del driver può lasciare una connessione remota in stato
    // incoerente; chiuderla forza una nuova sessione pulita alla prossima query.
    const closing = closeConnectionSession(workspacePath, connectionId, { clearFailure: false })
    if (session.driver === 'sqlite') await closing
    else void closing.catch(() => {
      // La query restituisce il proprio errore classificato; il registry conserva
      // la sessione remota per un successivo cleanup/retry senza creare un secondo failure.
    })
    throw toDatabasePublicError(error, { phase: 'query' })
  }
}

async function beginTransaction(workspacePath, connectionId) {
  const session = await getSession(workspacePath, connectionId)
  if (session.transactionActive) throw new Error('Una transazione è già attiva.')
  if (session.driver === 'sqlite') await requestSqlite(session, 'exec', { sql: 'BEGIN' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'begin')
  else await executeRemote(session, 'BEGIN')
  session.transactionActive = true
  return { active: true }
}

async function commitTransaction(workspacePath, connectionId) {
  const session = await getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await requestSqlite(session, 'exec', { sql: 'COMMIT' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'commit')
  else await executeRemote(session, 'COMMIT')
  session.transactionActive = false
  return { active: false }
}

async function rollbackTransaction(workspacePath, connectionId) {
  const session = await getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await requestSqlite(session, 'exec', { sql: 'ROLLBACK' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'rollback')
  else await executeRemote(session, 'ROLLBACK')
  session.transactionActive = false
  return { active: false }
}

function makeSqliteTableSchema({ name, columns }) {
  return makeTableSchema(name, columns.map((column) => ({
    name: column.name,
    type: column.type,
    nullable: column.notnull === 0,
    primaryKeyPosition: column.pk,
  })))
}

function findCachedTable(key, tableName) {
  const pages = schemaCache.get(key)
  if (!pages) return null
  for (const page of pages.values()) {
    const table = page.tables.find((item) => item.name === tableName)
    if (table) return table
  }
  return null
}

async function inspectTableSchema(workspacePath, connectionId, session, tableName) {
  const key = sessionKey(workspacePath, connectionId)
  const cached = findCachedTable(key, tableName)
  if (cached) return cached
  if (session.driver === 'sqlite') {
    const { table } = await requestSqlite(session, 'inspectTableSchema', { tableName })
    return table ? makeSqliteTableSchema(table) : null
  }
  const columnsQuery = remoteTableColumnsExactQuery(session.driver, tableName)
  const { rows: columnRows } = await executeRemote(session, columnsQuery.sql, columnsQuery.parameters)
  const identities = uniqueRemoteTableIdentities(columnRows, 1)
  const primaryKeyQuery = remotePrimaryKeyQuery(session.driver, identities)
  const { rows: primaryKeyRows } = primaryKeyQuery
    ? await executeRemote(session, primaryKeyQuery.sql, primaryKeyQuery.parameters)
    : { rows: [] }
  return mapRemoteTables(columnRows, primaryKeyRows, 1)[0] ?? null
}

async function inspectRoutine(workspacePath, connectionId, routineName, kind) {
  const session = await getSession(workspacePath, connectionId)
  if (session.driver === 'sqlite') return { name: routineName, kind, definition: null, definitionTruncated: false }
  const query = remoteRoutineDefinitionQuery(session.driver, routineName, kind)
  const { rows } = await executeRemote(session, query.sql, query.parameters)
  const row = rows[0]
  return {
    name: routineName,
    kind,
    definition: row?.definition ?? row?.DEFINITION ?? null,
    definitionTruncated: Boolean(row?.definition_truncated ?? row?.DEFINITION_TRUNCATED),
  }
}

async function inspectRemoteSchemaPage(session, { offset, limit }) {
  // Ogni query carica al massimo una pagina più una risorsa sentinella. In
  // particolare colonne e definizioni non vengono materializzate per l'intero DB.
  const { rows: columnRows } = await executeRemote(session, remoteTableColumnsPageSql(session.driver, { offset, limit }))
  const identities = uniqueRemoteTableIdentities(columnRows, limit)
  const tableHasMore = uniqueRemoteTableIdentities(columnRows, limit + 1).length > limit
  const primaryKeyQuery = remotePrimaryKeyQuery(session.driver, identities)
  const { rows: primaryKeyRows } = primaryKeyQuery
    ? await executeRemote(session, primaryKeyQuery.sql, primaryKeyQuery.parameters)
    : { rows: [] }
  const tables = mapRemoteTables(columnRows, primaryKeyRows, limit)

  const routineSql = remoteRoutinePageSql(session.driver, { offset, limit })
  const { rows: routineRows } = routineSql ? await executeRemote(session, routineSql) : { rows: [] }
  const routineHasMore = routineRows.length > limit
  const routines = mapRemoteRoutines(routineRows, limit)
  const hasMore = tableHasMore || routineHasMore
  return { tables, routines, hasMore, nextOffset: hasMore ? offset + limit : null }
}

async function inspectSchema(workspacePath, connectionId, options = {}) {
  const pageOptions = normalizeSchemaPageOptions(options)
  const key = sessionKey(workspacePath, connectionId)
  if (pageOptions.force) schemaCache.delete(key)
  const pageKey = schemaPageCacheKey(pageOptions)
  const cached = schemaCache.get(key)?.get(pageKey)
  if (cached) return cached

  const session = await getSession(workspacePath, connectionId)
  let schema
  if (session.driver === 'sqlite') {
    const rawSchema = await requestSqlite(session, 'inspectSchema', pageOptions)
    schema = {
      tables: rawSchema.tables.map(makeSqliteTableSchema),
      routines: [],
      hasMore: rawSchema.hasMore,
      nextOffset: rawSchema.hasMore ? pageOptions.offset + pageOptions.limit : null,
    }
  } else {
    schema = await inspectRemoteSchemaPage(session, pageOptions)
  }
  let pages = schemaCache.get(key)
  if (!pages) {
    pages = new Map()
    schemaCache.set(key, pages)
  }
  pages.set(pageKey, schema)
  while (pages.size > SCHEMA_CACHE_PAGE_LIMIT) pages.delete(pages.keys().next().value)
  return schema
}

module.exports = { attachRemoteSessionLifecycle, beginTransaction, buildDriverConfig, classifySql, closeConnectionSession, closeWorkspaceSessions, commitTransaction, configureDatabasePersistence, configureDatabaseRuntime, createDatabaseSessionRegistry, createRemoteSessionLifecycleController, detachRemoteSessionLifecycle, disposeRemoteSession, enqueueRemoteOperation, executeQuery, executeRemote, forceCloseRemoteSession, inspectRoutine, inspectSchema, isEditableColumn, limitRemoteReadSql, makeTableSchema, measureResultRows, normalizeAffectedRows, normalizeDatabaseError, openConnection, openMssqlConnection, readTableRows, recordQueryHistoryOutcome, rollbackTransaction, routineMetadataSql, runMssqlTransactionOperation, safeQueryErrorMessage, sanitizeDatabaseDiagnostic, sqliteWorkerDiagnostics, tablePageParameters, toDatabasePublicError, updateTableRows, validateConnectionConfig }
