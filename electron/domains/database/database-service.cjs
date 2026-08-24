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
  remoteTableIdentityPageSql,
  schemaPageCacheKey,
  uniqueRemoteTableIdentities,
} = require('./database-schema-model.cjs')
const {
  normalizeDatabaseError,
  sanitizeDatabaseDiagnostic,
  toDatabasePublicError,
} = require('./database-error-mapper.cjs')
const { createDatabaseSessionRuntime } = require('./database-session-runtime.cjs')
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
  invalidateRemoteSession,
  raceRemoteSessionFailure,
} = require('./remote-session-lifecycle.cjs')
const SCHEMA_CACHE_PAGE_LIMIT = 8
const RESULT_ROW_LIMIT = 500

function createDatabaseService({
  createSqliteWorkerSession,
  driverPort,
  getConnectionWithSecrets,
  recordHistory,
  sqliteWorkerDiagnostics,
} = {}) {
  if (typeof getConnectionWithSecrets !== 'function' || typeof recordHistory !== 'function') {
    throw new TypeError('Persistenza database non valida.')
  }

  const schemaCache = new Map()
  const invalidateWorkspaceSchema = (workspacePath) => {
    for (const key of schemaCache.keys()) {
      if (key.startsWith(`${workspacePath}\u0000`)) schemaCache.delete(key)
    }
  }
  const runtime = createDatabaseSessionRuntime({
    createSqliteWorkerSession,
    driverPort,
    getConnectionWithSecrets,
    invalidateSchema: (key) => schemaCache.delete(key),
    invalidateWorkspaceSchema,
    sqliteWorkerDiagnostics,
  })
  const state = Object.freeze({
    ...runtime,
    recordHistory,
    schemaCache,
  })

  return Object.freeze({
    beginTransaction: (...args) => beginTransaction(state, ...args),
    closeConnectionSession: runtime.closeConnectionSession,
    closeWorkspaceSessions: runtime.closeWorkspaceSessions,
    commitTransaction: (...args) => commitTransaction(state, ...args),
    executeQuery: (...args) => executeQuery(state, ...args),
    inspectRoutine: (...args) => inspectRoutine(state, ...args),
    inspectSchema: (...args) => inspectSchema(state, ...args),
    openConnection: (...args) => openConnection(state, ...args),
    readTableRows: (...args) => readTableRows(state, ...args),
    rollbackTransaction: (...args) => rollbackTransaction(state, ...args),
    sqliteWorkerDiagnostics: runtime.sqliteWorkerDiagnostics,
    updateTableRows: (...args) => updateTableRows(state, ...args),
  })
}

async function openConnection(state, workspacePath, connectionId) {
  await state.getSession(workspacePath, connectionId)
  return { connected: true }
}

async function readTableRows(state, workspacePath, connectionId, tableName, options = {}) {
  const session = await state.getSession(workspacePath, connectionId)
  const table = await inspectTableSchema(state, workspacePath, connectionId, session, tableName)
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
    ;({ rows, hasMore: workerHasMore = false } = await state.requestSqlite(session, 'all', {
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

async function updateTableRows(state, workspacePath, connectionId, tableName, changes) {
  const session = await state.getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Transazione attiva richiesta per salvare le modifiche.')
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('Modifiche tabella non valide.')
  const table = await inspectTableSchema(state, workspacePath, connectionId, session, tableName)
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
    await state.requestSqlite(session, 'updateRows', { updates })
    state.schemaCache.delete(sessionKey(workspacePath, connectionId))
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
  state.schemaCache.delete(sessionKey(workspacePath, connectionId))
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

function abortError() {
  const error = new Error('database_query_cancelled')
  error.name = 'AbortError'
  return error
}

function resultCollector(options) {
  return createResultBudget(options?.resultBudget)
}

function executeRemote(session, sql, parameters = [], timeoutMs = 30_000, options = {}) {
  return enqueueRemoteOperation(session, () => {
    if (options.signal?.aborted) throw abortError()
    if (typeof session?.driverPort?.executeRemote !== 'function') throw new TypeError('Porta esecuzione database remota non disponibile.')
    const collector = resultCollector(options)
    const operation = session.driverPort.executeRemote(session.handle, {
      sql,
      parameters,
      timeoutMs,
      signal: options.signal,
      onRow: (row) => collector.add(row),
      onInvalidate: (error) => invalidateRemoteSession(session, error),
    }).then(({ affectedRows }) => ({ rows: collector.rows, affectedRows }))
    return raceRemoteSessionFailure(session, operation)
  }).catch((error) => { throw toDatabasePublicError(error, { phase: 'query' }) })
}

function executeRemoteTransaction(session, operation) {
  return enqueueRemoteOperation(session, () => {
    if (typeof session?.driverPort?.executeTransaction !== 'function') throw new TypeError('Porta transazioni database remote non disponibile.')
    return raceRemoteSessionFailure(session, session.driverPort.executeTransaction(session.handle, operation))
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

function recordQueryHistoryOutcome(workspacePath, entry, writeHistory) {
  try {
    writeHistory(workspacePath, entry)
    return true
  } catch {
    // La query è già conclusa: una failure della cronologia è degradata e non
    // deve trasformare il successo in un errore che invita a rieseguirla.
    return false
  }
}

async function executeQuery(state, workspacePath, connectionId, sql, options = {}) {
  const classification = classifySql(sql)
  if (classification.mutative && !options.confirmed) throw new Error('Conferma richiesta per la query mutativa.')
  if (!Number.isInteger(options.offset ?? 0) || (options.offset ?? 0) < 0) throw new Error('Offset risultati non valido.')
  const rowLimit = options.limit ?? RESULT_ROW_LIMIT
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 5_000) throw new Error('Limite risultati non valido.')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) throw new Error('Timeout query non valido.')
  const startedAt = Date.now()
  const session = await state.getSession(workspacePath, connectionId)
  try {
    let rows = []
    let affectedRows = null
    let workerHasMore = false
    if (session.driver === 'sqlite') {
      ;({ rows, affectedRows, hasMore: workerHasMore = false } = await state.requestSqlite(session, 'execute', {
        sql: classification.mutative ? sql : limitReadSql(sql, options.offset ?? 0, classification.keyword, rowLimit),
        budgetRowLimit: rowLimit,
      }, { signal: options.signal, timeoutMs }))
    } else ({ rows, affectedRows } = await executeRemote(session, classification.mutative ? sql : limitRemoteReadSql(sql, options.offset ?? 0, classification.keyword, session.driver, rowLimit), [], timeoutMs, { signal: options.signal }))
    const hasMore = workerHasMore || rows.length > rowLimit
    const resultRows = rows.slice(0, rowLimit)
    const result = { columns: rows[0] ? Object.keys(rows[0]) : [], rows: resultRows, affectedRows: normalizeAffectedRows(affectedRows, classification.mutative), durationMs: Date.now() - startedAt, hasMore, resultBytes: measureResultRows(resultRows) }
    const historyRecorded = recordQueryHistoryOutcome(workspacePath, { connectionId, sql, durationMs: result.durationMs, affectedRows }, state.recordHistory)
    if (classification.mutative) state.schemaCache.delete(sessionKey(workspacePath, connectionId))
    return { ...result, historyRecorded }
  } catch (error) {
    // Un errore del driver può lasciare una connessione remota in stato
    // incoerente; chiuderla forza una nuova sessione pulita alla prossima query.
    const closing = state.closeConnectionSession(workspacePath, connectionId, { clearFailure: false })
    if (session.driver === 'sqlite') await closing
    else void closing.catch(() => {
      // La query restituisce il proprio errore classificato; il registry conserva
      // la sessione remota per un successivo cleanup/retry senza creare un secondo failure.
    })
    throw toDatabasePublicError(error, { phase: 'query' })
  }
}

async function beginTransaction(state, workspacePath, connectionId) {
  const session = await state.getSession(workspacePath, connectionId)
  if (session.transactionActive) throw new Error('Una transazione è già attiva.')
  if (session.driver === 'sqlite') await state.requestSqlite(session, 'exec', { sql: 'BEGIN' })
  else await executeRemoteTransaction(session, 'begin')
  session.transactionActive = true
  return { active: true }
}

async function commitTransaction(state, workspacePath, connectionId) {
  const session = await state.getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await state.requestSqlite(session, 'exec', { sql: 'COMMIT' })
  else await executeRemoteTransaction(session, 'commit')
  session.transactionActive = false
  return { active: false }
}

async function rollbackTransaction(state, workspacePath, connectionId) {
  const session = await state.getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await state.requestSqlite(session, 'exec', { sql: 'ROLLBACK' })
  else await executeRemoteTransaction(session, 'rollback')
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

function findCachedTable(state, key, tableName) {
  const pages = state.schemaCache.get(key)
  if (!pages) return null
  for (const page of pages.values()) {
    const table = page.tables.find((item) => item.name === tableName)
    // Le pagine remote contengono intenzionalmente solo identità. Una tabella
    // senza colonne è quindi un placeholder e non soddisfa l'ispezione esatta.
    if (table?.columns.length) return table
  }
  return null
}

function cacheInspectedTable(state, key, table) {
  if (!table) return
  const pages = state.schemaCache.get(key)
  if (!pages) return
  for (const page of pages.values()) {
    const index = page.tables.findIndex((item) => item.name === table.name)
    if (index < 0) continue
    page.tables = page.tables.with(index, table)
  }
}

async function inspectTableSchema(state, workspacePath, connectionId, session, tableName) {
  const key = sessionKey(workspacePath, connectionId)
  const cached = findCachedTable(state, key, tableName)
  if (cached) return cached
  if (session.driver === 'sqlite') {
    const { table } = await state.requestSqlite(session, 'inspectTableSchema', { tableName })
    return table ? makeSqliteTableSchema(table) : null
  }
  const columnsQuery = remoteTableColumnsExactQuery(session.driver, tableName)
  const { rows: columnRows } = await executeRemote(session, columnsQuery.sql, columnsQuery.parameters)
  const identities = uniqueRemoteTableIdentities(columnRows, 1)
  const primaryKeyQuery = remotePrimaryKeyQuery(session.driver, identities)
  const { rows: primaryKeyRows } = primaryKeyQuery
    ? await executeRemote(session, primaryKeyQuery.sql, primaryKeyQuery.parameters)
    : { rows: [] }
  const table = mapRemoteTables(columnRows, primaryKeyRows, 1)[0] ?? null
  cacheInspectedTable(state, key, table)
  return table
}

async function inspectRoutine(state, workspacePath, connectionId, routineName, kind) {
  const session = await state.getSession(workspacePath, connectionId)
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

async function inspectRemoteSchemaPage(session, { offset, limit }, execute = executeRemote) {
  // La pagina iniziale contiene soltanto identità bounded. Colonne e chiavi
  // primarie vengono lette da inspectTableSchema quando l'utente apre la
  // tabella, quindi una tabella estremamente larga non blocca il catalogo.
  const { rows: tableRows } = await execute(session, remoteTableIdentityPageSql(session.driver, { offset, limit }))
  const identities = uniqueRemoteTableIdentities(tableRows, limit)
  const tableHasMore = uniqueRemoteTableIdentities(tableRows, limit + 1).length > limit
  const tables = identities.map(({ key }) => makeTableSchema(key, []))
  const tableTotalValue = tableRows[0]?.total_count ?? tableRows[0]?.TOTAL_COUNT
  const tableTotal = Number.isSafeInteger(Number(tableTotalValue)) && Number(tableTotalValue) >= 0
    ? Number(tableTotalValue)
    : offset === 0 ? 0 : null

  const routineSql = remoteRoutinePageSql(session.driver, { offset, limit })
  const { rows: routineRows } = routineSql ? await execute(session, routineSql) : { rows: [] }
  const routineHasMore = routineRows.length > limit
  const routines = mapRemoteRoutines(routineRows, limit)
  const routineTotalValue = routineRows[0]?.total_count ?? routineRows[0]?.TOTAL_COUNT
  const routineTotal = Number.isSafeInteger(Number(routineTotalValue)) && Number(routineTotalValue) >= 0
    ? Number(routineTotalValue)
    : offset === 0 ? 0 : null
  const hasMore = tableHasMore || routineHasMore
  return {
    tables,
    routines,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
    ...(tableTotal !== null && routineTotal !== null ? { totalResources: tableTotal + routineTotal } : {}),
  }
}

async function inspectSchema(state, workspacePath, connectionId, options = {}) {
  const pageOptions = normalizeSchemaPageOptions(options)
  const key = sessionKey(workspacePath, connectionId)
  if (pageOptions.force) state.schemaCache.delete(key)
  const pageKey = schemaPageCacheKey(pageOptions)
  const cached = state.schemaCache.get(key)?.get(pageKey)
  if (cached) return cached

  const session = await state.getSession(workspacePath, connectionId)
  let schema
  if (session.driver === 'sqlite') {
    const rawSchema = await state.requestSqlite(session, 'inspectSchema', pageOptions)
    schema = {
      tables: rawSchema.tables.map(makeSqliteTableSchema),
      routines: [],
      hasMore: rawSchema.hasMore,
      nextOffset: rawSchema.hasMore ? pageOptions.offset + pageOptions.limit : null,
      totalResources: rawSchema.totalResources,
    }
  } else {
    schema = await inspectRemoteSchemaPage(session, pageOptions)
  }
  let pages = state.schemaCache.get(key)
  if (!pages) {
    pages = new Map()
    state.schemaCache.set(key, pages)
  }
  pages.set(pageKey, schema)
  while (pages.size > SCHEMA_CACHE_PAGE_LIMIT) pages.delete(pages.keys().next().value)
  return schema
}

module.exports = { attachRemoteSessionLifecycle, buildDriverConfig, classifySql, createDatabaseService, createDatabaseSessionRegistry, createRemoteSessionLifecycleController, detachRemoteSessionLifecycle, disposeRemoteSession, enqueueRemoteOperation, executeRemote, forceCloseRemoteSession, inspectRemoteSchemaPage, invalidateRemoteSession, isEditableColumn, limitRemoteReadSql, makeTableSchema, measureResultRows, normalizeAffectedRows, normalizeDatabaseError, recordQueryHistoryOutcome, routineMetadataSql, safeQueryErrorMessage, sanitizeDatabaseDiagnostic, tablePageParameters, toDatabasePublicError, validateConnectionConfig }
