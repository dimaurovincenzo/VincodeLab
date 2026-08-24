const assert = require('node:assert/strict')
const test = require('node:test')
const Database = require('better-sqlite3')

const { wrapIpcHandler } = require('../electron/infrastructure/ipc/ipc-error-boundary.cjs')
const {
  CONTROLLED_FAILURES,
  CORRUPTED_WORKSPACE_SESSION_PAYLOAD,
  createReliabilityFaultInjection,
} = require('../electron/app/reliability-fault-injection.cjs')

test('la rejection IPC benchmark è classificata, correlata, sanitizzata e lascia funzionare il probe', async () => {
  const logs = []
  const faults = createReliabilityFaultInjection({
    enabled: true,
    getDatabase: () => { throw new Error('database non richiesto') },
    getWorkspacePath: () => '/tmp/vincodelab-fixture',
  })
  const invoke = wrapIpcHandler('benchmark:injectFault', (fault) => faults.inject(fault), {
    log: (...entry) => logs.push(entry),
  })

  await assert.rejects(async () => invoke('ipc-rejection'), (error) => {
    assert.equal(error.category, 'timeout')
    assert.equal(error.publicCode, 'BENCHMARK_IPC_REJECTION')
    assert.match(error.correlationId, /^ERR-[A-F0-9]{6}$/u)
    assert.match(error.message, /\[BENCHMARK_IPC_REJECTION\] \[ERR-[A-F0-9]{6}\]$/u)
    assert.doesNotMatch(error.message, /benchmark-secret|private|Users|query\.sql/iu)
    return true
  })

  assert.deepEqual(faults.probe(), { ok: true })
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0].slice(0, 2), ['warning', 'ipc_handler_failed'])
  assert.equal(logs[0][2].category, 'timeout')
  assert.equal(logs[0][2].code, 'BENCHMARK_IPC_REJECTION')
  assert.match(logs[0][2].correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.match(logs[0][2].fingerprint, /^FP-[A-F0-9]{12}$/u)
  assert.equal(logs[0][2].technicalCode, 'ETIMEDOUT')
  assert.equal(logs[0][2].technicalName, 'Error')
  assert.doesNotMatch(JSON.stringify(logs), /benchmark-secret|private|Users|query\.sql/iu)
})

test('ogni dominio richiesto attraversa il confine IPC con messaggio operativo, correlation e recovery', async () => {
  const logs = []
  const faults = createReliabilityFaultInjection({
    enabled: true,
    getDatabase: () => { throw new Error('database non richiesto') },
    getWorkspacePath: () => '/tmp/vincodelab-fixture',
  })
  const invoke = wrapIpcHandler('benchmark:injectFault', (fault) => faults.inject(fault), {
    log: (...entry) => logs.push(entry),
  })

  for (const [fault, expected] of Object.entries(CONTROLLED_FAILURES)) {
    await assert.rejects(async () => invoke(fault), (error) => {
      assert.equal(error.category, expected.category)
      assert.equal(error.domain, expected.domain)
      assert.equal(error.publicCode, expected.code)
      assert.match(error.correlationId, /^ERR-[A-F0-9]{6}$/u)
      assert.match(error.message, new RegExp(`\\[${expected.code}\\] \\[ERR-[A-F0-9]{6}\\]$`, 'u'))
      assert.doesNotMatch(error.message, /benchmark-secret|access_token|\/tmp\/vincodelab-private/iu)
      return true
    })
    assert.deepEqual(faults.probe(), { ok: true })
  }

  assert.equal(logs.length, Object.keys(CONTROLLED_FAILURES).length)
  for (const [, , fields] of logs) {
    assert.match(fields.correlationId, /^ERR-[A-F0-9]{6}$/u)
    assert.doesNotMatch(JSON.stringify(fields), /benchmark-secret|access_token|\/tmp\/vincodelab-private/iu)
  }
})

test('la corruzione persistenza è reale, one-shot e una lettura seguente resta sana', (t) => {
  const database = new Database(':memory:')
  t.after(() => database.close())
  const faults = createReliabilityFaultInjection({
    enabled: true,
    getDatabase: () => database,
    getWorkspacePath: () => '/tmp/vincodelab-fixture',
    now: () => 123_456,
  })

  assert.deepEqual(faults.inject('persistence-corrupt'), { armed: true, fault: 'persistence-corrupt' })
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'workspace_ui_state'").get(), undefined)
  assert.equal(faults.beforeWorkspaceSessionRead(), true)
  assert.equal(faults.beforeWorkspaceSessionRead(), false)
  const row = database.prepare('SELECT * FROM workspace_ui_state WHERE workspace_path = ?').get('/tmp/vincodelab-fixture')
  assert.equal(row.schema_version, 1)
  assert.equal(row.payload_json, CORRUPTED_WORKSPACE_SESSION_PAYLOAD)
  assert.equal(row.updated_at, 123_456)
  assert.throws(() => JSON.parse(row.payload_json), SyntaxError)
  assert.deepEqual(faults.probe(), { ok: true })
})

test('senza flag la fault injection non tocca persistenza né rende operativo il controller', () => {
  const faults = createReliabilityFaultInjection({ enabled: false })

  assert.equal(faults.beforeWorkspaceSessionRead(), false)
  assert.throws(() => faults.inject('persistence-corrupt'), (error) => {
    assert.equal(error.publicCode, 'BENCHMARK_FAULT_INJECTION_DISABLED')
    return true
  })
  assert.throws(() => faults.probe(), /modalità di verifica controllata non è attiva/u)
})
