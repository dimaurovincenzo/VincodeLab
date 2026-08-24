const assert = require('node:assert/strict')
const test = require('node:test')

const { createWindowCloseCoordinator } = require('../electron/app/window-close-coordinator.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

test('non distrugge la finestra prima che il cleanup sia concluso', async () => {
  const cleanup = deferred()
  let closes = 0
  const coordinator = createWindowCloseCoordinator({
    cleanup: () => cleanup.promise,
    closeWindow: () => { closes += 1 },
  })

  const closing = coordinator.request({ windowId: 1 })
  assert.equal(coordinator.isPending(), true)
  assert.equal(closes, 0)
  cleanup.resolve()

  assert.equal(await closing, true)
  assert.equal(closes, 1)
  assert.equal(coordinator.isPending(), false)
})

test('un cleanup fallito lascia la finestra aperta e consente un nuovo tentativo', async () => {
  let attempts = 0
  let closes = 0
  let failures = 0
  const coordinator = createWindowCloseCoordinator({
    cleanup: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('risorsa ancora attiva')
    },
    closeWindow: () => { closes += 1 },
    onFailure: () => { failures += 1; return false },
  })

  assert.equal(await coordinator.request({ windowId: 1 }), false)
  assert.equal(closes, 0)
  assert.equal(failures, 1)
  assert.equal(await coordinator.request({ windowId: 1 }), true)
  assert.equal(closes, 1)
})

test('la scelta di retry ripete il cleanup senza creare chiusure parallele', async () => {
  let attempts = 0
  let closes = 0
  const coordinator = createWindowCloseCoordinator({
    cleanup: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporaneo')
    },
    closeWindow: () => { closes += 1 },
    onFailure: () => true,
  })

  assert.equal(await coordinator.request({ windowId: 1 }), true)
  assert.equal(attempts, 2)
  assert.equal(closes, 1)
})

test('richieste simultanee condividono una sola operazione exactly-once', async () => {
  const cleanup = deferred()
  let attempts = 0
  let closes = 0
  const coordinator = createWindowCloseCoordinator({
    cleanup: () => { attempts += 1; return cleanup.promise },
    closeWindow: () => { closes += 1 },
  })

  const first = coordinator.request({ windowId: 1 })
  const second = coordinator.request({ windowId: 2 })
  assert.equal(first, second)
  cleanup.resolve()
  assert.equal(await first, true)
  assert.equal(attempts, 1)
  assert.equal(closes, 1)
})
