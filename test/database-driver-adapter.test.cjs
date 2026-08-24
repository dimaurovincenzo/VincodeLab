const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createDatabaseDriverPort } = require('../electron/domains/database/database-driver.port.cjs')
const { createNodeDatabaseDriverAdapter } = require('../electron/infrastructure/database/node-database-driver.adapter.cjs')

function remoteConfig(driver) {
  return { database: 'app', driver, host: 'database.internal', password: 'secret', port: 1234, user: 'developer' }
}

test('la porta database rifiuta implementazioni incomplete ed espone solo il contratto minimo', () => {
  assert.throws(() => createDatabaseDriverPort({}), /Porta driver database incompleta/u)

  const implementation = {
    closeRemoteSession() {},
    executeRemote() {},
    executeTransaction() {},
    forceCloseRemoteSession() {},
    openRemoteSession() {},
    subscribeRemoteFailure() {},
    dettaglioAdapter: 'non pubblico',
  }
  const port = createDatabaseDriverPort(implementation)

  assert.equal(Object.isFrozen(port), true)
  assert.deepEqual(Object.keys(port), [
    'closeRemoteSession',
    'executeRemote',
    'executeTransaction',
    'forceCloseRemoteSession',
    'openRemoteSession',
    'subscribeRemoteFailure',
  ])
  assert.equal('dettaglioAdapter' in port, false)
})

test('l adapter Node carica ogni driver solo al primo utilizzo', async () => {
  const loads = { mssql: 0, mysql: 0, postgres: 0 }
  let mysqlClient
  let postgresCandidate
  let postgresCandidateCalls = 0
  let postgresClient
  class FakePostgresClient {
    constructor(config) {
      this.config = config
      postgresClient = this
    }

    async connect() { assert.ok(postgresCandidate) }

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
  let mssqlConnection
  class FakeMssqlConnection extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
      this.connectCalls = 0
      mssqlConnection = this
    }

    connect() {
      this.connectCalls += 1
      assert.ok(mssqlCandidate)
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
      return { createConnection: async (config) => {
        mysqlClient = Object.assign(new EventEmitter(), { config })
        return mysqlClient
      } }
    },
    loadPostgres: () => {
      loads.postgres += 1
      return { Client: FakePostgresClient, Query: FakePostgresQuery }
    },
  })

  assert.deepEqual(loads, { mssql: 0, mysql: 0, postgres: 0 })
  const postgresHandle = await adapter.openRemoteSession({
    database: 'app',
    driver: 'postgres',
    host: 'postgres.internal',
    password: 'secret',
    port: 5432,
    user: 'developer',
  }, { onCandidate: (handle) => {
    postgresCandidateCalls += 1
    postgresCandidate = handle
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
    postgresHandle,
    { sql: 'SELECT 1', onRow: (row) => postgresRows.push(row) },
  ), { affectedRows: null })
  assert.deepEqual(postgresRows, [{ id: 1 }])
  assert.equal(postgresCandidate, postgresHandle)
  assert.equal(Object.isFrozen(postgresHandle), true)
  assert.deepEqual(Object.keys(postgresHandle), [])
  assert.equal('client' in postgresHandle, false)
  assert.equal('connection' in postgresHandle, false)
  assert.equal(postgresCandidateCalls, 1)
  assert.equal(loads.postgres, 1)
  const mysqlCandidates = []
  const mysqlHandle = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mysql',
    host: 'mysql.internal',
    password: 'secret',
    port: 3306,
    user: 'developer',
  }, { onCandidate: (handle) => mysqlCandidates.push(handle) })
  assert.deepEqual(mysqlClient.config, {
    connectTimeout: 10_000,
    database: 'app',
    host: 'mysql.internal',
    password: 'secret',
    port: 3306,
    user: 'developer',
  })
  assert.deepEqual(mysqlCandidates, [mysqlHandle])
  assert.equal(loads.mysql, 1)

  const mssqlHandle = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mssql',
    host: 'mssql.internal',
    password: 'secret',
    port: 1433,
    user: 'developer',
  }, { onCandidate: (handle) => {
    mssqlCandidateCalls += 1
    mssqlCandidate = handle
  } })
  const mssqlRows = []
  const mssqlResult = await adapter.executeRemote(mssqlHandle, {
    sql: 'SELECT @p0',
    parameters: [42, 'testo'],
    timeoutMs: 1_000,
    onRow: (row) => mssqlRows.push(row),
  })

  assert.deepEqual(mssqlConnection.config, {
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
  assert.equal(mssqlConnection.connectCalls, 1)
  assert.equal(mssqlCandidate, mssqlHandle)
  assert.equal(mssqlCandidateCalls, 1)
  assert.deepEqual(requests[0].parameters, [['p0', types.Int, 42], ['p1', types.NVarChar, 'testo']])
  assert.equal(requests[0].timeoutMs, 1_000)
  assert.deepEqual(mssqlRows, [{ id: 42 }])
  assert.deepEqual(mssqlResult, { affectedRows: 1 })
  assert.equal(loads.mssql, 1)
})

test('SQL Server pubblica il candidato prima del connect e pulisce i listener se l apertura termina', async () => {
  let connection
  class ClosingConnection extends EventEmitter {
    constructor() {
      super()
      this.connectCalls = 0
      connection = this
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
  }, { onCandidate: (handle) => {
    candidate = handle
    void adapter.closeRemoteSession(handle)
  } })

  assert.equal(Object.isFrozen(candidate), true)
  assert.deepEqual(Object.keys(candidate), [])
  await assert.rejects(opening, /chiusa durante l’apertura/u)
  assert.equal(connection.connectCalls, 0)
  assert.equal(connection.listenerCount('connect'), 0)
  assert.equal(connection.listenerCount('end'), 0)
  assert.equal(connection.listenerCount('error'), 0)
})

test('il connect SQL Server ignora segnali successivi al primo settlement', async () => {
  let connection
  class NoisyConnection extends EventEmitter {
    constructor() {
      super()
      this.removeCalls = 0
      this.removeCallsAfterConnect = 0
      connection = this
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
  const handle = await adapter.openRemoteSession({
    database: 'app',
    driver: 'mssql',
    host: 'mssql.internal',
    password: 'secret',
    port: 1433,
    user: 'developer',
  }, { onCandidate: () => { candidateCalls += 1 } })

  assert.equal(candidateCalls, 1)
  assert.equal(Object.isFrozen(handle), true)
  assert.equal(connection.removeCalls, connection.removeCallsAfterConnect)
  assert.equal(connection.listenerCount('connect'), 0)
  assert.equal(connection.listenerCount('end'), 0)
  assert.equal(connection.listenerCount('error'), 0)
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
  let mssqlClient
  class MssqlConnection extends EventEmitter {
    constructor() {
      super()
      this.closeCalls = 0
      this.connectCalls = 0
      mssqlClient = this
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
    onCandidate: (handle) => {
      mssqlCandidate = handle
      rejectCandidate()
    },
  }), (error) => error === callbackFailure)

  assert.deepEqual({ connectCalls: postgresClient.connectCalls, endCalls: postgresClient.endCalls }, { connectCalls: 0, endCalls: 1 })
  assert.equal(mysqlClient.endCalls, 1)
  assert.equal(Object.isFrozen(mssqlCandidate), true)
  assert.deepEqual({ closeCalls: mssqlClient.closeCalls, connectCalls: mssqlClient.connectCalls }, { closeCalls: 1, connectCalls: 0 })
})

test('PostgreSQL interrompe budget e abort invalidando la sessione una sola volta', async () => {
  class FakeQuery extends EventEmitter {
    constructor(config) {
      super()
      this.config = config
    }
  }
  let activeQuery
  const client = Object.assign(new EventEmitter(), {
    async connect() {},
    query(query) {
      activeQuery = query
      return query
    },
  })
  const adapter = createNodeDatabaseDriverAdapter({
    loadPostgres: () => ({ Client: class { constructor() { return client } }, Query: FakeQuery }),
  })
  const handle = await adapter.openRemoteSession(remoteConfig('postgres'))
  const budgetFailure = Object.assign(new Error('database_result_too_large'), { code: 'DATABASE_RESULT_TOO_LARGE' })
  const budgetInvalidations = []
  let collectedRows = 0
  const budgetPending = adapter.executeRemote(handle, {
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
  const abortPending = adapter.executeRemote(handle, {
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
  const rawClient = Object.assign(new EventEmitter(), {
    query() {
      activeCommand = new EventEmitter()
      return activeCommand
    },
  })
  const client = Object.assign(new EventEmitter(), { connection: rawClient })
  const adapter = createNodeDatabaseDriverAdapter({
    loadMysql: () => ({ createConnection: async () => client }),
  })
  const handle = await adapter.openRemoteSession(remoteConfig('mysql'))

  const selectedRows = []
  const selectPending = adapter.executeRemote(handle, {
    sql: 'SELECT affectedRows FROM fixture',
    onRow: (row) => selectedRows.push(row),
  })
  activeCommand.emit('fields', [{ name: 'affectedRows' }])
  activeCommand.emit('result', { affectedRows: 7, label: 'riga utente' })
  activeCommand.emit('end')
  assert.deepEqual(await selectPending, { affectedRows: null })
  assert.deepEqual(selectedRows, [{ affectedRows: 7, label: 'riga utente' }])

  const mutationRows = []
  const mutationPending = adapter.executeRemote(handle, {
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
  const budgetPending = adapter.executeRemote(handle, {
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
  const abortPending = adapter.executeRemote(handle, {
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
  class FakeConnection extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('connect')) }
    execSql() {}
  }
  const adapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({
      Connection: FakeConnection,
      Request: FakeRequest,
      TYPES: { Bit: {}, Float: {}, Int: {}, NVarChar: {} },
    }),
  })
  const controller = new AbortController()
  const invalidations = []
  const handle = await adapter.openRemoteSession(remoteConfig('mssql'))
  const pending = adapter.executeRemote(handle, {
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
  const client = Object.assign(new EventEmitter(), {
    async connect() {},
    async query(sql) { queries.push(sql) },
  })
  const adapter = createNodeDatabaseDriverAdapter({
    loadPostgres: () => ({ Client: class { constructor() { return client } } }),
  })
  const handle = await adapter.openRemoteSession(remoteConfig('postgres'))

  await adapter.executeTransaction(handle, 'begin')
  await adapter.executeTransaction(handle, 'commit')
  await adapter.executeTransaction(handle, 'rollback')

  assert.deepEqual(queries, ['BEGIN', 'COMMIT', 'ROLLBACK'])
})

test('MySQL usa il transaction manager promise per begin commit e rollback', async () => {
  const calls = []
  const client = Object.assign(new EventEmitter(), {
    async beginTransaction() { calls.push('begin') },
    async commit() { calls.push('commit') },
    async rollback() { calls.push('rollback') },
  })
  const adapter = createNodeDatabaseDriverAdapter({
    loadMysql: () => ({ createConnection: async () => client }),
  })
  const handle = await adapter.openRemoteSession(remoteConfig('mysql'))

  await adapter.executeTransaction(handle, 'begin')
  await adapter.executeTransaction(handle, 'commit')
  await adapter.executeTransaction(handle, 'rollback')

  assert.deepEqual(calls, ['begin', 'commit', 'rollback'])
})

test('SQL Server confina i callback tedious e propaga il failure originale', async () => {
  const calls = []
  const driverError = Object.assign(new Error('transaction rejected'), { number: 2627 })
  class Connection extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('connect')) }
    beginTransaction(callback) {
      calls.push('begin')
      queueMicrotask(() => callback())
    }
    commitTransaction(callback) {
      calls.push('commit')
      queueMicrotask(() => callback())
    }
    rollbackTransaction(callback) {
      calls.push('rollback')
      queueMicrotask(() => callback(driverError))
    }
  }
  const adapter = createNodeDatabaseDriverAdapter({ loadMssql: () => ({ Connection }) })
  const handle = await adapter.openRemoteSession(remoteConfig('mssql'))

  await adapter.executeTransaction(handle, 'begin')
  await adapter.executeTransaction(handle, 'commit')
  await assert.rejects(adapter.executeTransaction(handle, 'rollback'), (error) => error === driverError)

  assert.deepEqual(calls, ['begin', 'commit', 'rollback'])
  assert.throws(() => adapter.executeTransaction(handle, 'savepoint'), /Operazione transazionale database non valida/u)
  assert.throws(() => adapter.executeTransaction(handle, 'toString'), /Operazione transazionale database non valida/u)
})

test('l adapter traduce error end e close in una sottoscrizione semantica rimovibile', async () => {
  const cases = [
    {
      driver: 'postgres',
      create() {
        const emitter = Object.assign(new EventEmitter(), { async connect() {}, async end() {} })
        return {
          adapter: createNodeDatabaseDriverAdapter({ loadPostgres: () => ({ Client: class { constructor() { return emitter } } }) }),
          emitter,
        }
      },
    },
    {
      driver: 'mysql',
      create() {
        const emitter = new EventEmitter()
        const client = Object.assign(new EventEmitter(), { connection: emitter, async end() {} })
        return {
          adapter: createNodeDatabaseDriverAdapter({ loadMysql: () => ({ createConnection: async () => client }) }),
          emitter,
        }
      },
    },
    {
      driver: 'mssql',
      create() {
        const emitter = Object.assign(new EventEmitter(), {
          connect() { queueMicrotask(() => this.emit('connect')) },
          close() { queueMicrotask(() => this.emit('end')) },
        })
        return {
          adapter: createNodeDatabaseDriverAdapter({ loadMssql: () => ({ Connection: class { constructor() { return emitter } } }) }),
          emitter,
        }
      },
    },
  ]

  for (const fixture of cases) {
    const { adapter, emitter } = fixture.create()
    const handle = await adapter.openRemoteSession(remoteConfig(fixture.driver))
    const events = []
    const unsubscribe = adapter.subscribeRemoteFailure(handle, (event) => events.push(event))
    const failure = new Error(`${fixture.driver} disconnected`)

    assert.equal(typeof unsubscribe, 'function')
    emitter.emit('error', failure)
    emitter.emit('end')
    emitter.emit('close')
    assert.deepEqual(events, [
      { error: failure, event: 'error' },
      { event: 'end' },
      { event: 'close' },
    ])

    unsubscribe()
    unsubscribe()
    assert.equal(emitter.listenerCount('error'), 0)
    assert.equal(emitter.listenerCount('end'), 0)
    assert.equal(emitter.listenerCount('close'), 0)
  }
})

test('l adapter possiede close bounded e force close dei client vendor senza esporli nel dominio', async () => {
  let postgresEndCalls = 0
  const postgresClient = Object.assign(new EventEmitter(), {
    async connect() {},
    async end() { postgresEndCalls += 1 },
  })
  const postgresAdapter = createNodeDatabaseDriverAdapter({
    loadPostgres: () => ({ Client: class { constructor() { return postgresClient } } }),
  })
  const postgresHandle = await postgresAdapter.openRemoteSession(remoteConfig('postgres'))
  await Promise.all([
    postgresAdapter.closeRemoteSession(postgresHandle),
    postgresAdapter.closeRemoteSession(postgresHandle),
  ])
  assert.equal(postgresEndCalls, 1)

  let mysqlDestroyCalls = 0
  const mysqlClient = Object.assign(new EventEmitter(), {
    connection: { stream: { destroy() { mysqlDestroyCalls += 1 } } },
  })
  const mysqlAdapter = createNodeDatabaseDriverAdapter({
    loadMysql: () => ({ createConnection: async () => mysqlClient }),
  })
  const mysqlHandle = await mysqlAdapter.openRemoteSession(remoteConfig('mysql'))
  mysqlAdapter.forceCloseRemoteSession(mysqlHandle)
  mysqlAdapter.forceCloseRemoteSession(mysqlHandle)
  assert.equal(mysqlDestroyCalls, 1)

  let mssqlCloseCalls = 0
  const mssqlClient = Object.assign(new EventEmitter(), {
    connect() { queueMicrotask(() => this.emit('connect')) },
    close() {
      mssqlCloseCalls += 1
      queueMicrotask(() => this.emit('end'))
    },
  })
  const mssqlAdapter = createNodeDatabaseDriverAdapter({
    loadMssql: () => ({ Connection: class { constructor() { return mssqlClient } } }),
  })
  const mssqlHandle = await mssqlAdapter.openRemoteSession(remoteConfig('mssql'))
  await mssqlAdapter.closeRemoteSession(mssqlHandle)
  assert.equal(mssqlCloseCalls, 1)

  assert.throws(() => postgresAdapter.closeRemoteSession(Object.freeze({})), /Handle database remoto non valido/u)
})
