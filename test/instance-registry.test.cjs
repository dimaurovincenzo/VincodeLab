const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')

const { createInstanceRegistry } = require('../electron/infrastructure/persistence/instance-registry.adapter.cjs')

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-instances-'))
  const database = new Database(':memory:')
  const alive = new Set([101, 102, 103])
  let clock = 1_000
  const registry = createInstanceRegistry({
    database,
    now: () => clock,
    isProcessAlive: (pid) => alive.has(pid),
    maxInstances: 2,
    staleAfterMs: 15_000,
  })
  t.after(() => {
    database.close()
    fs.rmSync(root, { recursive: true, force: true })
  })
  return {
    alive,
    database,
    registry,
    root,
    advance: (milliseconds) => { clock += milliseconds },
  }
}

test('ammette al massimo due istanze vive', (t) => {
  const { registry } = createFixture(t)

  assert.deepEqual(registry.register({ instanceId: 'one', pid: 101 }), { accepted: true, activeCount: 1 })
  assert.deepEqual(registry.register({ instanceId: 'two', pid: 102 }), { accepted: true, activeCount: 2 })
  assert.deepEqual(registry.register({ instanceId: 'three', pid: 103 }), {
    accepted: false,
    reason: 'limit',
    activeCount: 2,
  })
})

test('impedisce che due istanze usino lo stesso workspace normalizzato', (t) => {
  const { registry, root } = createFixture(t)
  const workspace = path.join(root, 'project-a')
  fs.mkdirSync(workspace)
  const realWorkspace = fs.realpathSync.native(workspace)

  registry.register({ instanceId: 'one', pid: 101 })
  registry.register({ instanceId: 'two', pid: 102 })
  assert.deepEqual(registry.setWorkspace('one', workspace), { accepted: true, workspacePath: realWorkspace })

  const equivalentPath = path.join(root, 'tmp', '..', 'project-a')
  assert.deepEqual(registry.status(equivalentPath), {
    activeCount: 2,
    maxInstances: 2,
    canOpenNew: false,
    workspaceOpenElsewhere: true,
    reason: 'duplicate',
  })
  assert.deepEqual(registry.setWorkspace('two', equivalentPath), {
    accepted: false,
    reason: 'duplicate',
    workspacePath: realWorkspace,
  })
})

test('rimuove una registrazione morta solo dopo la soglia stale', (t) => {
  const { advance, alive, registry } = createFixture(t)

  registry.register({ instanceId: 'one', pid: 101 })
  registry.register({ instanceId: 'two', pid: 102 })
  alive.delete(101)

  assert.equal(registry.register({ instanceId: 'three', pid: 103 }).accepted, false)
  advance(16_000)
  assert.deepEqual(registry.register({ instanceId: 'three', pid: 103 }), { accepted: true, activeCount: 2 })
})

test('heartbeat e unregister aggiornano lo stato della singola istanza', (t) => {
  const { advance, database, registry } = createFixture(t)

  registry.register({ instanceId: 'one', pid: 101 })
  advance(5_000)
  assert.deepEqual(registry.heartbeat('one'), { updated: true })
  assert.equal(database.prepare('SELECT heartbeat_at FROM app_instances WHERE instance_id = ?').get('one').heartbeat_at, 6_000)
  assert.deepEqual(registry.setWorkspace('one', null), { accepted: true, workspacePath: null })
  assert.deepEqual(registry.unregister('one'), { removed: true })
  assert.equal(registry.status().activeCount, 0)
})
