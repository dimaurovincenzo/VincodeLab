const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createExternalMutationRegistry } = require('../electron/domains/workspace/external-mutation-registry.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, reject, resolve }
}

const context = { ownerId: 7, workspacePath: '/workspace/a', type: 'github:push' }

test('attende una mutazione senza cancellarla e rimuove il registro solo dopo il settlement', async () => {
  const registry = createExternalMutationRegistry({ drainTimeoutMs: 100 })
  const operation = deferred()
  const running = registry.run(context, () => operation.promise)
  const drain = registry.waitWorkspace('/workspace/a')

  assert.equal(registry.active().length, 1)
  operation.resolve({ pushed: true })
  assert.deepEqual(await running, { pushed: true })
  assert.deepEqual(await drain, { settled: 1 })
  assert.deepEqual(registry.active(), [])
})

test('un timeout fail-closed conserva la mutazione e il retry di drain riesce', async () => {
  const registry = createExternalMutationRegistry({ drainTimeoutMs: 10 })
  const operation = deferred()
  const running = registry.run(context, () => operation.promise)

  await assert.rejects(() => registry.waitAll(), (error) => error.code === 'MUTATION_DRAIN_TIMEOUT')
  assert.equal(registry.active().length, 1)
  operation.resolve('done')
  assert.equal(await running, 'done')
  assert.deepEqual(await registry.waitAll(), { settled: 0 })
})

test('impedisce il retry ambiguo dello stesso tipo ma isola owner workspace e operazioni', async () => {
  const registry = createExternalMutationRegistry()
  const first = deferred()
  const running = registry.run(context, () => first.promise)

  assert.throws(() => registry.run(context, () => Promise.resolve()), (error) => error.code === 'MUTATION_IN_PROGRESS')
  await registry.run({ ...context, ownerId: 8 }, () => Promise.resolve())
  await registry.run({ ...context, workspacePath: '/workspace/b' }, () => Promise.resolve())
  await registry.run({ ...context, type: 'github:commit' }, () => Promise.resolve())
  first.resolve()
  await running
})

test('il drain considera conclusa anche una mutazione fallita e non ne nasconde l errore al chiamante', async () => {
  const registry = createExternalMutationRegistry()
  const failure = new Error('remote failure')
  const running = registry.run(context, () => Promise.reject(failure))
  const drain = registry.waitOwner(context.ownerId)

  await assert.rejects(() => running, failure)
  assert.deepEqual(await drain, { settled: 1 })
  assert.deepEqual(registry.active(), [])
})

test('il main attende le mutazioni ai lifecycle boundary e registra GitHub Pi update e Database', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const startupRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-startup-runtime.cjs'), 'utf8')
  const shutdownRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-shutdown-runtime.cjs'), 'utf8')
  const domainsDirectory = path.join(__dirname, '../electron/ipc/domains')
  const ipcDomains = fs.readdirSync(domainsDirectory)
    .filter((fileName) => fileName.endsWith('.ipc.cjs'))
    .map((fileName) => fs.readFileSync(path.join(domainsDirectory, fileName), 'utf8'))
    .join('\n')
  const workspaceCleanup = fs.readFileSync(
    path.join(__dirname, '../electron/domains/workspace/workspace-runtime-cleanup.cjs'),
    'utf8',
  )
  const source = `${main}\n${startupRuntime}\n${shutdownRuntime}\n${ipcDomains}\n${workspaceCleanup}`
  assert.match(source, /externalMutations\.waitMatching\([\s\S]*?'external-mutations'/u)
  assert.match(source, /externalMutations\.waitAll\(\)[\s\S]*?'external-mutations'/u)
  assert.match(source, /externalMutations\.run\(\{ ownerId: 0, workspacePath: null, type: 'startup:managed-updates' \}/u)
  for (const [channel, type] of [
    ['github:push', 'github:push'],
    ['github:pullRebase', 'github:pull-rebase'],
    ['github:createIssue', 'github:create-issue'],
    ['github:updateProjectItem', 'github:update-project-item'],
    ['database:commit', 'database:commit'],
    ['database:updateTableRows', 'database:update-table-rows'],
  ]) {
    assert.match(source, new RegExp(`(?:ipcMain\\.handle\\('|\\[')${channel}'[\\s\\S]{0,320}'${type}'`, 'u'))
  }
  for (const channel of ['updates:download', 'updates:activatePending', 'piSystem:install', 'piSystem:update', 'piSystem:remove']) {
    assert.match(source, new RegExp(`(?:ipcMain\\.handle\\('|\\[')${channel}'[\\s\\S]{0,320}runExternalMutation`, 'u'))
  }
})
