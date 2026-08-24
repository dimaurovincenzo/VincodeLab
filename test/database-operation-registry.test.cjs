const assert = require('node:assert/strict')
const test = require('node:test')

const { createDatabaseOperationRegistry } = require('../electron/domains/database/database-operation-registry.cjs')

const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const thirdId = '33333333-3333-4333-8333-333333333333'

test('cancella soltanto l operazione appartenente allo stesso renderer', () => {
  const registry = createDatabaseOperationRegistry()
  const operation = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1', mutative: true })

  assert.deepEqual(registry.cancel(firstId, 8), { cancelled: false, mutative: false })
  assert.equal(operation.signal.aborted, false)
  assert.deepEqual(registry.cancel(firstId, 7), { cancelled: true, mutative: true })
  assert.equal(operation.signal.aborted, true)
  operation.finish()
  assert.deepEqual(registry.diagnostics(), { activeOperations: 0 })
})

test('abort workspace isola le altre operazioni e finish è idempotente', () => {
  const registry = createDatabaseOperationRegistry()
  const first = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' })
  const second = registry.start({ operationId: secondId, senderId: 7, workspacePath: '/workspace-b', connectionId: 'db-2' })

  assert.equal(registry.abortMatching((operation) => operation.workspacePath === '/workspace-a'), 1)
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  first.finish()
  first.finish()
  second.finish()
  assert.deepEqual(registry.diagnostics(), { activeOperations: 0 })
})

test('rifiuta identificativi invalidi e duplicati', () => {
  const registry = createDatabaseOperationRegistry()
  assert.throws(() => registry.start({ operationId: 'not-an-id', senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' }), /non valido/)
  const operation = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' })
  assert.throws(() => registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' }), /già in esecuzione/)
  operation.finish()
})

test('abort workspace attende il drain e non coinvolge operazioni di altri workspace', async () => {
  const registry = createDatabaseOperationRegistry({ cleanupTimeoutMs: 100 })
  const first = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' })
  const second = registry.start({ operationId: secondId, senderId: 7, workspacePath: '/workspace-b', connectionId: 'db-2' })
  let drained = false

  const cleanup = registry.abortWorkspace('/workspace-a').then((result) => {
    drained = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  assert.equal(drained, false)
  assert.deepEqual(registry.diagnostics(), { activeOperations: 2 })

  first.finish()
  assert.deepEqual(await cleanup, { cancelled: 1 })
  assert.equal(drained, true)
  assert.deepEqual(registry.diagnostics(), { activeOperations: 1 })
  second.finish()
})

test('un timeout mantiene tracciata l operazione e un retry può completare il cleanup', async () => {
  const registry = createDatabaseOperationRegistry({ cleanupTimeoutMs: 10 })
  const operation = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' })

  await assert.rejects(
    () => registry.abortWorkspace('/workspace-a'),
    (error) => error?.code === 'DATABASE_OPERATION_CLEANUP_TIMEOUT',
  )
  assert.equal(operation.signal.aborted, true)
  assert.deepEqual(registry.diagnostics(), { activeOperations: 1 })

  const retry = registry.abortWorkspace('/workspace-a', { timeoutMs: 100 })
  operation.finish()
  assert.deepEqual(await retry, { cancelled: 1 })
  assert.deepEqual(registry.diagnostics(), { activeOperations: 0 })
})

test('abort owner e abort all drenano soltanto gli snapshot ancora vivi', async () => {
  const registry = createDatabaseOperationRegistry({ cleanupTimeoutMs: 100 })
  const first = registry.start({ operationId: firstId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'db-1' })
  const second = registry.start({ operationId: secondId, senderId: 8, workspacePath: '/workspace-a', connectionId: 'db-2' })
  const third = registry.start({ operationId: thirdId, senderId: 7, workspacePath: '/workspace-b', connectionId: 'db-3' })

  const ownerCleanup = registry.abortOwner(7)
  first.finish()
  third.finish()
  assert.deepEqual(await ownerCleanup, { cancelled: 2 })
  assert.equal(second.signal.aborted, false)

  const allCleanup = registry.abortAll()
  second.finish()
  assert.deepEqual(await allCleanup, { cancelled: 1 })
  assert.deepEqual(await registry.abortAll(), { cancelled: 0 })
})

test('il main attende il drain database nei lifecycle boundary e prima di update/delete', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const shutdownRuntime = fs.readFileSync(path.join(__dirname, '..', 'electron', 'app', 'application-shutdown-runtime.cjs'), 'utf8')
  const windowLifecycle = fs.readFileSync(path.join(__dirname, '..', 'electron', 'app', 'window-lifecycle-runtime.cjs'), 'utf8')
  const databaseIpc = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ipc', 'domains', 'database.ipc.cjs'), 'utf8')
  const cleanup = fs.readFileSync(path.join(__dirname, '..', 'electron', 'domains', 'workspace', 'workspace-runtime-cleanup.cjs'), 'utf8')

  assert.match(main, /createWorkspaceRuntimeCleanup\(\{/)
  assert.match(cleanup, /databaseDrain = databaseOperations\.abortAndWaitMatching[\s\S]{0,420}Promise\.all\(\[databaseDrain, databaseSessionCleanup\]\)/)
  assert.match(shutdownRuntime, /shutdownApplication[\s\S]*databaseDrain = databaseOperations\.abortAll\(\)[\s\S]{0,420}Promise\.all\(\[databaseDrain, databaseSessionCleanup\]\)/)
  assert.match(windowLifecycle, /render-process-gone[\s\S]{0,620}databaseOperations\.abortOwner\(window\.webContents\.id\)[\s\S]*Promise\.all\(\[databaseOwnerDrain, databaseSessionCleanup\]\)/)
  assert.match(databaseIpc, /database:updateConnection'[\s\S]{0,760}databaseOperations\.abortAndWaitMatching[\s\S]{0,300}Promise\.all\(\[drain, closeConnectionSession/)
  assert.match(databaseIpc, /database:deleteConnection'[\s\S]{0,760}databaseOperations\.abortAndWaitMatching[\s\S]{0,300}Promise\.all\(\[drain, closeConnectionSession/)
  assert.match(main, /registerDatabaseIpc\(\{/)
  assert.doesNotMatch(main, /ipcMain\.handle\('database:/)
})
