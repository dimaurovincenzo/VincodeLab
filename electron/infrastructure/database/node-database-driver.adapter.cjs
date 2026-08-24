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

function connectMssqlClient(client, beforeConnect) {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      client.removeListener?.('connect', onConnect)
      client.removeListener?.('end', onEnd)
      client.removeListener?.('error', onError)
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const onConnect = (error) => finish(error)
    const onError = (error) => finish(error)
    const onEnd = () => finish(new Error('Connessione SQL Server chiusa durante l’apertura.'))
    client.once('connect', onConnect)
    client.once('end', onEnd)
    client.once('error', onError)
    try {
      beforeConnect()
    } catch (error) {
      finish(error)
      return
    }
    if (settled) return
    try { client.connect() } catch (error) { finish(error) }
  })
}

async function closeMssqlClient(client) {
  if (!client || client.closed || typeof client.close !== 'function') return
  if (typeof client.once !== 'function') {
    await Promise.resolve(client.close())
    return
  }
  await new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      client.removeListener?.('end', onClose)
      client.removeListener?.('close', onClose)
      client.removeListener?.('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onClose = () => finish()
    const onError = (error) => finish(error)
    client.once('end', onClose)
    client.once('close', onClose)
    client.once('error', onError)
    try {
      const closing = client.close()
      if (closing && typeof closing.then === 'function') closing.then(onClose, onError)
    } catch (error) {
      onError(error)
    }
  })
}

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
  const remoteSessionRecords = new WeakMap()

  function registerRemoteSession(driver, client) {
    const handle = Object.freeze({})
    remoteSessionRecords.set(handle, {
      client,
      closePromise: null,
      closed: false,
      driver,
      forceClosed: false,
    })
    return handle
  }

  function remoteSessionRecord(handle) {
    const record = remoteSessionRecords.get(handle)
    if (!record) throw new TypeError('Handle database remoto non valido.')
    return record
  }

  function publishRemoteCandidate(handle, onCandidate) {
    try {
      onCandidate(handle)
    } catch (error) {
      closeRejectedRemoteHandle(handle)
      throw error
    }
  }

  function closeRejectedRemoteHandle(handle) {
    const record = remoteSessionRecord(handle)
    if (record.closePromise || record.closed || record.forceClosed) return
    try {
      const closing = record.driver === 'mssql' ? record.client?.close?.() : record.client?.end?.()
      record.closePromise = Promise.resolve(closing).then(
        () => { record.closed = true },
        () => forceCloseRemoteHandle(handle),
      )
    } catch {
      forceCloseRemoteHandle(handle)
    }
  }

  function closeRemoteHandle(handle) {
    const record = remoteSessionRecord(handle)
    if (record.closePromise) return record.closePromise
    record.closePromise = (async () => {
      if (record.closed || record.forceClosed) return
      if (record.driver === 'mssql') await closeMssqlClient(record.client)
      else if (typeof record.client?.end === 'function') await Promise.resolve(record.client.end())
      else if (typeof record.client?.close === 'function') await Promise.resolve(record.client.close())
      record.closed = true
    })()
    return record.closePromise
  }

  function forceCloseRemoteHandle(handle) {
    const record = remoteSessionRecord(handle)
    if (record.forceClosed || record.closed) return
    record.forceClosed = true
    const client = record.client
    try {
      if (typeof client?.destroy === 'function') client.destroy()
      else if (typeof client?.connection?.stream?.destroy === 'function') client.connection.stream.destroy()
      else if (typeof client?.socket?.destroy === 'function') client.socket.destroy()
      else if (typeof client?.close === 'function') client.close()
    } catch {
      // La chiusura forzata è best effort e non sostituisce il failure originale.
    }
  }

  function subscribeRemoteHandle(handle, onFailure) {
    if (typeof onFailure !== 'function') throw new TypeError('Subscriber failure database non valido.')
    const record = remoteSessionRecord(handle)
    const emitter = record.driver === 'mysql' ? record.client?.connection ?? record.client : record.client
    if (!emitter || typeof emitter.on !== 'function') throw new TypeError('Lifecycle database remoto non disponibile.')
    let subscribed = true
    const listeners = [
      ['error', (error) => onFailure({ error, event: 'error' })],
      ['end', () => onFailure({ event: 'end' })],
      ['close', () => onFailure({ event: 'close' })],
    ]
    for (const [event, listener] of listeners) emitter.on(event, listener)
    return () => {
      if (!subscribed) return
      subscribed = false
      for (const [event, listener] of listeners) emitter.removeListener?.(event, listener)
    }
  }

  return createDatabaseDriverPort({
    closeRemoteSession(handle) {
      return closeRemoteHandle(handle)
    },
    executeRemote(handle, {
      sql,
      parameters = [],
      timeoutMs = 30_000,
      signal,
      onRow = () => undefined,
      onInvalidate = () => undefined,
    } = {}) {
      const { client, driver } = remoteSessionRecord(handle)
      if (driver === 'postgres') {
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
          try { client.query(query) } catch (error) { finish(error) }
        })
      }

      if (driver === 'mysql') {
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
            const rawClient = client.connection ?? client
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

      if (driver !== 'mssql') throw new TypeError('Sessione database remota non valida.')
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
        try { client.execSql(request) } catch (error) { finish(error) }
      })
    },
    executeTransaction(handle, operation) {
      if (!Object.hasOwn(REMOTE_TRANSACTION_OPERATIONS, operation)) throw new TypeError('Operazione transazionale database non valida.')
      const transaction = REMOTE_TRANSACTION_OPERATIONS[operation]
      const { client, driver } = remoteSessionRecord(handle)

      if (driver === 'postgres') {
        if (typeof client?.query !== 'function') throw new TypeError('Client PostgreSQL non valido.')
        return client.query(transaction.postgresSql)
      }

      if (driver === 'mysql') {
        const method = client?.[transaction.mysqlMethod]
        if (typeof method !== 'function') throw new TypeError('Client MySQL non valido.')
        return method.call(client)
      }

      if (driver !== 'mssql') throw new TypeError('Sessione database remota non valida.')
      const method = client?.[transaction.mssqlMethod]
      if (typeof method !== 'function') throw new TypeError('Client SQL Server non valido.')
      return new Promise((resolve, reject) => {
        method.call(client, (error) => error ? reject(error) : resolve())
      })
    },
    forceCloseRemoteSession(handle) {
      forceCloseRemoteHandle(handle)
    },
    async openRemoteSession(config, { onCandidate = () => undefined } = {}) {
      if (typeof onCandidate !== 'function') throw new TypeError('Callback candidato database non valida.')

      if (config?.driver === 'postgres') {
        const { Client } = postgresDriver()
        const client = new Client({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          connectionTimeoutMillis: 10_000,
          query_timeout: 30_000,
        })
        const handle = registerRemoteSession('postgres', client)
        publishRemoteCandidate(handle, onCandidate)
        await client.connect()
        return handle
      }

      if (config?.driver === 'mysql') {
        // mysql2/promise rende disponibile il wrapper soltanto dopo l'evento
        // connect; il candidato viene quindi pubblicato appena createConnection
        // risolve, mantenendo il comportamento storico del runtime.
        const client = await mysqlDriver().createConnection({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          connectTimeout: 10_000,
        })
        const handle = registerRemoteSession('mysql', client)
        publishRemoteCandidate(handle, onCandidate)
        return handle
      }

      if (config?.driver !== 'mssql') throw new TypeError('Driver database remoto non valido.')
      const { Connection } = mssqlDriver()
      const client = new Connection({
        server: config.host,
        authentication: {
          type: 'default',
          options: { userName: config.user, password: config.password },
        },
        options: {
          port: config.port,
          database: config.database,
          connectTimeout: 10_000,
          requestTimeout: 30_000,
          trustServerCertificate: true,
        },
      })
      const handle = registerRemoteSession('mssql', client)
      await connectMssqlClient(client, () => publishRemoteCandidate(handle, onCandidate))
      return handle
    },
    subscribeRemoteFailure(handle, onFailure) {
      return subscribeRemoteHandle(handle, onFailure)
    },
  })
}

const nodeDatabaseDriverAdapter = createNodeDatabaseDriverAdapter()

module.exports = { createNodeDatabaseDriverAdapter, nodeDatabaseDriverAdapter }
