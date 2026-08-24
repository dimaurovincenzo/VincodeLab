const assert = require('node:assert/strict')
const test = require('node:test')

const { createDatabaseDriverPort } = require('../electron/domains/database/database-driver.port.cjs')
const { createNodeDatabaseDriverAdapter } = require('../electron/infrastructure/database/node-database-driver.adapter.cjs')

test('la porta database rifiuta implementazioni incomplete ed espone solo il contratto minimo', () => {
  assert.throws(() => createDatabaseDriverPort({}), /Porta driver database incompleta/u)

  const implementation = {
    addMssqlParameter() {},
    createMssqlConnection() {},
    createMssqlRequest() {},
    createMysqlClient() {},
    createPostgresClient() {},
    createPostgresQuery() {},
    dettaglioAdapter: 'non pubblico',
  }
  const port = createDatabaseDriverPort(implementation)

  assert.equal(Object.isFrozen(port), true)
  assert.equal('dettaglioAdapter' in port, false)
})

test('l adapter Node carica ogni driver solo al primo utilizzo', async () => {
  const loads = { mssql: 0, mysql: 0, postgres: 0 }
  class FakePostgresClient {
    constructor(config) { this.config = config }
  }
  class FakePostgresQuery {
    constructor(config) { this.config = config }
  }
  class FakeMssqlConnection {
    constructor(config) { this.config = config }
  }
  class FakeMssqlRequest {
    constructor(sql, callback) {
      this.callback = callback
      this.parameters = []
      this.sql = sql
    }

    addParameter(...parameter) { this.parameters.push(parameter) }
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
  assert.deepEqual(adapter.createPostgresClient({ host: 'postgres.internal' }).config, { host: 'postgres.internal' })
  assert.deepEqual(adapter.createPostgresQuery({ text: 'SELECT 1' }).config, { text: 'SELECT 1' })
  assert.equal(loads.postgres, 1)
  assert.deepEqual((await adapter.createMysqlClient({ host: 'mysql.internal' })).config, { host: 'mysql.internal' })
  assert.equal(loads.mysql, 1)

  const connection = adapter.createMssqlConnection({ server: 'mssql.internal' })
  const request = adapter.createMssqlRequest('SELECT @p0', () => undefined)
  adapter.addMssqlParameter(request, 'p0', 42)
  adapter.addMssqlParameter(request, 'p1', 'testo')

  assert.deepEqual(connection.config, { server: 'mssql.internal' })
  assert.deepEqual(request.parameters, [['p0', types.Int, 42], ['p1', types.NVarChar, 'testo']])
  assert.equal(loads.mssql, 1)
})
