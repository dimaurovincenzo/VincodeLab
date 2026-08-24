const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createDatabaseDriverPort } = require('../electron/domains/database/database-driver.port.cjs')
const { createNodeDatabaseDriverAdapter } = require('../electron/infrastructure/database/node-database-driver.adapter.cjs')

test('la porta database rifiuta implementazioni incomplete ed espone solo il contratto minimo', () => {
  assert.throws(() => createDatabaseDriverPort({}), /Porta driver database incompleta/u)

  const implementation = {
    executeRemote() {},
    executeTransaction() {},
    openRemoteSession() {},
    dettaglioAdapter: 'non pubblico',
  }
  const port = createDatabaseDriverPort(implementation)

  assert.equal(Object.isFrozen(port), true)
  assert.deepEqual(Object.keys(port), [
    'executeRemote',
    'executeTransaction',
    'openRemoteSession',
  ])
  assert.equal('dettaglioAdapter' in port, false)
})

test('l adapter Node carica ogni driver solo al primo utilizzo', async () => {
  const loads = { mssql: 0, mysql: 0, postgres: 0 }
  let postgresCandidate
  let postgresCandidateCalls = 0
  class FakePostgresClient {
    constructor(config) { this.config = config }

    async connect() { assert.equal(postgresCandidate, this) }

    query(query) {
      queueMicrotask(() => {
        query.emit('row', { id: 1 })
        query.emit('end', { command: 'SELECT', rowCount: 1 })
      })
      return query
    }
  }
  class FakePostgresQuery extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
    }
  }
  let mssqlCandidate
  let mssqlCandidateCalls = 0
  class FakeMssqlConnection extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
      this.connectCalls = 0
    }

    connect() {
      this.connectCalls += 1
      assert.equal(mssqlCandidate, this)
      queueMicrotask(() => this.emit('connect'))
    }

    execSql(request) {
      request.emit('row', [{ metadata: { colName: 'id' }, value: 42 }])
      request.emit('doneInProc', 1)
      request.callback(undefined, 1)
    }
  }
  const requests = []
  class FakeMssqlRequest extends EventEmitter {
    constructor(sql, callback) {
      super()
      this.callback = callback
      this.parameters = []
      this.sql = sql
      requests.push(this)
    }

    addParameter(...parameter) { this.parameters.push(parameter) }
    setTimeout(timeoutMs) { this.timeoutMs = timeoutMs }
  }
  const types = { Bit: Symbol('bit'), Float: Symbol('float'), Int: Symbol('int'), NVarChar: Symbol('nvarchar') }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => {
      loads.mssql += 1
      return { Connection: FakeMssqlConnection, Request: FakeMssqlRequest, TYPES: types }
    },
    loadMysql: () => {
      loads.mysql += 1
      return { createConnection: async (config) => ({ config }) }
    },
    loadPostgres: () => {
      loads.postgres += 1
      return { Client: FakePostgresClient, Query: FakePostgresQuery }
    },
  })

  assert.deepEqual(loads, { mssql: 0, mysql: 0, postgres: 0 })
  const postgresClient = await adapter.openRemoteSession({
    database: 'app',
    driver: 'postgres',
    host: 'postgres.internal',
    password: 'secret',
    port: 5432,
    user: 'developer',
  }, { onCandidate: (client) => {
    postgresCandidateCalls += 1
    postgresCandidate = client
  } })
  assert.deepEqual(postgresClient.config, {
    connectionTimeoutMillis: 10_000,
    database: 'app',
    host: 'postgres.internal',
    password: 'secret',
    port: 5432,
    query_timeout: 30_000,
    user: 'developer',
  })
  const postgresRows = []
  assert.deepEqual(await adapter.executeRemote(
    { driver: 'postgres', client: postgresClient },
    { sql: 'SELECT 1', onRow: (row) => postgresRows.push(row) },
  ), { affectedRows: null })
  assert.deepEqual(postgresRows, [{ id: 1 }])
  assert.equal(postgresCandidateCalls, 1)
  assert.equal(loads.postgres, 1)
  const mysqlCandidates = []
  const mysqlClient = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mysql',
    host: 'mysql.internal',
    password: 'secret',
    port: 3306,
    user: 'developer',
  }, { onCandidate: (client) => mysqlCandidates.push(client) })
  assert.deepEqual(mysqlClient.config, {
    connectTimeout: 10_000,
    database: 'app',
    host: 'mysql.internal',
    password: 'secret',
    port: 3306,
    user: 'developer',
  })
  assert.deepEqual(mysqlCandidates, [mysqlClient])
  assert.equal(loads.mysql, 1)

  const connection = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mssql',
    host: 'mssql.internal',
    password: 'secret',
    port: 1433,
    user: 'developer',
  }, { onCandidate: (client) => {
    mssqlCandidateCalls += 1
    mssqlCandidate = client
  } })
  const mssqlRows = []
  const mssqlResult = await adapter.executeRemote({
    driver: 'mssql',
    client: connection,
  }, {
    sql: 'SELECT @p0',
    parameters: [42, 'testo'],
    timeoutMs: 1_000,
    onRow: (row) => mssqlRows.push(row),
  })

  assert.deepEqual(connection.config, {
    authentication: { type: 'default', options: { password: 'secret', userName: 'developer' } },
    options: {
      connectTimeout: 10_000,
      database: 'app',
      port: 1433,
      requestTimeout: 30_000,
      trustServerCertificate: true,
    },
    server: 'mssql.internal',
  })
  assert.equal(connection.connectCalls, 1)
  assert.equal(mssqlCandidateCalls, 1)
  assert.deepEqual(requests[0].parameters, [['p0', types.Int, 42], ['p1', types.NVarChar, 'testo']])
  assert.equal(requests[0].timeoutMs, 1_000)
  assert.deepEqual(mssqlRows, [{ id: 42 }])
  assert.deepEqual(mssqlResult, { affectedRows: 1 })
  assert.equal(loads.mssql, 1)
})

test('SQL Server pubblica il candidato prima del connect e pulisce i listener se l apertura termina', async () => {
  class ClosingConnection extends EventEmitter {
    constructor() {
      super()
      this.connectCalls = 0
    }

    connect() { this.connectCalls += 1 }
    close() { this.emit('end') }
  }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({ Connection: ClosingConnection }),
  })
  let candidate
  const opening = adapter.openRemoteSession({
    database: 'app',
    driver: 'mssql',
    host: 'mssql.internal',
    password: 'secret',
    port: 1433,
    user: 'developer',
  }, { onCandidate: (client) => {
    candidate = client
    client.close()
  } })

  assert.ok(candidate instanceof ClosingConnection)
  await assert.rejects(opening, /chiusa durante l’apertura/u)
  assert.equal(candidate.connectCalls, 0)
  assert.equal(candidate.listenerCount('connect'), 0)
  assert.equal(candidate.listenerCount('end'), 0)
  assert.equal(candidate.listenerCount('error'), 0)
})

test('il connect SQL Server ignora segnali successivi al primo settlement', async () => {
  class NoisyConnection extends EventEmitter {
    constructor() {
      super()
      this.removeCalls = 0
      this.removeCallsAfterConnect = 0
    }

    connect() {
      this.emit('connect')
      this.removeCallsAfterConnect = this.removeCalls
      throw new Error('late connect failure')
    }

    removeListener(...args) {
      this.removeCalls += 1
      return super.removeListener(...args)
    }
  }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({ Connection: NoisyConnection }),
  })
  let candidateCalls = 0
  const client = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mssql',
    host: 'mssql.internal',
    password: 'secret',
    port: 1433,
    user: 'developer',
  }, { onCandidate: () => { candidateCalls += 1 } })

  assert.equal(candidateCalls, 1)
  assert.equal(client.removeCalls, client.removeCallsAfterConnect)
  assert.equal(client.listenerCount('connect'), 0)
  assert.equal(client.listenerCount('end'), 0)
  assert.equal(client.listenerCount('error'), 0)
})

test('un failure di onCandidate chiude il client senza avviare il connect', async () => {
  const callbackFailure = new Error('candidate callback failed')
  const postgresClient = {
    connectCalls: 0,
    endCalls: 0,
    async connect() { this.connectCalls += 1 },
    async end() { this.endCalls += 1 },
  }
  const mysqlClient = {
    endCalls: 0,
    async end() { this.endCalls += 1 },
  }
  class MssqlConnection extends EventEmitter {
    constructor() {
      super()
      this.closeCalls = 0
      this.connectCalls = 0
    }

    close() { this.closeCalls += 1 }
    connect() { this.connectCalls += 1 }
  }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({ Connection: MssqlConnection }),
    loadMysql: () => ({ createConnection: async () => mysqlClient }),
    loadPostgres: () => ({ Client: class { constructor() { return postgresClient } } }),
  })
  const config = {
    database: 'app',
    host: 'database.internal',
    password: 'secret',
    port: 1234,
    user: 'developer',
  }
  const rejectCandidate = () => { throw callbackFailure }

  await assert.rejects(adapter.openRemoteSession({ ...config, driver: 'postgres' }, { onCandidate: rejectCandidate }), (error) => error === callbackFailure)
  await assert.rejects(adapter.openRemoteSession({ ...config, driver: 'mysql' }, { onCandidate: rejectCandidate }), (error) => error === callbackFailure)
  let mssqlCandidate
  await assert.rejects(adapter.openRemoteSession({ ...config, driver: 'mssql' }, {
    onCandidate: (client) => {
      mssqlCandidate = client
      rejectCandidate()
    },
  }), (error) => error === callbackFailure)

  assert.deepEqual({ connectCalls: postgresClient.connectCalls, endCalls: postgresClient.endCalls }, { connectCalls: 0, endCalls: 1 })
  assert.equal(mysqlClient.endCalls, 1)
  assert.deepEqual({ closeCalls: mssqlCandidate.closeCalls, connectCalls: mssqlCandidate.connectCalls }, { closeCalls: 1, connectCalls: 0 })
})

test('PostgreSQL interrompe budget e abort invalidando la sessione una sola volta', async () => {
  class FakeQuery extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
    }
  }
  let activeQuery
  const session = {
    driver: 'postgres',
    client: {
      query(query) {
        activeQuery = query
        return query
      },
    },
  }
  const adapter = createNodeDatabaseDriverAdapter({ loadPostgres: () => ({ Query: FakeQuery }) })
  const budgetFailure = Object.assign(new Error('database_result_too_large'), { code: 'DATABASE_RESULT_TOO_LARGE' })
  const budgetInvalidations = []
  let collectedRows = 0
  const budgetPending = adapter.executeRemote(session, {
    sql: 'SELECT payload FROM fixture',
    onInvalidate: (error) => budgetInvalidations.push(error),
    onRow: () => {
      collectedRows += 1
      throw budgetFailure
    },
  })
  activeQuery.emit('row', { payload: 'first' })
  activeQuery.emit('row', { payload: 'ignored-after-budget' })

  await assert.rejects(budgetPending, (error) => error === budgetFailure)
  assert.equal(collectedRows, 1)
  assert.deepEqual(budgetInvalidations, [budgetFailure])

  const controller = new AbortController()
  const abortInvalidations = []
  const abortPending = adapter.executeRemote(session, {
    sql: 'SELECT pg_sleep(30)',
    signal: controller.signal,
    onInvalidate: (error) => abortInvalidations.push(error),
  })
  controller.abort()
  controller.abort()

  await assert.rejects(abortPending, (error) => error?.name === 'AbortError')
  assert.equal(abortInvalidations.length, 1)
  assert.equal(abortInvalidations[0].name, 'AbortError')
})

test('MySQL distingue righe affectedRows e invalida una sola volta su budget e abort', async () => {
  let activeCommand
  const rawClient = {
    query() {
      activeCommand = new EventEmitter()
      return activeCommand
    },
  }
  const session = { driver: 'mysql', client: { connection: rawClient } }
  const adapter = createNodeDatabaseDriverAdapter()

  const selectedRows = []
  const selectPending = adapter.executeRemote(session, {
    sql: 'SELECT affectedRows FROM fixture',
    onRow: (row) => selectedRows.push(row),
  })
  activeCommand.emit('fields', [{ name: 'affectedRows' }])
  activeCommand.emit('result', { affectedRows: 7, label: 'riga utente' })
  activeCommand.emit('end')
  assert.deepEqual(await selectPending, { affectedRows: null })
  assert.deepEqual(selectedRows, [{ affectedRows: 7, label: 'riga utente' }])

  const mutationRows = []
  const mutationPending = adapter.executeRemote(session, {
    sql: 'UPDATE fixture SET active = 1',
    onRow: (row) => mutationRows.push(row),
  })
  activeCommand.emit('result', { affectedRows: 3 })
  activeCommand.emit('end')
  assert.deepEqual(await mutationPending, { affectedRows: 3 })
  assert.deepEqual(mutationRows, [])

  const budgetFailure = Object.assign(new Error('database_result_too_large'), { code: 'DATABASE_RESULT_TOO_LARGE' })
  const budgetInvalidations = []
  let collectedRows = 0
  const budgetPending = adapter.executeRemote(session, {
    sql: 'SELECT payload FROM fixture',
    onInvalidate: (error) => budgetInvalidations.push(error),
    onRow: () => {
      collectedRows += 1
      throw budgetFailure
    },
  })
  activeCommand.emit('fields', [{ name: 'payload' }])
  activeCommand.emit('result', { payload: 'first' })
  activeCommand.emit('result', { payload: 'ignored-after-budget' })
  await assert.rejects(budgetPending, (error) => error === budgetFailure)
  assert.equal(collectedRows, 1)
  assert.deepEqual(budgetInvalidations, [budgetFailure])

  const controller = new AbortController()
  const abortInvalidations = []
  const abortPending = adapter.executeRemote(session, {
    sql: 'SELECT SLEEP(30)',
    signal: controller.signal,
    onInvalidate: (error) => abortInvalidations.push(error),
  })
  controller.abort()
  controller.abort()
  await assert.rejects(abortPending, (error) => error?.name === 'AbortError')
  assert.equal(abortInvalidations.length, 1)
  assert.equal(abortInvalidations[0].name, 'AbortError')
})

test('SQL Server inoltra abort a Request.cancel senza invalidare l intera sessione', async () => {
  let activeRequest
  class FakeRequest extends EventEmitter {
    constructor(_sql, callback) {
      super()
      this.callback = callback
      this.cancelCalls = 0
      activeRequest = this
    }

    addParameter() {}
    cancel() { this.cancelCalls += 1 }
    setTimeout() {}
  }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({
      Request: FakeRequest,
      TYPES: { Bit: {}, Float: {}, Int: {}, NVarChar: {} },
    }),
  })
  const controller = new AbortController()
  const invalidations = []
  const pending = adapter.executeRemote({ driver: 'mssql', client: { execSql() {} } }, {
    sql: 'WAITFOR DELAY',
    signal: controller.signal,
    onInvalidate: (error) => invalidations.push(error),
  })
  controller.abort()
  controller.abort()

  await assert.rejects(pending, (error) => error?.name === 'AbortError')
  assert.equal(activeRequest.cancelCalls, 1)
  assert.deepEqual(invalidations, [])
})

test('PostgreSQL traduce le operazioni transazionali semantiche in query sulla stessa sessione', async () => {
  const queries = []
  const adapter = createNodeDatabaseDriverAdapter()
  const session = {
    driver: 'postgres',
    client: {
      async query(sql) { queries.push(sql) },
    },
  }

  await adapter.executeTransaction(session, 'begin')
  await adapter.executeTransaction(session, 'commit')
  await adapter.executeTransaction(session, 'rollback')

  assert.deepEqual(queries, ['BEGIN', 'COMMIT', 'ROLLBACK'])
})

test('MySQL usa il transaction manager promise per begin commit e rollback', async () => {
  const calls = []
  const adapter = createNodeDatabaseDriverAdapter()
  const session = {
    driver: 'mysql',
    client: {
      async beginTransaction() { calls.push('begin') },
      async commit() { calls.push('commit') },
      async rollback() { calls.push('rollback') },
    },
  }

  await adapter.executeTransaction(session, 'begin')
  await adapter.executeTransaction(session, 'commit')
  await adapter.executeTransaction(session, 'rollback')

  assert.deepEqual(calls, ['begin', 'commit', 'rollback'])
})

test('SQL Server confina i callback tedious e propaga il failure originale', async () => {
  const calls = []
  const driverError = Object.assign(new Error('transaction rejected'), { number: 2627 })
  const adapter = createNodeDatabaseDriverAdapter()
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
        queueMicrotask(() => callback(driverError))
      },
    },
  }

  await adapter.executeTransaction(session, 'begin')
  await adapter.executeTransaction(session, 'commit')
  await assert.rejects(adapter.executeTransaction(session, 'rollback'), (error) => error === driverError)

  assert.deepEqual(calls, ['begin', 'commit', 'rollback'])
  assert.throws(() => adapter.executeTransaction(session, 'savepoint'), /Operazione transazionale database non valida/u)
  assert.throws(() => adapter.executeTransaction(session, 'toString'), /Operazione transazionale database non valida/u)
})
