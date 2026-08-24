const assert = require('node:assert/strict')
const test = require('node:test')

const { createApplicationIpcBoundary } = require('../electron/infrastructure/ipc/application-ipc-boundary.cjs')

function fixture() {
  const deliveries = []
  const logs = []
  const mainFrame = {}
  const webContents = {
    isDestroyed: () => false,
    mainFrame,
  }
  const window = {
    isDestroyed: () => false,
    webContents,
  }
  return {
    boundary: createApplicationIpcBoundary({
      getWindow: () => window,
      log: (...entry) => logs.push(entry),
      sendToRenderer: (...entry) => deliveries.push(entry),
    }),
    deliveries,
    event: { sender: webContents, senderFrame: mainFrame },
    logs,
    window,
  }
}

test('la boundary accetta soltanto il main frame della finestra corrente', () => {
  const { boundary, event, logs } = fixture()
  assert.doesNotThrow(() => boundary.assertTrustedSender(event))
  assert.throws(() => boundary.assertTrustedSender({ sender: {}, senderFrame: {} }), /Origine IPC non autorizzata/)
  assert.deepEqual(logs, [['warn', 'ipc_sender_rejected']])
})

test('i payload pubblici e workspace restano congelati e sanitizzati', () => {
  const { boundary } = fixture()
  const raw = Object.assign(new Error('token=privato /Users/alice/progetto'), { code: 'EACCES' })
  const payload = boundary.publicApplicationErrorPayload(raw, {
    code: 'WORKSPACE_OPEN_FAILED',
    domain: 'workspace',
    message: 'Impossibile aprire il workspace.',
    operation: 'open',
  })
  const failure = boundary.workspaceFailure(raw, {
    code: 'WORKSPACE_OPEN_FAILED',
    domain: 'workspace',
    message: 'Impossibile aprire il workspace.',
    operation: 'open',
  })

  assert.equal(Object.isFrozen(payload), true)
  assert.equal(Object.isFrozen(failure), true)
  assert.match(payload.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.doesNotMatch(JSON.stringify({ payload, failure }), /privato|alice|progetto/u)
})

test('il confinement consegna soltanto failure one-way attendibili', async () => {
  const { boundary, deliveries, event, window } = fixture()
  const listener = boundary.confineIpcOneWay('terminal:key', async () => {
    throw new Error('write failed')
  })

  listener(event, 'x')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0][0], 'terminal:error')

  window.isDestroyed = () => true
  listener(event, 'y')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(deliveries.length, 1)
})

test('rejectOneWay conserva codice e messaggio applicativi', () => {
  const { boundary } = fixture()
  assert.throws(
    () => boundary.rejectOneWay('TERMINAL_INPUT_FAILED', 'Input non disponibile.'),
    (error) => error.code === 'TERMINAL_INPUT_FAILED' && error.message === 'Input non disponibile.',
  )
})
