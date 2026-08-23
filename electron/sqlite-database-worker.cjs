const Database = require('better-sqlite3')
const { measureResultRows } = require('./database-result-budget.cjs')

function serializeError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code
    : undefined
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error',
    ...(code ? { code } : {}),
  }
}

function executeOperation(database, operation, payload = {}) {
  if (operation === 'execute') {
    const statement = database.prepare(payload.sql)
    if (!statement.reader) return { rows: [], affectedRows: statement.run(...(payload.parameters ?? [])).changes, resultBytes: 0 }
    const rows = statement.all(...(payload.parameters ?? []))
    const hasMore = Number.isInteger(payload.budgetRowLimit) && rows.length > payload.budgetRowLimit
    const resultRows = hasMore ? rows.slice(0, payload.budgetRowLimit) : rows
    const resultBytes = measureResultRows(resultRows)
    // La riga sentinella usata per `hasMore` non deve attraversare l'IPC:
    // potrebbe contenere a sua volta un BLOB arbitrariamente grande.
    return { rows: resultRows, affectedRows: null, hasMore, resultBytes }
  }
  if (operation === 'all') {
    const rows = database.prepare(payload.sql).all(...(payload.parameters ?? []))
    const hasMore = Number.isInteger(payload.budgetRowLimit) && rows.length > payload.budgetRowLimit
    const resultRows = hasMore ? rows.slice(0, payload.budgetRowLimit) : rows
    return { rows: resultRows, hasMore, resultBytes: measureResultRows(resultRows) }
  }
  if (operation === 'exec') {
    database.exec(payload.sql)
    return { executed: true }
  }
  if (operation === 'inspectSchema') {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => ({
      name,
      columns: database.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all(),
    }))
    return { tables }
  }
  if (operation === 'updateRows') {
    const savepoint = 'vincodelab_table_update'
    database.exec(`SAVEPOINT ${savepoint}`)
    try {
      for (const update of payload.updates) {
        if (database.prepare(update.sql).run(...update.parameters).changes !== 1) throw new Error('La riga è cambiata o non è più disponibile.')
      }
      database.exec(`RELEASE SAVEPOINT ${savepoint}`)
      return { updated: payload.updates.length }
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
      database.exec(`RELEASE SAVEPOINT ${savepoint}`)
      throw error
    }
  }
  throw new Error('Operazione SQLite non valida.')
}

function send(message) {
  if (process.connected) process.send(message)
}

let database
process.on('message', (message) => {
  if (message?.type === 'initialize') {
    try {
      database = new Database(message.sqlitePath)
      database.pragma('foreign_keys = ON')
      send({ type: 'ready' })
    } catch (error) {
      send({ type: 'ready', error: serializeError(error) })
      process.disconnect()
    }
    return
  }
  if (!database) return
  const { id, operation, payload } = message
  try {
    send({ id, result: executeOperation(database, operation, payload) })
  } catch (error) {
    send({ id, error: serializeError(error) })
  }
})

process.on('disconnect', () => {
  if (database) {
    try {
      database.close()
    } catch {
      // Il processo sta terminando: i lock SQLite vengono comunque rilasciati dal sistema operativo.
    }
  }
  process.exit(0)
})
