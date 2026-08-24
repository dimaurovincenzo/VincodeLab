const assert = require('node:assert/strict')
const { fork } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')

const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const { createConnection, getConnectionWithSecrets, recordHistory } = require('../electron/infrastructure/persistence/database.repository.cjs')
const { beginTransaction, buildDriverConfig, classifySql, closeConnectionSession, closeWorkspaceSessions, configureDatabasePersistence, configureDatabaseRuntime, createDatabaseSessionRegistry, createRemoteSessionLifecycleController, disposeRemoteSession, enqueueRemoteOperation, executeQuery, executeRemote, forceCloseRemoteSession, inspectRemoteSchemaPage, inspectRoutine, inspectSchema, limitRemoteReadSql, measureResultRows, normalizeAffectedRows, normalizeDatabaseError, openConnection, openMssqlConnection, readTableRows, recordQueryHistoryOutcome, rollbackTransaction, routineMetadataSql, runMssqlTransactionOperation, safeQueryErrorMessage, sqliteWorkerDiagnostics, tablePageParameters, toDatabasePublicError, updateTableRows, validateConnectionConfig } = require('../electron/domains/database/database-service.cjs')
const { MAX_ROUTINE_DEFINITION_CHARS, normalizeSchemaPageOptions, remotePrimaryKeyQuery, remoteRoutineDefinitionQuery, remoteRoutinePageSql, remoteTableIdentityPageSql } = require('../electron/domains/database/database-schema-model.cjs')
const { createNodeDatabaseDriverAdapter, nodeDatabaseDriverAdapter } = require('../electron/infrastructure/database/node-database-driver.adapter.cjs')
const { SqliteWorkerSession, sqliteWorkerDiagnostics: readSqliteWorkerDiagnostics } = require('../electron/infrastructure/database/sqlite-worker-session.adapter.cjs')

configureDatabasePersistence({ getConnectionWithSecrets, recordHistory })
configureDatabaseRuntime({
  createSqliteWorkerSession: (sqlitePath, onClosed) => new SqliteWorkerSession(sqlitePath, onClosed),
  driverPort: nodeDatabaseDriverAdapter,
  sqliteWorkerDiagnostics: readSqliteWorkerDiagnostics,
})

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-query-'))
  const workspace = path.join(dataDirectory, 'workspace')
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  fs.mkdirSync(workspace)
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(async () => {
    await closeWorkspaceSessions(workspace)
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
  return { workspace, sqlitePath: path.join(dataDirectory, 'data.sqlite') }
}

function waitForWorkerMessage(worker, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const onError = (error) => { cleanup(); reject(error) }
    const onExit = (code, signal) => { cleanup(); reject(new Error(`Worker SQLite terminato: ${code ?? signal ?? 'unknown'}`)) }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }
    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('classifica le mutazioni e richiede conferma prima di eseguirle', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  assert.equal(classifySql('SELECT * FROM users').mutative, false)
  assert.equal(classifySql(' /* nota */ UPDATE users SET name = 1').mutative, true)
  assert.equal(classifySql('EXECUTE dbo.aggiorna_riepilogo').mutative, true)
  await assert.rejects(() => executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER)', { confirmed: false }), /Conferma richiesta/)
  await assert.rejects(() => executeQuery(workspace, connection.id, 'SELECT password FROM', {}), (error) => (
    error.publicCode === 'DATABASE_SYNTAX_ERROR'
    && error.publicMessage === 'La query contiene un errore di sintassi. Controlla il testo e riprova.'
    && !error.message.includes('SELECT password')
  ))
  assert.deepEqual((await executeQuery(workspace, connection.id, 'SELECT 1 AS risultato')).rows, [{ risultato: 1 }])
})

test('richiede conferma per una mutazione introdotta da una CTE', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  const cteDelete = 'WITH target AS (SELECT 1 AS id) DELETE FROM users WHERE id IN (SELECT id FROM target)'

  await executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER)', { confirmed: true })
  await executeQuery(workspace, connection.id, 'INSERT INTO users VALUES (1)', { confirmed: true })

  assert.equal(classifySql(cteDelete).mutative, true)
  await assert.rejects(() => executeQuery(workspace, connection.id, cteDelete), /Conferma richiesta/)
  assert.deepEqual((await executeQuery(workspace, connection.id, 'SELECT id FROM users')).rows, [{ id: 1 }])
})

test('normalizza gli errori dei driver senza esporre segreti nei messaggi o nella diagnostica', () => {
  const cases = [
    {
      error: Object.assign(new Error('password authentication failed for user "private-owner"; password=hunter2'), { code: '28P01' }),
      expected: ['authentication', 'DATABASE_AUTHENTICATION_FAILED', 'authentication'],
      privateValues: ['private-owner', 'hunter2'],
    },
    {
      error: Object.assign(new Error('getaddrinfo ENOTFOUND private-db.internal host=private-db.internal token=token-123'), { code: 'ENOTFOUND' }),
      expected: ['host-unreachable', 'DATABASE_NETWORK_HOST_UNREACHABLE', 'network'],
      privateValues: ['private-db.internal', 'token-123'],
    },
    {
      error: Object.assign(new Error('Cannot open database "customer-ledger" requested by the login.'), { number: 4060 }),
      expected: ['database-not-found', 'DATABASE_NOT_FOUND', 'not-found'],
      privateValues: ['customer-ledger'],
    },
    {
      error: Object.assign(new Error('Request timeout after 30000ms for server sql.prod.internal'), { code: 'ETIMEOUT' }),
      expected: ['timeout', 'DATABASE_TIMEOUT', 'timeout'],
      privateValues: ['sql.prod.internal'],
    },
    {
      error: Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
      expected: ['timeout', 'DATABASE_TIMEOUT', 'timeout'],
      privateValues: [],
    },
    {
      error: Object.assign(new Error('Connection lost: server closed the connection password=lost-secret'), { code: 'PROTOCOL_CONNECTION_LOST' }),
      expected: ['connection-lost', 'DATABASE_NETWORK_CONNECTION_LOST', 'network'],
      privateValues: ['lost-secret'],
    },
    {
      error: Object.assign(new Error('syntax error at or near "secret_column"; SELECT * FROM private_table WHERE token="abc"'), { code: '42601' }),
      expected: ['syntax', 'DATABASE_SYNTAX_ERROR', 'validation'],
      privateValues: ['secret_column', 'private_table', 'abc'],
    },
    {
      error: Object.assign(new Error("Duplicate entry 'secret@example.test' for key 'users.email'"), { code: 'ER_DUP_ENTRY', errno: 1062 }),
      expected: ['constraint', 'DATABASE_CONSTRAINT_VIOLATION', 'conflict'],
      privateValues: ['secret@example.test', 'users.email'],
    },
    {
      error: Object.assign(new Error('permission denied for table private_payroll'), { code: '42501' }),
      expected: ['permission', 'DATABASE_PERMISSION_DENIED', 'permission'],
      privateValues: ['private_payroll'],
    },
    {
      error: Object.assign(new Error('Query execution was interrupted'), { code: 'ER_QUERY_INTERRUPTED', errno: 1317 }),
      expected: ['cancelled', 'DATABASE_QUERY_CANCELLED', 'cancelled'],
      privateValues: [],
    },
    {
      error: Object.assign(new Error('canceling statement due to user request'), { code: '57014' }),
      expected: ['cancelled', 'DATABASE_QUERY_CANCELLED', 'cancelled'],
      privateValues: [],
    },
    {
      error: new Error('Opaque driver connect failure'),
      expected: ['connection-failed', 'DATABASE_CONNECTION_FAILED', 'database'],
      options: { phase: 'connection' },
      privateValues: [],
    },
    {
      error: new Error('Opaque driver query failure'),
      expected: ['query-failed', 'DATABASE_QUERY_FAILED', 'database'],
      privateValues: [],
    },
    {
      error: Object.assign(new Error("Cannot find module 'pg' from /Applications/VincodeLab.app/private-runtime"), { code: 'MODULE_NOT_FOUND' }),
      expected: ['driver-unavailable', 'DATABASE_DRIVER_UNAVAILABLE', 'configuration'],
      options: { phase: 'connection' },
      privateValues: ['/Applications/VincodeLab.app/private-runtime'],
    },
    {
      error: Object.assign(new Error('The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127'), { code: 'ERR_DLOPEN_FAILED' }),
      expected: ['runtime-incompatible', 'DATABASE_RUNTIME_INCOMPATIBLE', 'configuration'],
      options: { phase: 'connection' },
      privateValues: [],
    },
    {
      error: Object.assign(new Error('unable to open database file /Users/private/data.sqlite'), { code: 'SQLITE_CANTOPEN' }),
      expected: ['file-not-found', 'DATABASE_FILE_NOT_FOUND', 'not-found'],
      options: { driver: 'sqlite', phase: 'connection' },
      privateValues: ['/Users/private/data.sqlite'],
    },
    {
      error: Object.assign(new Error('attempt to write a readonly database'), { code: 'SQLITE_READONLY' }),
      expected: ['file-read-only', 'DATABASE_FILE_READ_ONLY', 'permission'],
      options: { driver: 'sqlite' },
      privateValues: [],
    },
    {
      error: Object.assign(new Error('file is not a database /Users/private/invalid.sqlite'), { code: 'SQLITE_NOTADB' }),
      expected: ['file-invalid', 'DATABASE_FILE_INVALID', 'validation'],
      options: { driver: 'sqlite', phase: 'connection' },
      privateValues: ['/Users/private/invalid.sqlite'],
    },
  ]

  for (const { error, expected: [kind, code, category], options, privateValues } of cases) {
    const normalized = normalizeDatabaseError(error, options)
    assert.equal(normalized.kind, kind)
    assert.equal(normalized.code, code)
    assert.equal(normalized.category, category)
    assert.equal(safeQueryErrorMessage(error), normalizeDatabaseError(error).message)

    const publicError = toDatabasePublicError(error, options)
    assert.equal(publicError.publicCode, code)
    assert.equal(publicError.publicMessage, normalized.message)
    assert.equal(publicError.message, `${normalized.message} [${code}]`)
    assert.equal(publicError.databaseDiagnostic, normalized.diagnostic)
    assert.equal(publicError.cause, undefined)
    for (const privateValue of privateValues) {
      assert.doesNotMatch(normalized.diagnostic, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'))
      assert.doesNotMatch(publicError.message, new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'))
    }
  }
})

test('indica la reinstallazione per driver assenti o runtime incompatibili senza esporre dettagli tecnici', () => {
  const cases = [
    Object.assign(new Error("Cannot find module 'mysql2/promise' from /Users/private/VincodeLab.app"), { code: 'MODULE_NOT_FOUND' }),
    Object.assign(new Error('/Users/private/addon.node: mach-o file, but is an incompatible architecture'), { code: 'ERR_DLOPEN_FAILED' }),
  ]

  for (const error of cases) {
    const publicError = toDatabasePublicError(error, { phase: 'connection' })
    assert.match(publicError.publicMessage, /Reinstalla/u)
    assert.doesNotMatch(publicError.message, /mysql2|addon\.node|\/Users\/private/iu)
  }
  assert.equal(toDatabasePublicError(cases[0], { phase: 'connection' }).publicCode, 'DATABASE_DRIVER_UNAVAILABLE')
  assert.equal(toDatabasePublicError(cases[1], { phase: 'connection' }).publicCode, 'DATABASE_RUNTIME_INCOMPATIBLE')
})

test('non attribuisce righe coinvolte a una query di sola lettura remota', () => {
  assert.equal(normalizeAffectedRows(1, false), null)
  assert.equal(normalizeAffectedRows(1, true), 1)
})

test('una failure della cronologia non trasforma una query riuscita in un errore', () => {
  const entry = { connectionId: 'connection', sql: 'DELETE FROM users', durationMs: 4, affectedRows: 1 }
  assert.equal(recordQueryHistoryOutcome('/workspace', entry, () => { throw new Error('history unavailable') }), false)
  assert.equal(recordQueryHistoryOutcome('/workspace', entry, () => undefined), true)
})

test('esegue transazione SQLite e rollback senza mantenere modifiche', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  await executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER)', { confirmed: true })
  await beginTransaction(workspace, connection.id)
  await executeQuery(workspace, connection.id, 'INSERT INTO users VALUES (1)', { confirmed: true })
  await rollbackTransaction(workspace, connection.id)

  assert.deepEqual((await executeQuery(workspace, connection.id, 'SELECT * FROM users')).rows, [])
})

test('classifica un file SQLite non valido dopo il passaggio nel worker', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  fs.writeFileSync(sqlitePath, 'contenuto che non è un database SQLite')
  const connection = createConnection(workspace, { name: 'Non valido', driver: 'sqlite', sqlitePath })

  await assert.rejects(
    () => inspectSchema(workspace, connection.id),
    (error) => (
      error.publicCode === 'DATABASE_FILE_INVALID'
      && error.publicMessage === 'Il file selezionato non è un database SQLite valido. Scegli un altro file e riprova.'
      && !error.message.includes(sqlitePath)
      && !error.message.includes('contenuto')
    ),
  )
})

test('classifica come non disponibile un file SQLite in una directory inesistente senza crearlo', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const missingPath = path.join(path.dirname(sqlitePath), 'directory-inesistente', 'missing.sqlite')
  const connection = createConnection(workspace, { name: 'Mancante', driver: 'sqlite', sqlitePath: missingPath })

  await assert.rejects(
    () => inspectSchema(workspace, connection.id),
    (error) => error.publicCode === 'DATABASE_FILE_NOT_FOUND' && !error.message.includes(missingPath),
  )
  assert.equal(fs.existsSync(missingPath), false)
})

test('classifica una scrittura SQLite in sola lettura dopo il passaggio nel worker', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Sola lettura', driver: 'sqlite', sqlitePath })
  await executeQuery(workspace, connection.id, 'CREATE TABLE items(id INTEGER)', { confirmed: true })
  await executeQuery(workspace, connection.id, 'PRAGMA query_only = ON', { confirmed: true })

  await assert.rejects(
    () => executeQuery(workspace, connection.id, 'INSERT INTO items(id) VALUES (1)', { confirmed: true }),
    (error) => (
      error.publicCode === 'DATABASE_FILE_READ_ONLY'
      && error.publicMessage === 'Il file SQLite è in sola lettura o non è scrivibile. Verifica i permessi e riprova.'
      && !error.message.includes('INSERT INTO')
    ),
  )
})

test('pagina le letture SQLite senza restituire oltre 500 righe per risposta', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  await executeQuery(workspace, connection.id, 'CREATE TABLE items(id INTEGER)', { confirmed: true })
  for (let id = 1; id <= 501; id += 1) await executeQuery(workspace, connection.id, `INSERT INTO items VALUES (${id})`, { confirmed: true })

  const first = await executeQuery(workspace, connection.id, 'SELECT id FROM items ORDER BY id')
  const boundedExplicitLimit = await executeQuery(workspace, connection.id, 'SELECT id FROM items ORDER BY id LIMIT 999999')
  const second = await executeQuery(workspace, connection.id, 'SELECT id FROM items ORDER BY id', { offset: 500 })
  assert.equal(first.rows.length, 500)
  assert.equal(first.hasMore, true)
  assert.equal(boundedExplicitLimit.rows.length, 500)
  assert.equal(boundedExplicitLimit.hasMore, true)
  assert.equal(second.rows[0].id, 501)
})

test('applica limite configurabile e valida timeout e dimensione pagina', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  await executeQuery(workspace, connection.id, 'CREATE TABLE items(id INTEGER)', { confirmed: true })
  for (let id = 1; id <= 4; id += 1) await executeQuery(workspace, connection.id, `INSERT INTO items VALUES (${id})`, { confirmed: true })

  const page = await executeQuery(workspace, connection.id, 'SELECT id FROM items ORDER BY id', { limit: 2, timeoutMs: 5_000 })
  assert.deepEqual(page.rows, [{ id: 1 }, { id: 2 }])
  assert.equal(page.hasMore, true)
  await assert.rejects(() => executeQuery(workspace, connection.id, 'SELECT 1', { limit: 0 }), /Limite risultati/)
  await assert.rejects(() => executeQuery(workspace, connection.id, 'SELECT 1', { timeoutMs: 999 }), /Timeout query/)
})

test('una query SQLite lunga non blocca l event loop del processo principale', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  const longQuery = 'WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 20000000) SELECT sum(value) AS total FROM counter'
  const query = executeQuery(workspace, connection.id, longQuery, { confirmed: true, timeoutMs: 5_000 })

  const winner = await Promise.race([
    query.then(() => 'query'),
    new Promise((resolve) => setTimeout(() => resolve('event-loop'), 25)),
  ])

  assert.equal(winner, 'event-loop')
  assert.equal((await query).rows[0].total, 200000010000000)
})

test('timeout e abort terminano il worker SQLite e permettono una sessione pulita', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  const longQuery = 'WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 100000000) SELECT sum(value) AS total FROM counter'

  await assert.rejects(
    () => executeQuery(workspace, connection.id, longQuery, { confirmed: true, timeoutMs: 1_000 }),
    /non ha risposto entro il tempo previsto/,
  )
  assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 })
  assert.deepEqual((await executeQuery(workspace, connection.id, 'SELECT 1 AS recovered')).rows, [{ recovered: 1 }])
  await executeQuery(workspace, connection.id, 'CREATE TABLE pending_changes(id INTEGER)', { confirmed: true })
  await beginTransaction(workspace, connection.id)
  await executeQuery(workspace, connection.id, 'INSERT INTO pending_changes VALUES (1)', { confirmed: true })

  const controller = new AbortController()
  const aborted = executeQuery(workspace, connection.id, longQuery, { confirmed: true, signal: controller.signal, timeoutMs: 5_000 })
  setTimeout(() => controller.abort(), 25)
  await assert.rejects(aborted, /query è stata annullata/i)
  assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 })
  assert.deepEqual((await executeQuery(workspace, connection.id, 'SELECT id FROM pending_changes')).rows, [])
})

test('close rigetta il lavoro SQLite pendente e attende la terminazione del worker', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  const longQuery = 'WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 20000000) SELECT sum(value) AS total FROM counter'
  await executeQuery(workspace, connection.id, 'SELECT 1')
  assert.equal(sqliteWorkerDiagnostics().activeWorkers, 1)

  const pending = executeQuery(workspace, connection.id, longQuery, { confirmed: true, timeoutMs: 5_000 })
  await new Promise((resolve) => setTimeout(resolve, 25))
  const closing = closeConnectionSession(workspace, connection.id)
  await assert.rejects(pending)
  await closing

  assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 })
})

test('rifiuta celle e payload oltre il budget prima dell IPC renderer', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  await assert.rejects(
    () => executeQuery(workspace, connection.id, 'SELECT randomblob(2097152) AS contenuto'),
    (error) => error.publicCode === 'DATABASE_RESULT_TOO_LARGE',
  )
  assert.throws(
    () => measureResultRows([{ a: 'x'.repeat(800_000), b: 'y'.repeat(800_000) }], { byteLimit: 1_000_000, cellByteLimit: 900_000 }),
    /database_result_too_large|database_result_cell_too_large/,
  )

  const result = await executeQuery(workspace, connection.id, 'SELECT randomblob(1024) AS contenuto')
  assert.equal(result.rows[0].contenuto.length, 1024)
  assert.ok(result.resultBytes >= 1024)
})

test('interrompe lo stream PostgreSQL appena il budget incrementale è superato', async () => {
  class FakeQuery extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
    }
  }
  let emittedRows = 0
  let destroyCalls = 0
  const client = Object.assign(new EventEmitter(), {
    destroyed: false,
    destroy() {
      destroyCalls += 1
      this.destroyed = true
    },
    async end() {},
    query(query) {
      queueMicrotask(() => {
        for (let index = 0; index < 100 && !this.destroyed; index += 1) {
          emittedRows += 1
          query.emit('row', { payload: 'x'.repeat(24) })
        }
        if (!this.destroyed) query.emit('end', { command: 'SELECT', rowCount: emittedRows })
      })
      return query
    },
  })
  const key = 'workspace-budget\u0000postgres'
  const driverPort = createNodeDatabaseDriverAdapter({
    loadPostgres: () => ({ Query: FakeQuery }),
  })
  let registry
  const controller = createRemoteSessionLifecycleController({ closeSession: (sessionKey) => registry.close(sessionKey) })
  registry = createDatabaseSessionRegistry({ closeSession: disposeRemoteSession, forceCloseSession: forceCloseRemoteSession })
  const session = await registry.acquire(key, async ({ setCandidate }) => {
    const candidate = { driver: 'postgres', client, driverPort }
    setCandidate(candidate)
    controller.track(key, candidate)
    return candidate
  })

  await assert.rejects(
    executeRemote(session, 'SELECT payload FROM fixture', [], 1_000, { resultBudget: { byteLimit: 100, cellByteLimit: 64 } }),
    (error) => error.publicCode === 'DATABASE_RESULT_TOO_LARGE',
  )
  assert.equal(destroyCalls, 1)
  assert.ok(emittedRows < 100)
  const replacement = await registry.acquire(key, async ({ setCandidate }) => {
    const candidate = { driver: 'postgres', client: new EventEmitter(), driverPort }
    candidate.client.end = async () => undefined
    setCandidate(candidate)
    return candidate
  })
  assert.notEqual(replacement, session)
  assert.equal(controller.hasFailure(key), false)
  await registry.close(key)
})

test('legge MySQL a eventi senza materializzare il risultato e distingue una colonna affectedRows', async () => {
  const rawClient = {
    stream: { destroy() {} },
    query() {
      const command = new EventEmitter()
      queueMicrotask(() => {
        command.emit('fields', [{ name: 'affectedRows' }])
        command.emit('result', { affectedRows: 7, label: 'riga utente' })
        command.emit('end')
      })
      return command
    },
  }

  const result = await executeRemote({ driver: 'mysql', client: { connection: rawClient }, driverPort: nodeDatabaseDriverAdapter }, 'SELECT affectedRows FROM fixture')
  assert.deepEqual(result, { rows: [{ affectedRows: 7, label: 'riga utente' }], affectedRows: null })
})

test('la cancellazione raggiunge la Request SQL Server e libera subito la coda', async () => {
  let request
  class FakeRequest extends EventEmitter {
    constructor(_sql, callback) {
      super()
      this.callback = callback
      this.cancelCalls = 0
      request = this
    }

    addParameter() {}
    setTimeout() {}
    cancel() { this.cancelCalls += 1 }
  }
  const controller = new AbortController()
  const driverPort = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({
      Request: FakeRequest,
      TYPES: { Bit: {}, Float: {}, Int: {}, NVarChar: {} },
    }),
  })
  const session = {
    driver: 'mssql',
    client: { execSql() {} },
    driverPort,
  }
  const pending = executeRemote(session, 'WAITFOR DELAY', [], 30_000, { signal: controller.signal })
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()

  await assert.rejects(pending, (error) => error.publicCode === 'DATABASE_QUERY_CANCELLED')
  assert.equal(request.cancelCalls, 1)
  assert.deepEqual(await executeRemote({ ...session, client: { execSql(nextRequest) { queueMicrotask(() => nextRequest.callback(undefined, 0)) } } }, 'SELECT 1'), { rows: [], affectedRows: 0 })
})

test('il worker SQLite non invia la riga sentinella oltre il proprio IPC', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-worker-budget-'))
  const sqlitePath = path.join(directory, 'budget.sqlite')
  const database = new Database(sqlitePath)
  database.exec("CREATE TABLE items(id INTEGER, content BLOB); INSERT INTO items VALUES (1, X'01'); INSERT INTO items VALUES (2, zeroblob(2097152));")
  database.close()

  const worker = fork(path.join(__dirname, '../electron/infrastructure/database/sqlite-database-worker.cjs'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    execArgv: [],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  t.after(() => {
    if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
    fs.rmSync(directory, { recursive: true, force: true })
  })

  worker.send({ type: 'initialize', sqlitePath })
  assert.deepEqual(await waitForWorkerMessage(worker, (message) => message?.type === 'ready'), { type: 'ready' })
  worker.send({ id: 1, operation: 'execute', payload: { sql: 'SELECT * FROM items ORDER BY id LIMIT 2', budgetRowLimit: 1 } })
  const response = await waitForWorkerMessage(worker, (message) => message?.id === 1)

  assert.equal(response.error, undefined)
  assert.equal(response.result.hasMore, true)
  assert.equal(response.result.rows.length, 1)
  assert.equal(response.result.rows[0].id, 1)
})

test('lo schema SQLite pagina identità e carica chiave primaria e colonne solo all apertura', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  assert.deepEqual(await openConnection(workspace, connection.id), { connected: true })
  assert.deepEqual(await inspectRoutine(workspace, connection.id, 'main.not_available', 'procedure'), {
    name: 'main.not_available', kind: 'procedure', definition: null, definitionTruncated: false,
  })

  await executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, score INTEGER)', { confirmed: true })
  await executeQuery(workspace, connection.id, 'CREATE TABLE logs(message TEXT)', { confirmed: true })

  const schema = await inspectSchema(workspace, connection.id, { force: true })
  assert.deepEqual(schema.tables.map((table) => ({ name: table.name, columns: table.columns })), [
    { name: 'logs', columns: [] },
    { name: 'users', columns: [] },
  ])
  const users = (await readTableRows(workspace, connection.id, 'users')).table
  const logs = (await readTableRows(workspace, connection.id, 'logs')).table

  assert.deepEqual(users.primaryKey, ['id'])
  assert.equal(users.columns.find((column) => column.name === 'id').editable, false)
  assert.equal(users.columns.find((column) => column.name === 'name').editable, true)
  assert.deepEqual(logs.primaryKey, [])
  assert.equal(logs.columns.every((column) => column.editable === false), true)
  assert.deepEqual(schema.routines, [])
  assert.equal(schema.hasMore, false)
  assert.equal(schema.nextOffset, null)
  assert.equal(schema.totalResources, 2)
})

test('pagina lo schema SQLite e carica una tabella non presente nella pagina senza ispezionare tutto il database', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })

  for (const table of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
    await executeQuery(workspace, connection.id, `CREATE TABLE ${table}(id INTEGER PRIMARY KEY, value TEXT)`, { confirmed: true })
  }
  await executeQuery(workspace, connection.id, "INSERT INTO echo VALUES (1, 'ultima')", { confirmed: true })

  const first = await inspectSchema(workspace, connection.id, { force: true, offset: 0, limit: 2 })
  const second = await inspectSchema(workspace, connection.id, { offset: first.nextOffset, limit: 2 })
  const last = await inspectSchema(workspace, connection.id, { offset: second.nextOffset, limit: 2 })

  assert.deepEqual(first.tables.map(({ name }) => name), ['alpha', 'bravo'])
  assert.deepEqual({ hasMore: first.hasMore, nextOffset: first.nextOffset }, { hasMore: true, nextOffset: 2 })
  assert.deepEqual(second.tables.map(({ name }) => name), ['charlie', 'delta'])
  assert.deepEqual({ hasMore: second.hasMore, nextOffset: second.nextOffset }, { hasMore: true, nextOffset: 4 })
  assert.deepEqual(last.tables.map(({ name }) => name), ['echo'])
  assert.deepEqual({ hasMore: last.hasMore, nextOffset: last.nextOffset }, { hasMore: false, nextOffset: null })

  // Una nuova pagina iniziale espelle intenzionalmente le altre dal cache lookup:
  // la lettura diretta deve comunque recuperare solo i metadati della tabella.
  await inspectSchema(workspace, connection.id, { force: true, offset: 0, limit: 2 })
  const page = await readTableRows(workspace, connection.id, 'echo')
  assert.deepEqual(page.rows, [{ id: 1, value: 'ultima' }])
  assert.equal(page.table.name, 'echo')
})

test('valida la finestra schema e pagina solo identità prima di caricare colonne e routine', () => {
  assert.deepEqual(normalizeSchemaPageOptions(), { force: false, offset: 0, limit: 50 })
  assert.deepEqual(normalizeSchemaPageOptions({ force: true, offset: 100, limit: 25 }), { force: true, offset: 100, limit: 25 })
  assert.throws(() => normalizeSchemaPageOptions({ offset: -1 }), /Offset schema database non valido/)
  assert.throws(() => normalizeSchemaPageOptions({ limit: 101 }), /Limite schema database non valido/)

  const postgresTables = remoteTableIdentityPageSql('postgres', { offset: 100, limit: 25 })
  const mysqlTables = remoteTableIdentityPageSql('mysql', { offset: 50, limit: 10 })
  const mssqlTables = remoteTableIdentityPageSql('mssql', { offset: 20, limit: 5 })
  assert.match(postgresTables, /LIMIT 26 OFFSET 100/)
  assert.match(mysqlTables, /LIMIT 11 OFFSET 50/)
  assert.match(mssqlTables, /OFFSET 20 ROWS FETCH NEXT 6 ROWS ONLY/)
  for (const query of [postgresTables, mysqlTables, mssqlTables]) {
    assert.match(query, /information_schema\.tables/i)
    assert.doesNotMatch(query, /column_name|ordinal_position|primary key/i)
  }
  assert.match(remoteRoutinePageSql('postgres', { offset: 40, limit: 20 }), /LIMIT 21 OFFSET 40$/)
  assert.match(remoteRoutinePageSql('mssql', { offset: 40, limit: 20 }), /OFFSET 40 ROWS FETCH NEXT 21 ROWS ONLY$/)

  const postgresPrimaryKeys = remotePrimaryKeyQuery('postgres', [
    { schemaName: 'public', tableName: 'users' },
    { schemaName: 'audit', tableName: 'events' },
  ])
  assert.match(postgresPrimaryKeys.sql, /tc\.table_schema = \$1 AND tc\.table_name = \$2/)
  assert.match(postgresPrimaryKeys.sql, /tc\.table_schema = \$3 AND tc\.table_name = \$4/)
  assert.deepEqual(postgresPrimaryKeys.parameters, ['public', 'users', 'audit', 'events'])
})

test('pagina metadati leggeri e carica la definizione di una routine solo su richiesta', () => {
  const sql = routineMetadataSql('mssql')
  const definition = remoteRoutineDefinitionQuery('postgres', 'public.refresh_cache', 'procedure')

  assert.match(sql, /sys\.objects/i)
  assert.match(sql, /'procedure'/i)
  assert.match(sql, /'function'/i)
  assert.doesNotMatch(sql, /sql_modules|definition/i)
  assert.match(definition.sql, new RegExp(`LEFT\\(routine_definition, ${MAX_ROUTINE_DEFINITION_CHARS}\\)`))
  assert.match(definition.sql, /definition_truncated/i)
  assert.deepEqual(definition.parameters, ['public', 'refresh_cache', 'PROCEDURE'])
  assert.equal(routineMetadataSql('sqlite'), null)
})

test('lo schema remoto non materializza colonne o chiavi prima dell apertura della tabella', async () => {
  const queries = []
  const execute = async (_session, sql) => {
    queries.push(sql)
    if (/information_schema\.tables/i.test(sql)) {
      return {
        rows: [
          { schema_name: 'public', table_name: 'wide_one', total_count: 3 },
          { schema_name: 'public', table_name: 'wide_two', total_count: 3 },
          { schema_name: 'public', table_name: 'sentinel', total_count: 3 },
        ],
      }
    }
    return { rows: [{ schema_name: 'public', routine_name: 'refresh_cache', routine_type: 'PROCEDURE', total_count: 1 }] }
  }

  const page = await inspectRemoteSchemaPage({ driver: 'postgres' }, { offset: 0, limit: 2 }, execute)

  assert.deepEqual(page.tables, [
    { name: 'public.wide_one', columns: [], primaryKey: [] },
    { name: 'public.wide_two', columns: [], primaryKey: [] },
  ])
  assert.equal(page.hasMore, true)
  assert.equal(page.nextOffset, 2)
  assert.equal(page.totalResources, 4)
  assert.equal(queries.length, 2)
  assert.ok(queries.every((sql) => !/information_schema\.columns|primary key/i.test(sql)))
})

test('legge e aggiorna una tabella SQLite solo in transazione', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  await executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT)', { confirmed: true })
  await executeQuery(workspace, connection.id, "INSERT INTO users VALUES (1, 'Ada')", { confirmed: true })
  assert.equal((await readTableRows(workspace, connection.id, 'users', { filter: 'ad' })).rows[0].name, 'Ada')
  await assert.rejects(() => updateTableRows(workspace, connection.id, 'users', [{ key: { id: 1 }, values: { name: 'Grace' } }]), /Transazione attiva richiesta/)
  await beginTransaction(workspace, connection.id)
  await updateTableRows(workspace, connection.id, 'users', [{ key: { id: 1 }, values: { name: 'Grace' } }])
  await rollbackTransaction(workspace, connection.id)
  assert.equal((await readTableRows(workspace, connection.id, 'users')).rows[0].name, 'Ada')
})

test('annulla l intero salvataggio griglia se una riga non è più disponibile', async (t) => {
  const { workspace, sqlitePath } = withTemporaryDatabase(t)
  const connection = createConnection(workspace, { name: 'Locale', driver: 'sqlite', sqlitePath })
  await executeQuery(workspace, connection.id, 'CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT)', { confirmed: true })
  await executeQuery(workspace, connection.id, "INSERT INTO users VALUES (1, 'Ada')", { confirmed: true })
  await beginTransaction(workspace, connection.id)

  await assert.rejects(() => updateTableRows(workspace, connection.id, 'users', [
    { key: { id: 1 }, values: { name: 'Grace' } },
    { key: { id: 99 }, values: { name: 'Lin' } },
  ]), /riga è cambiata o non è più disponibile/)

  assert.equal((await readTableRows(workspace, connection.id, 'users')).rows[0].name, 'Ada')
  await rollbackTransaction(workspace, connection.id)
})

test('valida la configurazione dei driver remoti senza costruire URL', () => {
  assert.throws(() => validateConnectionConfig({ driver: 'postgres', host: '', port: 5432, database: 'app', user: 'u', password: 'p' }), /Host non valido/)
  assert.equal(buildDriverConfig({ driver: 'mysql', host: '127.0.0.1', port: 3306, database: 'app', user: 'u', password: 'p' }).port, 3306)
  assert.match(limitRemoteReadSql('SELECT id FROM items', 500, 'SELECT', 'postgres'), /LIMIT 501 OFFSET 500/)
  assert.match(limitRemoteReadSql('SELECT id FROM items', 0, 'SELECT', 'mssql'), /OFFSET 0 ROWS FETCH NEXT 501 ROWS ONLY/)
})

test('ordina i parametri della pagina SQL Server come OFFSET e FETCH', () => {
  assert.deepEqual(tablePageParameters('mssql', 100, 0), [0, 101])
  assert.deepEqual(tablePageParameters('postgres', 100, 25), [101, 25])
})

test('avvia esplicitamente la connessione SQL Server prima di attenderne l esito', async () => {
  class FakeMssqlConnection extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
      this.connectCalls = 0
    }

    connect() {
      this.connectCalls += 1
      queueMicrotask(() => this.emit('connect'))
    }
  }

  const connection = await openMssqlConnection({
    server: 'db.internal',
    authentication: { type: 'default', options: { userName: 'user', password: 'password' } },
    options: { port: 1433, database: 'app' },
  }, FakeMssqlConnection)

  assert.equal(connection.connectCalls, 1)
})

test('l apertura SQL Server termina se il client viene chiuso durante connect', async () => {
  class FakeMssqlConnection extends EventEmitter {
    connect() {}

    close() {
      queueMicrotask(() => this.emit('end'))
    }
  }

  let candidate
  const opening = openMssqlConnection({ server: 'db.internal', options: {} }, FakeMssqlConnection, (instance) => { candidate = instance })
  candidate.close()

  await assert.rejects(opening, /chiusa durante l’apertura/)
})

test('serializza le richieste SQL Server sulla stessa sessione e prosegue dopo un errore', async () => {
  const session = { driver: 'mssql' }
  const events = []
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  const first = enqueueRemoteOperation(session, async () => {
    events.push('first:start')
    await firstGate
    events.push('first:end')
    throw new Error('errore atteso')
  })
  const second = enqueueRemoteOperation(session, async () => {
    events.push('second:start')
    return 'ok'
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first:start'])
  releaseFirst()
  await assert.rejects(first, /errore atteso/)
  assert.equal(await second, 'ok')
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start'])
})

test('usa il transaction manager nativo di tedious per le transazioni SQL Server', async () => {
  const calls = []
  const session = {
    driver: 'mssql',
    client: {
      beginTransaction(callback) {
        calls.push('begin')
        queueMicrotask(() => callback())
      },
      commitTransaction(callback) {
        calls.push('commit')
        queueMicrotask(() => callback())
      },
      rollbackTransaction(callback) {
        calls.push('rollback')
        queueMicrotask(() => callback())
      },
    },
  }

  await runMssqlTransactionOperation(session, 'begin')
  await runMssqlTransactionOperation(session, 'commit')
  await runMssqlTransactionOperation(session, 'rollback')

  assert.deepEqual(calls, ['begin', 'commit', 'rollback'])
})

test('normalizza anche gli errori del transaction manager SQL Server', async () => {
  const driverError = Object.assign(new Error("Violation of UNIQUE KEY constraint 'private-key'"), { number: 2627 })
  const session = {
    driver: 'mssql',
    client: {
      beginTransaction(callback) {
        queueMicrotask(() => callback(driverError))
      },
    },
  }

  await assert.rejects(
    runMssqlTransactionOperation(session, 'begin'),
    (error) => (
      error.publicCode === 'DATABASE_CONSTRAINT_VIOLATION'
      && error.databaseKind === 'constraint'
      && !error.message.includes('private-key')
      && !error.databaseDiagnostic.includes('private-key')
    ),
  )
})

test('rende single-flight due aperture remote concorrenti senza perdere client', async () => {
  const connected = deferred()
  const candidateReady = deferred()
  const closed = []
  let openCalls = 0
  const registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 100,
    closeSession: async (session) => { closed.push(session.id) },
  })
  const open = async ({ setCandidate }) => {
    openCalls += 1
    const session = { id: `client-${openCalls}` }
    setCandidate(session)
    candidateReady.resolve()
    await connected.promise
    return session
  }

  const first = registry.acquire('workspace-a\u0000connection-1', open)
  const second = registry.acquire('workspace-a\u0000connection-1', open)
  await candidateReady.promise
  assert.equal(openCalls, 1)

  connected.resolve()
  const [firstSession, secondSession] = await Promise.all([first, second])
  assert.equal(firstSession, secondSession)
  assert.equal(registry.has('workspace-a\u0000connection-1'), true)

  await registry.close('workspace-a\u0000connection-1')
  assert.deepEqual(closed, ['client-1'])
})

test('close durante connect invalida l apertura e attende il cleanup asincrono', async () => {
  const connected = deferred()
  const candidateReady = deferred()
  const closeStarted = deferred()
  const allowClose = deferred()
  const events = []
  const registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 250,
    closeSession: async (session) => {
      events.push(`close:${session.id}:start`)
      closeStarted.resolve()
      await allowClose.promise
      events.push(`close:${session.id}:end`)
    },
  })
  const opening = registry.acquire('workspace-a\u0000connection-2', async ({ setCandidate }) => {
    const session = { id: 'opening-client' }
    setCandidate(session)
    candidateReady.resolve()
    await connected.promise
    return session
  })
  await candidateReady.promise

  let closeSettled = false
  const closing = registry.close('workspace-a\u0000connection-2').then(() => { closeSettled = true })
  await closeStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(closeSettled, false)

  connected.resolve()
  allowClose.resolve()
  await closing
  await assert.rejects(opening, /chiusa durante la connessione/)
  assert.deepEqual(events, ['close:opening-client:start', 'close:opening-client:end'])
  assert.equal(registry.has('workspace-a\u0000connection-2'), false)

  const recovered = await registry.acquire('workspace-a\u0000connection-2', async ({ setCandidate }) => {
    const session = { id: 'recovered-client' }
    setCandidate(session)
    return session
  })
  assert.equal(recovered.id, 'recovered-client')
  await registry.close('workspace-a\u0000connection-2')
})

test('un evento driver durante connect invalida l apertura e conserva il failure pubblico', async () => {
  const key = 'workspace-a\u0000connection-opening-failure'
  const connected = deferred()
  const candidateReady = deferred()
  const client = new EventEmitter()
  let endCalls = 0
  client.end = () => {
    endCalls += 1
    return Promise.resolve()
  }
  let registry
  const lifecycle = createRemoteSessionLifecycleController({
    closeSession: (sessionKey) => registry.close(sessionKey),
  })
  registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 100,
    closeSession: disposeRemoteSession,
  })

  const opening = registry.acquire(key, async ({ setCandidate }) => {
    const session = { driver: 'postgres', client }
    setCandidate(session)
    lifecycle.track(key, session)
    candidateReady.resolve()
    await connected.promise
    return session
  })
  await candidateReady.promise

  const connectionError = Object.assign(new Error('socket hang up password=opening-secret'), { code: 'ECONNRESET' })
  assert.doesNotThrow(() => client.emit('error', connectionError))
  connected.resolve()
  await assert.rejects(opening, /chiusa durante la connessione/)

  assert.equal(registry.has(key), false)
  assert.equal(endCalls, 1)
  assert.equal(client.listenerCount('error'), 0)
  const nextRequestFailure = lifecycle.consumeFailure(key)
  assert.equal(nextRequestFailure.publicCode, 'DATABASE_NETWORK_CONNECTION_LOST')
  assert.doesNotMatch(nextRequestFailure.databaseDiagnostic, /opening-secret/iu)
})

test('un errore di apertura pulisce il candidato e consente il recovery', async () => {
  const closed = []
  let attempts = 0
  const registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 100,
    closeSession: async (session) => { closed.push(session.id) },
  })
  const open = async ({ setCandidate }) => {
    attempts += 1
    const session = { id: `attempt-${attempts}` }
    setCandidate(session)
    if (attempts === 1) throw new Error('connect failed')
    return session
  }

  await assert.rejects(() => registry.acquire('workspace-a\u0000connection-3', open), /connect failed/)
  assert.deepEqual(closed, ['attempt-1'])
  assert.equal((await registry.acquire('workspace-a\u0000connection-3', open)).id, 'attempt-2')
  assert.equal(attempts, 2)
  await registry.close('workspace-a\u0000connection-3')
})

test('cleanup workspace attende i client del solo workspace selezionato', async () => {
  const gates = new Map([
    ['a-1', deferred()],
    ['a-2', deferred()],
    ['b-1', deferred()],
  ])
  const closeStarted = []
  const registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 250,
    closeSession: async (session) => {
      closeStarted.push(session.id)
      await gates.get(session.id).promise
    },
  })
  const openSession = (id) => registry.acquire(id.startsWith('a-') ? `workspace-a\u0000${id}` : `workspace-b\u0000${id}`, async ({ setCandidate }) => {
    const session = { id }
    setCandidate(session)
    return session
  })
  await Promise.all(['a-1', 'a-2', 'b-1'].map(openSession))

  let cleanupSettled = false
  const cleanup = registry.closeMatching((key) => key.startsWith('workspace-a\u0000')).then(() => { cleanupSettled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(closeStarted.sort(), ['a-1', 'a-2'])
  assert.equal(cleanupSettled, false)

  gates.get('a-1').resolve()
  gates.get('a-2').resolve()
  await cleanup
  assert.equal(registry.has('workspace-a\u0000a-1'), false)
  assert.equal(registry.has('workspace-a\u0000a-2'), false)
  assert.equal(registry.has('workspace-b\u0000b-1'), true)
  gates.get('b-1').resolve()
  await registry.closeMatching(() => true)
})

test('i client remoti confinano error, end e close e rendono il failure disponibile alla richiesta successiva', async () => {
  const driverCases = [
    { driver: 'postgres', failureEvent: 'error' },
    { driver: 'mysql', failureEvent: 'end' },
    { driver: 'mssql', failureEvent: 'close' },
  ]

  for (const { driver, failureEvent } of driverCases) {
    const emitter = new EventEmitter()
    const key = `workspace-a\u0000${driver}`
    const invalidations = []
    let driverCloseCalls = 0
    let controllerCloseCalls = 0
    let closePromise
    let session

    if (driver === 'postgres') {
      emitter.end = () => {
        driverCloseCalls += 1
        emitter.emit('error', new Error('late teardown error password=late-secret'))
        return Promise.resolve()
      }
      session = { driver, client: emitter }
    } else if (driver === 'mysql') {
      const client = {
        connection: emitter,
        end() {
          driverCloseCalls += 1
          emitter.emit('error', new Error('late teardown error token=late-token'))
          return Promise.resolve()
        },
      }
      session = { driver, client }
    } else {
      emitter.close = () => {
        driverCloseCalls += 1
        queueMicrotask(() => emitter.emit('end'))
      }
      session = { driver, client: emitter }
    }

    const controller = createRemoteSessionLifecycleController({
      closeSession: () => {
        controllerCloseCalls += 1
        closePromise = disposeRemoteSession(session)
        return closePromise
      },
      invalidateSchema: (invalidatedKey) => invalidations.push(invalidatedKey),
    })
    controller.track(key, session)
    for (const event of ['error', 'end', 'close']) assert.equal(emitter.listenerCount(event), 1)

    const driverError = Object.assign(new Error('socket hang up host=private-db.internal password=session-secret'), { code: 'ECONNRESET' })
    assert.doesNotThrow(() => emitter.emit(failureEvent, failureEvent === 'error' ? driverError : undefined))
    assert.equal(controller.hasFailure(key), true)
    // Gli eventi successivi appartengono allo stesso teardown: vengono assorbiti
    // e non causano una seconda invalidazione o un uncaught EventEmitter error.
    assert.doesNotThrow(() => emitter.emit('error', new Error('secondary failure password=secondary-secret')))
    emitter.emit('end')
    emitter.emit('close')

    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(closePromise)
    assert.equal(disposeRemoteSession(session), closePromise)
    await closePromise
    assert.equal(controllerCloseCalls, 1)
    assert.equal(driverCloseCalls, 1)
    assert.deepEqual(invalidations, [key])
    for (const event of ['error', 'end', 'close']) assert.equal(emitter.listenerCount(event), 0)

    const nextRequestFailure = controller.consumeFailure(key)
    assert.equal(nextRequestFailure.publicCode, 'DATABASE_NETWORK_CONNECTION_LOST')
    assert.equal(nextRequestFailure.databaseKind, 'connection-lost')
    assert.doesNotMatch(nextRequestFailure.databaseDiagnostic, /private-db|session-secret/iu)
    assert.equal(controller.consumeFailure(key), null)
  }
})

test('attende end e l evento end dei driver remoti durante la chiusura', async () => {
  const postgresEnded = deferred()
  let postgresEndCalls = 0
  const postgresClosing = disposeRemoteSession({
    driver: 'postgres',
    client: {
      end() {
        postgresEndCalls += 1
        return postgresEnded.promise
      },
    },
  })
  let postgresSettled = false
  void postgresClosing.then(() => { postgresSettled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(postgresSettled, false)
  postgresEnded.resolve()
  await postgresClosing
  assert.equal(postgresEndCalls, 1)

  const mssqlClient = new EventEmitter()
  let mssqlCloseCalls = 0
  mssqlClient.close = () => { mssqlCloseCalls += 1 }
  const mssqlClosing = disposeRemoteSession({ driver: 'mssql', client: mssqlClient })
  let mssqlSettled = false
  void mssqlClosing.then(() => { mssqlSettled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(mssqlSettled, false)
  mssqlClient.emit('end')
  await mssqlClosing
  assert.equal(mssqlCloseCalls, 1)
})

test('usa il fallback forzato se la chiusura remota supera il limite', async () => {
  let destroyCalls = 0
  const registry = createDatabaseSessionRegistry({
    cleanupTimeoutMs: 20,
    closeSession: () => new Promise(() => undefined),
    forceCloseSession: () => { destroyCalls += 1 },
  })
  await registry.acquire('workspace-a\u0000connection-stuck', async ({ setCandidate }) => {
    const session = { id: 'stuck' }
    setCandidate(session)
    return session
  })

  await registry.close('workspace-a\u0000connection-stuck')
  assert.equal(destroyCalls, 1)
})
