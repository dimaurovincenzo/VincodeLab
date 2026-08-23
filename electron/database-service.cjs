const { getConnectionWithSecrets, recordHistory } = require('./database-store.cjs')
const { createResultBudget, measureResultRows } = require('./database-result-budget.cjs')
const { createDatabaseSessionRegistry } = require('./database-session-registry.cjs')
const { createPublicError, isPublicError } = require('./public-error.cjs')
const { SqliteWorkerSession, sqliteWorkerDiagnostics } = require('./sqlite-worker-session.cjs')

const sessions = new Map()
const schemaCache = new Map()
const RESULT_ROW_LIMIT = 500
const REMOTE_SESSION_CLEANUP_TIMEOUT_MS = 2_000
const REMOTE_SESSION_LIFECYCLE = Symbol('vincodelab.database-remote-session-lifecycle')
const remoteSessionDisposals = new WeakMap()
const forceClosedRemoteSessions = new WeakSet()

function remoteSessionEmitter(session) {
  if (session?.driver === 'mysql') return session.client?.connection ?? session.client
  return session?.client
}

function detachRemoteSessionLifecycle(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (!lifecycle || lifecycle.detached) return
  lifecycle.detached = true
  for (const [event, listener] of lifecycle.listeners) lifecycle.emitter.removeListener?.(event, listener)
  lifecycle.listeners.length = 0
}

function markRemoteSessionClosing(session) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (lifecycle) lifecycle.closing = true
}

function attachRemoteSessionLifecycle(session, onFailure = () => undefined) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return null
  if (session[REMOTE_SESSION_LIFECYCLE]) return session[REMOTE_SESSION_LIFECYCLE]
  const emitter = remoteSessionEmitter(session)
  if (!emitter || typeof emitter.on !== 'function') return null

  let resolveFailure
  const lifecycle = {
    closing: false,
    detached: false,
    emitter,
    error: null,
    failure: new Promise((resolve) => { resolveFailure = resolve }),
    invalidated: false,
    listeners: [],
  }
  Object.defineProperty(session, REMOTE_SESSION_LIFECYCLE, { value: lifecycle })

  const notify = (event, error) => {
    if (lifecycle.closing || lifecycle.invalidated) return
    lifecycle.invalidated = true
    lifecycle.error = error instanceof Error ? error : Object.assign(new Error('Connessione database interrotta.'), { code: 'DATABASE_CONNECTION_LOST' })
    resolveFailure(lifecycle.error)
    try {
      onFailure({ error: lifecycle.error, event, session })
    } catch {
      // Un listener driver non deve mai trasformare una disconnessione in un
      // uncaught exception del processo main.
    }
  }
  for (const event of ['error', 'end', 'close']) {
    const listener = event === 'error' ? (error) => notify(event, error) : () => notify(event)
    lifecycle.listeners.push([event, listener])
    emitter.on(event, listener)
  }
  return lifecycle
}

function raceRemoteSessionFailure(session, operation) {
  const lifecycle = session?.[REMOTE_SESSION_LIFECYCLE]
  if (!lifecycle) return operation
  if (lifecycle.error) return Promise.reject(lifecycle.error)
  return Promise.race([
    Promise.resolve(operation),
    lifecycle.failure.then((error) => Promise.reject(error)),
  ])
}

async function closeMssqlClient(client) {
  if (!client || client.closed || typeof client.close !== 'function') return
  if (typeof client.once !== 'function') {
    await Promise.resolve(client.close())
    return
  }
  await new Promise((resolve, reject) => {
    let completed = false
    const finish = (error) => {
      if (completed) return
      completed = true
      client.removeListener?.('end', onEnd)
      client.removeListener?.('close', onEnd)
      client.removeListener?.('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onEnd = () => finish()
    const onError = (error) => finish(error)
    client.once('end', onEnd)
    client.once('close', onEnd)
    client.once('error', onError)
    try {
      const result = client.close()
      if (result && typeof result.then === 'function') result.then(onEnd, onError)
    } catch (error) {
      onError(error)
    }
  })
}

function disposeRemoteSession(session) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function')) return Promise.resolve()
  const existing = remoteSessionDisposals.get(session)
  if (existing) return existing

  const disposal = (async () => {
    markRemoteSessionClosing(session)
    let closed = false
    try {
      await Promise.resolve(session.remoteOperationQueue).catch(() => {
        // La coda può contenere l'errore già restituito alla richiesta chiamante;
        // qui attendiamo soltanto il settlement prima di chiudere la sessione.
      })
      if (!session.client) {
        closed = true
        return
      }
      if (session.driver === 'mssql') {
        await closeMssqlClient(session.client)
        closed = true
        return
      }
      if (typeof session.client.end === 'function') await Promise.resolve(session.client.end())
      else if (typeof session.client.close === 'function') await Promise.resolve(session.client.close())
      closed = true
    } finally {
      // I listener restano attivi durante end()/close(): alcuni driver emettono
      // `error` nel teardown e, senza un listener, EventEmitter chiuderebbe il main.
      // Se il teardown fallisce, restano installati anche per il fallback forzato.
      if (closed) detachRemoteSessionLifecycle(session)
    }
  })()
  remoteSessionDisposals.set(session, disposal)
  return disposal
}

function forceCloseRemoteSession(session) {
  if (!session || (typeof session !== 'object' && typeof session !== 'function') || forceClosedRemoteSessions.has(session)) return
  forceClosedRemoteSessions.add(session)
  markRemoteSessionClosing(session)
  const client = session?.client
  if (!client) return
  try {
    if (typeof client.destroy === 'function') client.destroy()
    else if (typeof client.connection?.stream?.destroy === 'function') client.connection.stream.destroy()
    else if (typeof client.socket?.destroy === 'function') client.socket.destroy()
    else if (typeof client.close === 'function') client.close()
  } catch {
    // Il fallback è best effort e non deve mascherare il failure originale.
  }
}

const remoteSessions = createDatabaseSessionRegistry({
  cleanupTimeoutMs: REMOTE_SESSION_CLEANUP_TIMEOUT_MS,
  closeSession: disposeRemoteSession,
  forceCloseSession: forceCloseRemoteSession,
})

function createRemoteSessionLifecycleController({ closeSession, invalidateSchema = () => undefined } = {}) {
  if (typeof closeSession !== 'function') throw new TypeError('closeSession deve essere una funzione.')
  if (typeof invalidateSchema !== 'function') throw new TypeError('invalidateSchema deve essere una funzione.')
  const activeSessions = new Map()
  const failures = new Map()

  function closeAfterFailure(key) {
    try {
      void Promise.resolve(closeSession(key)).catch(() => {
        // Il failure originario resta memorizzato per il renderer; questa chiusura
        // asincrona è best effort e verrà ritentata dal lifecycle di cleanup.
      })
    } catch {
      // Il failure è già memorizzato per il renderer; il cleanup resta best effort.
    }
  }

  function track(key, session) {
    if (typeof key !== 'string' || !key) throw new TypeError('Chiave sessione non valida.')
    if (!session || (typeof session !== 'object' && typeof session !== 'function')) throw new TypeError('Sessione remota non valida.')
    if (activeSessions.get(key) === session) return session
    const previous = activeSessions.get(key)
    if (previous) markRemoteSessionClosing(previous)
    activeSessions.set(key, session)
    attachRemoteSessionLifecycle(session, ({ error }) => {
      if (activeSessions.get(key) !== session) return
      activeSessions.delete(key)
      if (!failures.has(key)) failures.set(key, toDatabasePublicError(error, { fallbackKind: 'connection-lost', phase: 'connection' }))
      try { invalidateSchema(key) } catch { /* La cache verrà ricostruita alla prossima sessione. */ }
      closeAfterFailure(key)
    })
    return session
  }

  function consumeFailure(key) {
    const failure = failures.get(key) ?? null
    if (failure) failures.delete(key)
    return failure
  }

  function prepareClose(key, { clearFailure = true } = {}) {
    const session = activeSessions.get(key)
    if (session) {
      activeSessions.delete(key)
      markRemoteSessionClosing(session)
    }
    if (clearFailure) failures.delete(key)
  }

  function prepareCloseMatching(predicate, options) {
    if (typeof predicate !== 'function') throw new TypeError('predicate deve essere una funzione.')
    const keys = new Set([...activeSessions.keys(), ...failures.keys()])
    for (const key of keys) if (predicate(key)) prepareClose(key, options)
  }

  return {
    consumeFailure,
    hasFailure: (key) => failures.has(key),
    prepareClose,
    prepareCloseMatching,
    track,
  }
}

const remoteSessionLifecycle = createRemoteSessionLifecycleController({
  closeSession: (key) => remoteSessions.close(key),
  invalidateSchema: (key) => schemaCache.delete(key),
})

function validateConnectionConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Configurazione database non valida.')
  if (config.driver === 'sqlite') return { driver: 'sqlite', sqlitePath: config.sqlitePath }
  if (!['postgres', 'mysql', 'mssql'].includes(config.driver)) throw new Error('Driver database non valido.')
  if (typeof config.host !== 'string' || !config.host.trim() || config.host.length > 255) throw new Error('Host non valido.')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw new Error('Porta non valida.')
  for (const field of ['database', 'user', 'password']) {
    if (typeof config[field] !== 'string' || !config[field]) throw new Error(`${field === 'user' ? 'Utente' : field === 'database' ? 'Database' : 'Password'} non valido.`)
  }
  return { driver: config.driver, host: config.host.trim(), port: config.port, database: config.database, user: config.user, password: config.password }
}

function buildDriverConfig(config) {
  return validateConnectionConfig(config)
}

function sessionKey(workspacePath, connectionId) {
  return `${workspacePath}\u0000${connectionId}`
}

function stripLeadingComments(sql) {
  return sql.replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/u, '')
}

function classifySql(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 65_536) throw new Error('SQL non valido.')
  const statement = stripLeadingComments(sql)
  const keyword = statement.match(/^([a-z]+)/iu)?.[1]?.toUpperCase() ?? ''
  const isReadOnlySelect = keyword === 'SELECT' && !/\b(?:insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|exec(?:ute)?|into)\b/iu.test(statement)
  // Le query non riconosciute come SELECT senza effetti collaterali chiedono
  // sempre conferma: una CTE può introdurre DELETE o UPDATE dopo WITH.
  return { keyword, mutative: !isReadOnlySelect }
}

function normalizeAffectedRows(affectedRows, mutative) {
  return mutative ? affectedRows : null
}

function isEditableColumn(column) {
  const type = String(column.type ?? '').toLowerCase()
  return !/blob|binary|varbinary|image|xml|json|geometry|geography/iu.test(type)
}

function makeTableSchema(name, columns) {
  const primaryKey = columns.filter((column) => column.primaryKeyPosition > 0)
    .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    .map((column) => column.name)
  return { name, primaryKey, columns: columns.map((column) => ({ ...column, editable: primaryKey.length > 0 && !primaryKey.includes(column.name) && isEditableColumn(column) })) }
}

function routineMetadataSql(driver) {
  if (driver === 'sqlite') return null
  if (driver === 'postgres') return "SELECT routine_schema AS schema_name, routine_name, CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS routine_type, routine_definition AS definition FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog','information_schema') ORDER BY routine_schema, routine_type, routine_name"
  if (driver === 'mysql') return "SELECT routine_schema AS schema_name, routine_name, CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END AS routine_type, routine_definition AS definition FROM information_schema.routines WHERE routine_schema = DATABASE() ORDER BY routine_type, routine_name"
  return "SELECT s.name AS schema_name, o.name AS routine_name, CASE WHEN o.type = 'P' THEN 'procedure' ELSE 'function' END AS routine_type, m.definition AS definition FROM sys.objects o INNER JOIN sys.schemas s ON s.schema_id = o.schema_id LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0 ORDER BY s.name, routine_type, o.name"
}

function quoteIdentifier(driver, identifier) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/u.test(identifier)) throw new Error('Identificatore database non valido.')
  if (driver === 'mssql') return `[${identifier}]`
  if (driver === 'mysql') return `\`${identifier}\``
  return `"${identifier}"`
}

function quoteTableIdentifier(driver, tableName) {
  if (typeof tableName !== 'string' || !tableName.trim()) throw new Error('Identificatore tabella non valido.')
  return tableName.split('.').map((part) => quoteIdentifier(driver, part)).join('.')
}

function remoteParameterMarker(driver, index) {
  if (driver === 'postgres') return `$${index + 1}`
  if (driver === 'mssql') return `@p${index}`
  return '?'
}

function tableFilterExpression(driver, column, marker) {
  if (driver === 'mssql') return `CONVERT(nvarchar(max), ${column}) LIKE ${marker}`
  if (driver === 'mysql') return `CAST(${column} AS CHAR) LIKE ${marker}`
  return `CAST(${column} AS TEXT) LIKE ${marker}`
}

function tablePageParameters(driver, limit, offset) {
  // SQL Server dichiara prima OFFSET e poi FETCH NEXT; PostgreSQL/MySQL
  // dichiarano invece LIMIT e OFFSET. L'ordine deve seguire la query generata.
  return driver === 'mssql' ? [offset, limit + 1] : [limit + 1, offset]
}

async function readTableRows(workspacePath, connectionId, tableName, options = {}) {
  const session = await getSession(workspacePath, connectionId)
  const schema = await inspectSchema(workspacePath, connectionId)
  const table = schema.tables.find((item) => item.name === tableName)
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
    ;({ rows, hasMore: workerHasMore = false } = await session.sqlite.request('all', {
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
  const schema = await inspectSchema(workspacePath, connectionId)
  const table = schema.tables.find((item) => item.name === tableName)
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
    await session.sqlite.request('updateRows', { updates })
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

const DATABASE_ERROR_DETAILS = Object.freeze({
  authentication: {
    category: 'authentication',
    code: 'DATABASE_AUTHENTICATION_FAILED',
    message: 'Autenticazione database non riuscita. Verifica credenziali e riprova.',
  },
  cancelled: {
    category: 'cancelled',
    code: 'DATABASE_QUERY_CANCELLED',
    message: 'La query è stata annullata.',
  },
  'connection-failed': {
    category: 'database',
    code: 'DATABASE_CONNECTION_FAILED',
    message: 'La connessione al database non è stata completata. Controlla la configurazione e riprova.',
  },
  'connection-lost': {
    category: 'network',
    code: 'DATABASE_NETWORK_CONNECTION_LOST',
    message: 'La connessione al database si è interrotta. Riconnetti e riprova.',
  },
  constraint: {
    category: 'conflict',
    code: 'DATABASE_CONSTRAINT_VIOLATION',
    message: 'La query viola un vincolo del database. Controlla i dati e riprova.',
  },
  'database-not-found': {
    category: 'not-found',
    code: 'DATABASE_NOT_FOUND',
    message: 'Il database richiesto non esiste o non è disponibile. Verifica il nome e riprova.',
  },
  'host-unreachable': {
    category: 'network',
    code: 'DATABASE_NETWORK_HOST_UNREACHABLE',
    message: 'Impossibile raggiungere il server database. Verifica host, porta e rete.',
  },
  permission: {
    category: 'permission',
    code: 'DATABASE_PERMISSION_DENIED',
    message: 'Il database ha rifiutato l’operazione per permessi insufficienti. Verifica i permessi e riprova.',
  },
  'query-failed': {
    category: 'database',
    code: 'DATABASE_QUERY_FAILED',
    message: 'Il database non ha completato la query. Controlla il testo e riprova.',
  },
  'result-too-large': {
    category: 'database',
    code: 'DATABASE_RESULT_TOO_LARGE',
    message: 'Il risultato supera il limite sicuro dell’app. Riduci righe o colonne, oppure limita i valori grandi nella query.',
  },
  syntax: {
    category: 'validation',
    code: 'DATABASE_SYNTAX_ERROR',
    message: 'La query contiene un errore di sintassi. Controlla il testo e riprova.',
  },
  timeout: {
    category: 'timeout',
    code: 'DATABASE_TIMEOUT',
    message: 'Il database non ha risposto entro il tempo previsto. Riprova o verifica la connessione.',
  },
  validation: {
    category: 'validation',
    code: 'DATABASE_CONFIGURATION_INVALID',
    message: 'La configurazione del database non è valida. Controlla i campi e riprova.',
  },
})

function databaseErrorParts(error) {
  const parts = []
  const pending = [error]
  const visited = new Set()
  while (pending.length && visited.size < 8) {
    const current = pending.shift()
    if (typeof current === 'string') {
      parts.push(current.slice(0, 1_024))
      continue
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    for (const key of ['name', 'code', 'errno', 'number', 'sqlState', 'sqlstate', 'state', 'class', 'message']) {
      const value = current[key]
      if (typeof value === 'string' || typeof value === 'number') parts.push(String(value).slice(0, 1_024))
    }
    for (const key of ['cause', 'originalError', 'parent']) if (current[key]) pending.push(current[key])
    if (Array.isArray(current.precedingErrors)) pending.push(...current.precedingErrors.slice(0, 4))
  }
  return parts
}

function sanitizeDatabaseDiagnostic(error) {
  const diagnostic = databaseErrorParts(error).join(' | ')
    .replace(/\b(password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]\s*([^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/giu, '[AUTH REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu, '$1[USER REDACTED]@')
    .replace(/\b(for\s+user|user(?:name)?|database|host|server)\s*(?:[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, '$1=[REDACTED]')
    .replace(/\b(for\s+(?:table|relation|schema|object))\s+(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu, '$1 [REDACTED]')
    .replace(/(["'])[^"']{1,256}\1/gu, '$1[VALUE REDACTED]$1')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/gu, '[HOST REDACTED]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/giu, '[HOST REDACTED]')
    .replace(/\/(?:Users|home)\/[^\s|]+/gu, '[PATH REDACTED]')
    .replace(/[A-Z]:\\(?:[^\s|]+\\)*[^\s|]*/giu, '[PATH REDACTED]')
    .replace(/\b(?:select|insert|update|delete|merge|create|alter|drop|truncate)\b[\s\S]*/iu, '[QUERY REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
  return diagnostic.slice(0, 512) || 'Dettaglio driver non disponibile.'
}

function databaseErrorKind(error, { fallbackKind, phase = 'query' } = {}) {
  const signal = databaseErrorParts(error).join(' ').toLowerCase()
  if (/database_result_(?:cell_)?too_large/u.test(signal)) return 'result-too-large'
  if (/timeouterror|etimedout|esockettimedout|\betimeout\b|protocol_sequence_timeout|query_timeout|request timeout|statement timeout|timed?\s*out|deadline/u.test(signal)) return 'timeout'
  if (/aborterror|abort_err|database_query_abort(?:ed)?|\baborted?\b|err_(?:canceled|cancelled)|\becancel\b|er_query_interrupted|\b1317\b|query execution was interrupted|cancel(?:ing|led|ed)|annullat/u.test(signal)) return 'cancelled'
  if (/\b57014\b/u.test(signal)) return 'cancelled'
  if (/\b3d000\b|er_bad_db_error|\b1049\b|\b4060\b|unknown database|database .+ does not exist|cannot open database/u.test(signal)) return 'database-not-found'
  if (/\b28p01\b|\b28000\b|er_access_denied_error|\b1045\b|\belogin\b|\b18456\b|login failed|authentication failed|password authentication|invalid (?:password|credentials)|access denied for user/u.test(signal)) return 'authentication'
  if (/\b42501\b|er_dbaccess_denied_error|er_tableaccess_denied_error|\b1044\b|\b1142\b|\b1227\b|\b229\b|\b916\b|permission denied|insufficient privilege|command denied|not authorized|forbidden/u.test(signal)) return 'permission'
  if (/econnrefused|enotfound|eai_again|ehostunreach|enetunreach|einstlookup|\b08001\b|\b57p03\b|could not connect|server is not found|host is unreachable|getaddrinfo/u.test(signal)) return 'host-unreachable'
  if (/econnreset|econnaborted|econnclosed|epipe|protocol_connection_lost|protocol_enqueue_after_(?:fatal_error|quit)|er_server_shutdown|er_connection_killed|\b08000\b|\b08003\b|\b08006\b|\b08007\b|\b08p01\b|\b08s01\b|\b57p01\b|\b57p02\b|server (?:has gone away|shutdown)|socket hang up|connection (?:is |was )?(?:lost|closed|terminated|broken)|database_connection_lost/u.test(signal)) return 'connection-lost'
  if (/\b42601\b|er_parse_error|\b1064\b|syntax error|incorrect syntax|parse error/u.test(signal)) return 'syntax'
  if (/\b23[0-9a-z]{3}\b|er_bad_null_error|er_check_constraint_violated|er_dup_entry|er_no_referenced_row|er_row_is_referenced|\b1048\b|\b1062\b|\b1451\b|\b1452\b|\b3819\b|\b2601\b|\b2627\b|\b547\b|constraint|duplicate (?:entry|key)|foreign key|not[- ]null violation/u.test(signal)) return 'constraint'
  if (/sessioninvalidatederror|chiusa durante la connessione/u.test(signal)) return 'cancelled'
  if (/einval|validation|malformed|non valid|invalid (?:configuration|config|input|argument)/u.test(signal)) return 'validation'
  if (DATABASE_ERROR_DETAILS[fallbackKind]) return fallbackKind
  return phase === 'connection' ? 'connection-failed' : 'query-failed'
}

function normalizeDatabaseError(error, options = {}) {
  const kind = databaseErrorKind(error, options)
  const details = DATABASE_ERROR_DETAILS[kind]
  return Object.freeze({
    category: details.category,
    code: details.code,
    diagnostic: sanitizeDatabaseDiagnostic(error),
    kind,
    message: details.message,
  })
}

function toDatabasePublicError(error, options = {}) {
  if (isPublicError(error)) return error
  const normalized = normalizeDatabaseError(error, options)
  const publicError = createPublicError(normalized.code, normalized.message)
  Object.defineProperties(publicError, {
    databaseCategory: { value: normalized.category },
    databaseDiagnostic: { value: normalized.diagnostic },
    databaseKind: { value: normalized.kind },
  })
  return publicError
}

function safeQueryErrorMessage(error) {
  return normalizeDatabaseError(error, { phase: 'query' }).message
}

async function getSqliteSession(workspacePath, connectionId) {
  const key = sessionKey(workspacePath, connectionId)
  const existing = sessions.get(key)
  if (existing) {
    await existing.ready
    return existing
  }
  const connection = getConnectionWithSecrets(workspacePath, connectionId)
  if (!connection) throw new Error('Connessione del workspace non trovata.')
  if (connection.driver !== 'sqlite') throw new Error('Driver database non ancora disponibile.')
  const session = { driver: 'sqlite', connection, sqlite: null, ready: null }
  session.sqlite = new SqliteWorkerSession(connection.sqlitePath, () => {
    if (sessions.get(key) === session) sessions.delete(key)
    schemaCache.delete(key)
  })
  session.ready = session.sqlite.ready()
  sessions.set(key, session)
  try {
    await session.ready
    return session
  } catch (error) {
    await session.sqlite.close(error)
    throw error
  }
}

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

async function getSession(workspacePath, connectionId) {
  const key = sessionKey(workspacePath, connectionId)
  const previousFailure = remoteSessionLifecycle.consumeFailure(key)
  if (previousFailure) throw previousFailure
  const existing = sessions.get(key)
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
      ;({ rows, affectedRows, hasMore: workerHasMore = false } = await session.sqlite.request('execute', {
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
  if (session.driver === 'sqlite') await session.sqlite.request('exec', { sql: 'BEGIN' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'begin')
  else await executeRemote(session, 'BEGIN')
  session.transactionActive = true
  return { active: true }
}

async function commitTransaction(workspacePath, connectionId) {
  const session = await getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await session.sqlite.request('exec', { sql: 'COMMIT' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'commit')
  else await executeRemote(session, 'COMMIT')
  session.transactionActive = false
  return { active: false }
}

async function rollbackTransaction(workspacePath, connectionId) {
  const session = await getSession(workspacePath, connectionId)
  if (!session.transactionActive) throw new Error('Nessuna transazione attiva.')
  if (session.driver === 'sqlite') await session.sqlite.request('exec', { sql: 'ROLLBACK' })
  else if (session.driver === 'mssql') await runMssqlTransactionOperation(session, 'rollback')
  else await executeRemote(session, 'ROLLBACK')
  session.transactionActive = false
  return { active: false }
}

async function inspectSchema(workspacePath, connectionId, { force = false } = {}) {
  const key = sessionKey(workspacePath, connectionId)
  if (!force && schemaCache.has(key)) return schemaCache.get(key)
  const session = await getSession(workspacePath, connectionId)
  let tables
  if (session.driver === 'sqlite') {
    const rawSchema = await session.sqlite.request('inspectSchema', {})
    tables = rawSchema.tables.map(({ name, columns }) => makeTableSchema(name, columns.map((column) => ({ name: column.name, type: column.type, nullable: column.notnull === 0, primaryKeyPosition: column.pk }))))
  } else {
    const schemaSql = session.driver === 'postgres'
      ? "SELECT table_schema AS schema_name, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position"
      : session.driver === 'mysql'
        ? 'SELECT table_schema AS schema_name, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position'
        : "SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA') ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    const primaryKeySql = session.driver === 'postgres'
      ? "SELECT tc.table_schema AS schema_name, tc.table_name, kcu.column_name, kcu.ordinal_position AS primary_key_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema NOT IN ('pg_catalog','information_schema')"
      : session.driver === 'mysql'
        ? "SELECT tc.table_schema AS schema_name, tc.table_name, kcu.column_name, kcu.ordinal_position AS primary_key_position FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = DATABASE()"
        : "SELECT tc.TABLE_SCHEMA AS schema_name, tc.TABLE_NAME AS table_name, kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS primary_key_position FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND tc.TABLE_NAME = kcu.TABLE_NAME WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA')"
    // Tedious esegue una richiesta per connessione alla volta; usare chiamate
    // sequenziali mantiene compatibile anche l'ispezione SQL Server.
    const { rows } = await executeRemote(session, schemaSql)
    const { rows: primaryKeyRows } = await executeRemote(session, primaryKeySql)
    const routineSql = routineMetadataSql(session.driver)
    const { rows: routineRows } = routineSql ? await executeRemote(session, routineSql) : { rows: [] }
    const primaryKeys = new Map(primaryKeyRows.map((row) => [
      `${row.schema_name ?? row.SCHEMA_NAME ?? 'dbo'}.${row.table_name ?? row.TABLE_NAME}.${row.column_name ?? row.COLUMN_NAME}`,
      Number(row.primary_key_position ?? row.PRIMARY_KEY_POSITION ?? 0),
    ]))
    const grouped = new Map()
    for (const row of rows) {
      const schemaName = row.schema_name ?? row.SCHEMA_NAME ?? 'dbo'
      const tableName = row.table_name ?? row.TABLE_NAME
      const key = `${schemaName}.${tableName}`
      if (!grouped.has(key)) grouped.set(key, { name: key, columns: [] })
      const columnName = row.column_name ?? row.COLUMN_NAME
      grouped.get(key).columns.push({ name: columnName, type: row.data_type ?? row.DATA_TYPE, nullable: (row.is_nullable ?? row.IS_NULLABLE) === 'YES', primaryKeyPosition: primaryKeys.get(`${key}.${columnName}`) ?? 0 })
    }
    tables = [...grouped.values()].map((table) => makeTableSchema(table.name, table.columns))
    const routines = routineRows.map((row) => {
      const schemaName = row.schema_name ?? row.SCHEMA_NAME ?? 'dbo'
      const routineName = row.routine_name ?? row.ROUTINE_NAME
      const kind = String(row.routine_type ?? row.ROUTINE_TYPE).toLowerCase() === 'procedure' ? 'procedure' : 'function'
      return { name: `${schemaName}.${routineName}`, kind, definition: row.definition ?? row.DEFINITION ?? null }
    })
    const schema = { tables, routines }
    schemaCache.set(key, schema)
    return schema
  }
  const schema = { tables, routines: [] }
  schemaCache.set(key, schema)
  return schema
}

function closeWorkspaceSessions(workspacePath) {
  const closing = []
  for (const [key, session] of sessions) {
    if (!key.startsWith(`${workspacePath}\u0000`)) continue
    closing.push(session.sqlite.close())
    sessions.delete(key)
    schemaCache.delete(key)
  }
  for (const key of schemaCache.keys()) {
    if (key.startsWith(`${workspacePath}\u0000`)) schemaCache.delete(key)
  }
  const matchesWorkspace = (key) => key.startsWith(`${workspacePath}\u0000`)
  remoteSessionLifecycle.prepareCloseMatching(matchesWorkspace)
  closing.push(remoteSessions.closeMatching(matchesWorkspace))
  return Promise.allSettled(closing)
}

function closeConnectionSession(workspacePath, connectionId, { clearFailure = true } = {}) {
  const key = sessionKey(workspacePath, connectionId)
  const session = sessions.get(key)
  sessions.delete(key)
  schemaCache.delete(key)
  remoteSessionLifecycle.prepareClose(key, { clearFailure })
  return Promise.allSettled([
    session?.sqlite.close(),
    remoteSessions.close(key),
  ])
}

module.exports = { attachRemoteSessionLifecycle, beginTransaction, buildDriverConfig, classifySql, closeConnectionSession, closeWorkspaceSessions, commitTransaction, createDatabaseSessionRegistry, createRemoteSessionLifecycleController, detachRemoteSessionLifecycle, disposeRemoteSession, enqueueRemoteOperation, executeQuery, executeRemote, forceCloseRemoteSession, inspectSchema, isEditableColumn, limitRemoteReadSql, makeTableSchema, measureResultRows, normalizeAffectedRows, normalizeDatabaseError, openMssqlConnection, readTableRows, recordQueryHistoryOutcome, rollbackTransaction, routineMetadataSql, runMssqlTransactionOperation, safeQueryErrorMessage, sanitizeDatabaseDiagnostic, sqliteWorkerDiagnostics, tablePageParameters, toDatabasePublicError, updateTableRows, validateConnectionConfig }
