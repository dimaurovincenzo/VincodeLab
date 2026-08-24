const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { SqliteWorkerSession, terminateWorker } = require('../electron/infrastructure/database/sqlite-worker-session.adapter.cjs')

function fakeWorker({ exits }) {
  const worker = new EventEmitter()
  worker.exitCode = null
  worker.signalCode = null
  worker.disconnectCalls = 0
  worker.killCalls = 0
  worker.disconnect = () => { worker.disconnectCalls += 1 }
  worker.kill = () => {
    worker.killCalls += 1
    if (exits && worker.killCalls === 1) queueMicrotask(() => worker.emit('exit', null, 'SIGKILL'))
    return true
  }
  return worker
}

test('conclude il cleanup del worker anche se SIGKILL non produce exit', async () => {
  const worker = fakeWorker({ exits: false })
  const outcome = await terminateWorker(worker, 10)

  assert.deepEqual(outcome, { timedOut: true })
  assert.equal(worker.disconnectCalls, 1)
  assert.equal(worker.killCalls, 2)
  assert.equal(worker.listenerCount('exit'), 0)
})

test('conclude subito quando il worker emette exit', async () => {
  const worker = fakeWorker({ exits: true })
  const outcome = await terminateWorker(worker, 1_000)

  assert.deepEqual(outcome, { timedOut: false })
  assert.equal(worker.killCalls, 1)
  assert.equal(worker.disconnectCalls, 0)
})

test('preserva il codice SQLite restituito dal worker', async (t) => {
  const session = new SqliteWorkerSession(':memory:')
  t.after(() => session.close())
  await session.ready()
  await session.request('exec', { sql: 'CREATE TABLE items(id INTEGER PRIMARY KEY)' })
  await session.request('execute', { sql: 'INSERT INTO items(id) VALUES (1)' })

  await assert.rejects(
    () => session.request('execute', { sql: 'INSERT INTO items(id) VALUES (1)' }),
    (error) => error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY',
  )
})
