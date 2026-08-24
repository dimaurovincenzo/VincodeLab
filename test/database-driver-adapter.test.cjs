const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createDatabaseDriverPort } = require('../electron/domains/database/database-driver.port.cjs')
const { createNodeDatabaseDriverAdapter } = require('../electron/infrastructure/database/node-database-driver.adapter.cjs')

test('la porta database rifiuta implementazioni incomplete ed espone solo il contratto minimo', () => {
  assert.throws(() => createDatabaseDriverPort({}), /Porta driver database incompleta/u)

  const implementation = {
    createMssqlConnection() {},
    createMysqlClient() {},
    createPostgresClient() {},
    executeRemote() {},
    executeTransaction() {},
    dettaglioAdapter: 'non pubblico',
  }
  const port = createDatabaseDriverPort(implementation)

  assert.equal(Object.isFrozen(port), true)
  assert.deepEqual(Object.keys(port), [
    'createMssqlConnection',
    'createMysqlClient',
    'createPostgresClient',
    'executeRemote',
    'executeTransaction',
  ])
  assert.equal('dettaglioAdapter' in port, false)
})

test('l adapter Node carica ogni driver solo al primo utilizzo', async () => {
  const loads = { mssql: 0, mysql: 0, postgres: 0 }
  class FakePostgresClient {
    constructor(config) { this.config = config }

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
  class FakeMssqlConnection {
    constructor(config) { this.config = config }
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
  const postgresClient = adapter.createPostgresClient({ host: 'postgres.internal' })
  assert.deepEqual(postgresClient.config, { host: 'postgres.internal' })
  const postgresRows = []
  assert.deepEqual(await adapter.executeRemote(
    { driver: 'postgres', client: postgresClient },
    { sql: 'SELECT 1', onRow: (row) => postgresRows.push(row) },
  ), { affectedRows: null })
  assert.deepEqual(postgresRows, [{ id: 1 }])
  assert.equal(loads.postgres, 1)
  assert.deepEqual((await adapter.createMysqlClient({ host: 'mysql.internal' })).config, { host: 'mysql.internal' })
  assert.equal(loads.mysql, 1)

  const connection = adapter.createMssqlConnection({ server: 'mssql.internal' })
  const mssqlRows = []
  const mssqlResult = await adapter.executeRemote({
    driver: 'mssql',
    client: {
      execSql(request) {
        request.emit('row', [{ metadata: { colName: 'id' }, value: 42 }])
        request.emit('doneInProc', 1)
        request.callback(undefined, 1)
      },
    },
  }, {
    sql: 'SELECT @p0',
    parameters: [42, 'testo'],
    timeoutMs: 1_000,
    onRow: (row) => mssqlRows.push(row),
  })

  assert.deepEqual(connection.config, { server: 'mssql.internal' })
  assert.deepEqual(requests[0].parameters, [['p0', types.Int, 42], ['p1', types.NVarChar, 'testo']])
  assert.equal(requests[0].timeoutMs, 1_000)
  assert.deepEqual(mssqlRows, [{ id: 42 }])
  assert.deepEqual(mssqlResult, { affectedRows: 1 })
  assert.equal(loads.mssql, 1)
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
