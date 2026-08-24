const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createShellSessionRuntime } = require('../electron/domains/shell/shell-session-runtime.cjs')

function shellHostCollaborators() {
  return {
    canonicalizeWorkspace: (workspacePath) => fs.realpathSync(workspacePath),
    getEnvironment: () => ({}),
    getExecutable: () => '/bin/fake-shell',
    isProcessAlive: () => false,
  }
}

function processFixture() {
  let onData
  let onExit
  return {
    emitData(data) { onData?.(data) },
    emitExit(event) { onExit?.(event) },
    process: {
      kill() {},
      onData(listener) { onData = listener; return { dispose() {} } },
      onExit(listener) { onExit = listener; return { dispose() {} } },
      pause() {},
      pid: 42,
      resize() {},
      resume() {},
      write() {},
    },
  }
}

test('inoltra data ed exit soltanto per il workspace attivo', () => {
  const workspacePath = '/workspace'
  const deliveries = []
  const logs = []
  let emitData
  let emitExit
  const runtime = createShellSessionRuntime({
    ...shellHostCollaborators(),
    deliverData: (payload) => deliveries.push(['data', payload]),
    deliverExit: (payload) => deliveries.push(['exit', payload]),
    getActiveWorkspacePath: () => workspacePath,
    log: (...entry) => logs.push(entry),
    managerFactory: ({ onData, onExit }) => {
      emitData = onData
      emitExit = onExit
      return { list: () => ({ workspacePath }) }
    },
    processFactory() {},
  })
  emitData({ workspacePath, sessionId: 'session', attachmentId: 'attachment', generation: 1, sequence: 2, data: 'output' })
  emitExit({ workspacePath, sessionId: 'session', exitCode: 1, signal: null, reason: 'exit' })

  assert.equal(runtime.activeState().workspacePath, workspacePath)
  assert.deepEqual(deliveries, [
    ['data', { sessionId: 'session', attachmentId: 'attachment', generation: 1, sequence: 2, data: 'output' }],
    ['exit', { sessionId: 'session', exitCode: 1, signal: null, reason: 'exit' }],
  ])
  assert.equal(logs.some((entry) => entry[1] === 'shell_session_exited'), true)
})

test('la boundary one-way confina rifiuti del trasporto renderer', () => {
  const runtime = createShellSessionRuntime({
    ...shellHostCollaborators(),
    deliverData() {},
    deliverExit() {},
    getActiveWorkspacePath: () => null,
    log() {},
    processFactory: () => processFixture().process,
  })
  const sent = []

  assert.equal(runtime.handleOneWay(
    '123e4567-e89b-42d3-a456-426614174000',
    'write',
    () => false,
    (payload) => sent.push(payload),
  ), undefined)
  assert.equal(sent[0].sessionId, '123e4567-e89b-42d3-a456-426614174000')
  assert.equal(sent[0].operation, 'write')
})

test('closeSessions è idempotente senza workspace e requireRunning preserva la guardia', async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-shell-runtime-'))
  const runtime = createShellSessionRuntime({
    ...shellHostCollaborators(),
    deliverData() {},
    deliverExit() {},
    getActiveWorkspacePath: () => null,
    log() {},
    processFactory: () => processFixture().process,
  })
  assert.deepEqual(await runtime.closeSessions(), { closed: 0 })
  assert.throws(() => runtime.requireRunning(workspacePath), /La shell non è attiva/)
  fs.rmSync(workspacePath, { recursive: true, force: true })
})
