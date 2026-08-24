import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { temporaryRoot, UNICODE_PATTERN } from './scenario-fixture.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { measureResultRows, RESULT_BYTE_LIMIT } = require('../../../electron/domains/database/database-result-budget.cjs')
const { SqliteWorkerSession, sqliteWorkerDiagnostics } = require('../../../electron/infrastructure/database/sqlite-worker-session.adapter.cjs')

export async function runSqliteWorkerScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-sqlite-')
  const sqlitePath = path.join(root, 'soak.sqlite')
  let workerSession
  try {
    const database = new Database(sqlitePath)
    database.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
    const insert = database.prepare('INSERT INTO items(id, label) VALUES (?, ?)')
    database.transaction(() => {
      for (let id = 1; id <= config.sqliteRows; id += 1) insert.run(id, `${UNICODE_PATTERN}-${id}`)
    })()
    database.close()

    assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 }, 'Worker SQLite preesistenti.')
    workerSession = new SqliteWorkerSession(sqlitePath)
    await workerSession.ready()
    const pageLimit = Math.min(500, config.sqliteRows - 1)
    const page = await workerSession.request('execute', {
      sql: `SELECT id, label FROM items ORDER BY id LIMIT ${pageLimit + 1}`,
      budgetRowLimit: pageLimit,
    }, { timeoutMs: config.sqliteTimeoutMs })
    assert.equal(page.rows.length, pageLimit, 'Budget righe SQLite non rispettato.')
    assert.equal(page.hasMore, true, 'Sentinella pagina SQLite non rilevata.')
    assert.doesNotMatch(page.rows.at(-1).label, /�/u, 'Unicode SQLite corrotto.')
    const resultBytes = measureResultRows(page.rows)
    assert.ok(resultBytes < RESULT_BYTE_LIMIT, 'Payload SQLite oltre budget.')

    await assert.rejects(
      () => workerSession.request('execute', { sql: 'SELECT randomblob(2097152) AS payload', budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs }),
      /database_result_cell_too_large/,
    )
    const recovery = await workerSession.request('execute', { sql: 'SELECT 1 AS recovered', budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs })
    assert.deepEqual(recovery.rows, [{ recovered: 1 }], 'Worker SQLite non recuperato dopo budget error.')

    const longQuery = `WITH RECURSIVE counter(value) AS (VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < ${config.sqliteRecursiveRows}) SELECT sum(value) AS total FROM counter`
    const longResult = await workerSession.request('execute', { sql: longQuery, budgetRowLimit: 1 }, { timeoutMs: config.sqliteTimeoutMs })
    assert.equal(longResult.rows.length, 1, 'Query worker SQLite incompleta.')
    assert.equal(sqliteWorkerDiagnostics().pendingRequests, 0, 'Richieste SQLite residue.')
    await workerSession.close()
    workerSession = null
    assert.deepEqual(sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 }, 'Worker SQLite residui.')
    return {
      sourceRows: config.sqliteRows,
      returnedRows: page.rows.length,
      hasMore: page.hasMore,
      resultBytes,
      budgetErrorRecovered: true,
      recursiveRows: config.sqliteRecursiveRows,
      activeWorkers: 0,
      pendingRequests: 0,
    }
  } finally {
    await workerSession?.close().catch(() => undefined)
    fs.rmSync(root, { recursive: true, force: true })
  }
}
