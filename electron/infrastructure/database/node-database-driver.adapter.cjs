const { createDatabaseDriverPort } = require('../../domains/database/database-driver.port.cjs')

function cancellationError() {
  const error = new Error('database_query_cancelled')
  error.name = 'AbortError'
  return error
}

const REMOTE_TRANSACTION_OPERATIONS = Object.freeze({
  begin: Object.freeze({ mysqlMethod: 'beginTransaction', mssqlMethod: 'beginTransaction', postgresSql: 'BEGIN' }),
  commit: Object.freeze({ mysqlMethod: 'commit', mssqlMethod: 'commitTransaction', postgresSql: 'COMMIT' }),
  rollback: Object.freeze({ mysqlMethod: 'rollback', mssqlMethod: 'rollbackTransaction', postgresSql: 'ROLLBACK' }),
})

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
    createMssqlConnection(config) {
      const { Connection } = mssqlDriver()
      return new Connection(config)
    },
    createMysqlClient(config) {
      return mysqlDriver().createConnection(config)
    },
    createPostgresClient(config) {
      const { Client } = postgresDriver()
      return new Client(config)
    },
    executeRemote(session, {
      sql,
      parameters = [],
      timeoutMs = 30_000,
      signal,
      onRow = () => undefined,
      onInvalidate = () => undefined,
    } = {}) {
      if (session?.driver === 'postgres') {
        return new Promise((resolve, reject) => {
          const { Query } = postgresDriver()
          const query = new Query({ text: sql, values: parameters })
          query.query_timeout = timeoutMs
          let settled = false
          const finish = (error, result) => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', onAbort)
            if (error) reject(error)
            else resolve({
              affectedRows: typeof result?.rowCount === 'number' && result.command !== 'SELECT'
                ? result.rowCount
                : null,
            })
          }
          const failAndInvalidate = (error) => {
            finish(error)
            onInvalidate(error)
          }
          const onAbort = () => failAndInvalidate(cancellationError())
          query.on('row', (row) => {
            if (settled) return
            try { onRow(row) } catch (error) { failAndInvalidate(error) }
          })
          query.on('error', (error) => finish(error))
          query.on('end', (result) => finish(undefined, Array.isArray(result) ? result.at(-1) : result))
          if (signal?.aborted) return onAbort()
          signal?.addEventListener('abort', onAbort, { once: true })
          try { session.client.query(query) } catch (error) { finish(error) }
        })
      }

      if (session?.driver === 'mysql') {
        return new Promise((resolve, reject) => {
          let affectedRows = null
          let hasFields = false
          let settled = false
          const finish = (error) => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', onAbort)
            if (error) reject(error)
            else resolve({ affectedRows })
          }
          const failAndInvalidate = (error) => {
            finish(error)
            onInvalidate(error)
          }
          const onAbort = () => failAndInvalidate(cancellationError())
          if (signal?.aborted) return onAbort()
          signal?.addEventListener('abort', onAbort, { once: true })
          try {
            const rawClient = session.client.connection ?? session.client
            const command = rawClient.query({ sql, values: parameters, timeout: timeoutMs })
            command.on('fields', () => { hasFields = true })
            command.on('result', (row) => {
              if (settled) return
              if (!hasFields && !Array.isArray(row) && Number.isFinite(row?.affectedRows)) {
                affectedRows = row.affectedRows
                return
              }
              try { onRow(row) } catch (error) { failAndInvalidate(error) }
            })
            command.on('error', (error) => finish(error))
            command.on('end', () => finish())
          } catch (error) {
            finish(error)
          }
        })
      }

      if (session?.driver !== 'mssql') throw new TypeError('Sessione database remota non valida.')
      return new Promise((resolve, reject) => {
        const { Request, TYPES } = mssqlDriver()
        let affectedRows = null
        let settled = false
        let request
        const finish = (error, count) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          if (error) reject(error)
          else resolve({ affectedRows: count ?? affectedRows })
        }
        const cancelAndFail = (error) => {
          try { request?.cancel?.() } catch {
            // La Request sta già terminando: il cancel best effort non deve
            // mascherare il failure che verrà classificato dal dominio.
          }
          finish(error)
        }
        const onAbort = () => cancelAndFail(cancellationError())
        request = new Request(sql, (error, count) => finish(error, count))
        if (typeof request.setTimeout === 'function') request.setTimeout(timeoutMs)
        parameters.forEach((value, index) => {
          const type = typeof value === 'boolean'
            ? TYPES.Bit
            : typeof value === 'number'
              ? (Number.isInteger(value) ? TYPES.Int : TYPES.Float)
              : TYPES.NVarChar
          request.addParameter(`p${index}`, type, value)
        })
        request.on('row', (columns) => {
          if (settled) return
          try {
            onRow(Object.fromEntries(columns.map((column) => [column.metadata.colName, column.value])))
          } catch (error) {
            cancelAndFail(error)
          }
        })
        request.on('doneInProc', (count) => { affectedRows = count })
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        try { session.client.execSql(request) } catch (error) { finish(error) }
      })
    },
    executeTransaction(session, operation) {
      if (!Object.hasOwn(REMOTE_TRANSACTION_OPERATIONS, operation)) throw new TypeError('Operazione transazionale database non valida.')
      const transaction = REMOTE_TRANSACTION_OPERATIONS[operation]

      if (session?.driver === 'postgres') {
        if (typeof session.client?.query !== 'function') throw new TypeError('Client PostgreSQL non valido.')
        return session.client.query(transaction.postgresSql)
      }

      if (session?.driver === 'mysql') {
        const method = session.client?.[transaction.mysqlMethod]
        if (typeof method !== 'function') throw new TypeError('Client MySQL non valido.')
        return method.call(session.client)
      }

      if (session?.driver !== 'mssql') throw new TypeError('Sessione database remota non valida.')
      const method = session.client?.[transaction.mssqlMethod]
      if (typeof method !== 'function') throw new TypeError('Client SQL Server non valido.')
      return new Promise((resolve, reject) => {
        method.call(session.client, (error) => error ? reject(error) : resolve())
      })
    },
  })
}

const nodeDatabaseDriverAdapter = createNodeDatabaseDriverAdapter()

module.exports = { createNodeDatabaseDriverAdapter, nodeDatabaseDriverAdapter }
