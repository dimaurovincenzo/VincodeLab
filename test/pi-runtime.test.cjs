const assert = require('node:assert/strict')
const test = require('node:test')

const { createPiRuntime } = require('../electron/domains/ai/pi-runtime.cjs')

function fixture() {
  const deliveries = []
  const logs = []
  const spawned = []
  let onData
  let onExit
  const pty = {
    kill() {},
    onData(listener) { onData = listener },
    onExit(listener) { onExit = listener },
  }
  const controller = {
    reload: async () => {},
    start: async () => ({ started: true }),
    stop: async () => ({ stopped: true }),
  }
  const runtime = createPiRuntime({
    createPublicError: (code, message) => Object.assign(new Error(message), { code }),
    createSessionController: () => controller,
    environmentForExecutable: () => ({}),
    getHomePath: () => '/home/test',
    getWindow: () => ({}),
    log: (...entry) => logs.push(entry),
    notifyWhenBackground() {},
    ptyRuntime: { spawn: (...args) => { spawned.push(args); return pty } },
    resolveExecutable: () => '/usr/local/bin/pi',
    requireActiveWorkspace: () => '/workspace',
    sendToRenderer: (...entry) => deliveries.push(entry),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    withCleanupDeadline: (promise) => promise,
  })
  return { controller, deliveries, emitData: (data) => onData?.(data), emitExit: (event) => onExit?.(event), logs, runtime, spawned }
}

test('Pi config viene riusato e inoltra data ed exit tipizzati', async () => {
  const fixtureValue = fixture()
  const first = fixtureValue.runtime.startConfig()
  const second = fixtureValue.runtime.startConfig()
  fixtureValue.emitData('config')
  fixtureValue.emitExit({ exitCode: 0, signal: null })
  await Promise.resolve()

  assert.deepEqual(first, { started: true, reused: false })
  assert.deepEqual(second, { started: false, reused: true })
  assert.deepEqual(fixtureValue.deliveries, [
    ['piConfig:data', 'config'],
    ['piConfig:exit', { exitCode: 0, signal: null }],
  ])
  assert.equal(fixtureValue.runtime.getConfigProcess(), undefined)
})

test('allegati annullati e stop config assente restano operazioni innocue', async () => {
  const { runtime } = fixture()
  assert.deepEqual(await runtime.chooseAttachments(), [])
  assert.deepEqual(await runtime.stopConfig(), { closed: false })
})

test('reload delega al controller e mantiene il contratto pubblico', async () => {
  const { runtime } = fixture()
  assert.deepEqual(await runtime.reload(), { reloaded: true })
})
