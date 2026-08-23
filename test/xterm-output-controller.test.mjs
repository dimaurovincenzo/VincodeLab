import assert from 'node:assert/strict'
import test from 'node:test'
import { createXtermOutputController } from '../src/lib/xterm-output-controller.js'

const snapshot = (sessionId, data = '', watermark = 0) => ({
  sessionId,
  snapshot: { data, watermark, firstSequence: data ? 1 : 0, bytes: Buffer.byteLength(data) },
  status: 'running',
})

test('conferma un blocco soltanto dopo il callback di xterm', () => {
  const callbacks = []
  const acknowledgements = []
  const controller = createXtermOutputController({
    write: (_data, done) => callbacks.push(done),
    ack: (message) => acknowledgements.push(message),
    ready: () => {},
    onRendered: () => {},
    onWriteError: assert.fail,
  })

  controller.restore(snapshot('s1'))
  controller.accept({ sessionId: 's1', sequence: 1, data: 'uno' })
  controller.accept({ sessionId: 's1', sequence: 2, data: 'due' })
  assert.deepEqual(acknowledgements, [])
  callbacks.shift()()
  assert.deepEqual(acknowledgements, [{ sessionId: 's1', sequence: 1 }])
  callbacks.shift()()
  assert.deepEqual(acknowledgements.at(-1), { sessionId: 's1', sequence: 2 })
})

test('scrive lo snapshot prima di dichiarare pronto il renderer', () => {
  const events = []
  const controller = createXtermOutputController({
    write: (data, done) => { events.push(['write', data]); done() },
    ack: () => {},
    ready: (message) => events.push(['ready', message.watermark]),
    onRendered: () => {},
    onWriteError: assert.fail,
  })

  controller.restore(snapshot('s2', 'storico', 7))
  assert.deepEqual(events, [['write', 'storico'], ['ready', 7]])
})

test('ignora sessioni obsolete e conserva il blocco su errore sincrono', () => {
  let attempts = 0
  const errors = []
  const controller = createXtermOutputController({
    write: () => { attempts += 1; throw new Error('renderer unavailable') },
    ack: () => assert.fail('ACK non ammesso'),
    ready: () => {},
    onRendered: () => {},
    onWriteError: (error) => errors.push(error.message),
  })

  controller.restore(snapshot('active'))
  assert.equal(controller.accept({ sessionId: 'obsolete', sequence: 1, data: 'ignored' }), false)
  controller.accept({ sessionId: 'active', sequence: 1, data: 'x' })
  assert.equal(attempts, 1)
  assert.deepEqual(errors, ['renderer unavailable'])
  assert.equal(controller.metrics().queuedBlocks, 1)
})

test('dispose impedisce scritture e conferme successive', () => {
  const acknowledgements = []
  let callback
  const controller = createXtermOutputController({
    write: (_data, done) => { callback = done },
    ack: (message) => acknowledgements.push(message),
    ready: () => {},
    onRendered: () => {},
    onWriteError: assert.fail,
  })
  controller.restore(snapshot('s1'))
  controller.accept({ sessionId: 's1', sequence: 1, data: 'x' })
  controller.dispose()
  callback()
  assert.deepEqual(acknowledgements, [])
  assert.equal(controller.accept({ sessionId: 's1', sequence: 2, data: 'y' }), false)
})

test('si collega alla nuova sessione dopo il riavvio di Pi', async () => {
  const writes = []
  const controller = createXtermOutputController({
    write: (data, done) => { writes.push(data); done() },
    ack: () => {},
    ready: () => {},
    onRendered: () => {},
    onWriteError: assert.fail,
  })

  controller.restore(snapshot('old'))
  await controller.reconnect(() => Promise.resolve(snapshot('new')))
  assert.equal(controller.accept({ sessionId: 'new', sequence: 1, data: 'nuova sessione' }), true)
  assert.deepEqual(writes, ['nuova sessione'])
})

test('un callback xterm mancante attiva il recovery bounded senza ACK falso', () => {
  const timers = []
  const errors = []
  const acknowledgements = []
  const controller = createXtermOutputController({
    write: () => {},
    ack: (message) => acknowledgements.push(message),
    ready: () => {},
    onRendered: () => {},
    onWriteError: (error) => errors.push(error.message),
    setTimer: (callback) => { timers.push(callback); return callback },
    clearTimer: () => {},
  })
  controller.restore(snapshot('watchdog'))
  controller.accept({ sessionId: 'watchdog', sequence: 1, data: 'bloccato' })

  timers.shift()()
  assert.deepEqual(errors, ['xterm_write_timeout'])
  assert.deepEqual(acknowledgements, [])
  assert.equal(controller.metrics().queuedBlocks, 1)
  controller.dispose()
})

test('mantiene un campione di latenze limitato e calcola tutti i percentili sul campione recente', () => {
  let clock = 0
  const controller = createXtermOutputController({
    write: (data, done) => { clock += Number(data); done() },
    ack: () => {},
    ready: () => {},
    onRendered: () => {},
    onWriteError: assert.fail,
    now: () => clock,
    latencySampleLimit: 3,
  })
  controller.restore(snapshot('bounded'))
  for (const latency of [5, 25, 35, 45, 1]) {
    controller.accept({ sessionId: 'bounded', sequence: latency, data: String(latency) })
  }

  const metrics = controller.metrics()
  assert.equal(metrics.ackP50Ms, 35)
  assert.equal(metrics.ackP95Ms, 45)
  assert.equal(metrics.ackP99Ms, 45)
  assert.equal(metrics.slowFrames, 3)
  controller.dispose()
})
