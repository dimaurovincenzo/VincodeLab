const { createDatabaseDriverPort } = require('../../domains/database/database-driver.port.cjs')

function createNodeDatabaseDriverAdapter({
  loadMssql = () => require('tedious'),
  loadMysql = () => require('mysql2/promise'),
  loadPostgres = () => require('pg'),
} = {}) {
  let mssql
  let mysql
  let postgres

  const mssqlDriver = () => { mssql ??= loadMssql(); return mssql }
  const mysqlDriver = () => { mysql ??= loadMysql(); return mysql }
  const postgresDriver = () => { postgres ??= loadPostgres(); return postgres }

  return createDatabaseDriverPort({
    addMssqlParameter(request, name, value) {
      const { TYPES } = mssqlDriver()
      const type = typeof value === 'boolean'
        ? TYPES.Bit
        : typeof value === 'number'
          ? (Number.isInteger(value) ? TYPES.Int : TYPES.Float)
          : TYPES.NVarChar
      request.addParameter(name, type, value)
    },
    createMssqlConnection(config) {
      const { Connection } = mssqlDriver()
      return new Connection(config)
    },
    createMssqlRequest(sql, callback) {
      const { Request } = mssqlDriver()
      return new Request(sql, callback)
    },
    createMysqlClient(config) {
      return mysqlDriver().createConnection(config)
    },
    createPostgresClient(config) {
      const { Client } = postgresDriver()
      return new Client(config)
    },
    createPostgresQuery(config) {
      const { Query } = postgresDriver()
      return new Query(config)
    },
  })
}

const nodeDatabaseDriverAdapter = createNodeDatabaseDriverAdapter()

module.exports = { createNodeDatabaseDriverAdapter, nodeDatabaseDriverAdapter }
