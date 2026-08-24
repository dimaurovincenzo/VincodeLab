const assert = require('node:assert/strict')
const net = require('node:net')
const test = require('node:test')

const { createPiAgentStatusServer } = require('../electron/infrastructure/processes/pi-agent-status-server.adapter.cjs')

function send(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.once('connect', () => socket.end(JSON.stringify(payload)))
    socket.once('error', reject)
    socket.once('close', resolve)
  })
}

test('accetta soltanto stati Pi autenticati e confinati alla sessione', async (context) => {
  const events = []
  const server = createPiAgentStatusServer()
  context.after(() => server.stop())
  server.setEventHandler((event) => events.push(event))
  const descriptor = await server.start()

  await send(descriptor.socketPath, { sessionId: 'session-valid', state: 'working', token: 'errato' })
  await send(descriptor.socketPath, { sessionId: 'session-valid', state: 'working', token: descriptor.token })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(events, [{ sessionId: 'session-valid', state: 'working' }])
  assert.equal(descriptor, await server.descriptor())
})
