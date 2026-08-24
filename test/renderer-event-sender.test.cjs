const assert = require('node:assert/strict')
const test = require('node:test')

const { createRendererEventSender } = require('../electron/infrastructure/ipc/renderer-event-sender.cjs')

function windowFixture({ destroyed = false, send } = {}) {
  return {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send: send ?? (() => {}),
    },
  }
}

test('consegna un evento soltanto a una finestra renderer viva', () => {
  const deliveries = []
  let currentWindow = windowFixture({ send: (...args) => deliveries.push(args) })
  const sendToRenderer = createRendererEventSender({
    getApplicationErrorLogMetadata: () => ({}),
    getWindow: () => currentWindow,
    log: () => {},
    toApplicationError: (error) => error,
  })

  assert.equal(sendToRenderer('terminal:output', { sequence: 7 }), true)
  assert.deepEqual(deliveries, [['terminal:output', { sequence: 7 }]])
  currentWindow = null
  assert.equal(sendToRenderer('terminal:output', {}), false)
  currentWindow = windowFixture({ destroyed: true, send: () => { throw new Error('non deve inviare') } })
  assert.equal(sendToRenderer('terminal:output', {}), false)
})

test('converte una failure di delivery in diagnostica sanitizzata senza rilanciarla', () => {
  const failure = new Error('renderer unavailable')
  const incident = { correlationId: 'ERR-123', severity: 'warning' }
  const conversions = []
  const logs = []
  const sendToRenderer = createRendererEventSender({
    getApplicationErrorLogMetadata: (value) => ({ correlationId: value.correlationId }),
    getWindow: () => windowFixture({ send: () => { throw failure } }),
    log: (...args) => logs.push(args),
    toApplicationError: (error, options) => {
      conversions.push([error, options])
      return incident
    },
  })

  assert.equal(sendToRenderer('redis:searchProgress', { private: 'payload' }), false)
  assert.equal(conversions[0][0], failure)
  assert.deepEqual(conversions[0][1], {
    code: 'RENDERER_EVENT_DELIVERY_FAILED',
    domain: 'internal',
    message: 'Un aggiornamento non è stato consegnato all’interfaccia.',
    operation: 'sendToRenderer',
    recoverable: true,
    severity: 'warning',
  })
  assert.deepEqual(logs, [[
    'warning',
    'renderer_event_delivery_failed',
    { correlationId: 'ERR-123', eventChannel: 'redis:searchProgress' },
  ]])
})
