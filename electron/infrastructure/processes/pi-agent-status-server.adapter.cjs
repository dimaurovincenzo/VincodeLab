const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const MAX_MESSAGE_BYTES = 4_096
const VALID_STATES = new Set(['ready', 'working', 'completed'])

function createPiAgentStatusServer({ log = () => undefined } = {}) {
  const token = crypto.randomBytes(24).toString('hex')
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\vincodelab-pi-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    : path.join(os.tmpdir(), `vincodelab-pi-${process.pid}-${crypto.randomBytes(6).toString('hex')}.sock`)
  let server = null
  let startPromise = null
  let eventHandler = () => undefined

  function handleSocket(socket) {
    let receivedBytes = 0
    let source = ''
    socket.setEncoding('utf8')
    socket.setTimeout(2_000, () => socket.destroy())
    socket.on('data', (chunk) => {
      receivedBytes += Buffer.byteLength(chunk, 'utf8')
      if (receivedBytes > MAX_MESSAGE_BYTES) {
        socket.destroy()
        return
      }
      source += chunk
    })
    socket.on('end', () => {
      try {
        const message = JSON.parse(source)
        if (message?.token !== token) return
        if (typeof message.sessionId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(message.sessionId)) return
        if (!VALID_STATES.has(message.state)) return
        eventHandler(Object.freeze({ sessionId: message.sessionId, state: message.state }))
      } catch (error) {
        log('warning', 'pi_agent_status_message_rejected', { reason: error instanceof Error ? error.name : 'unknown' })
      }
    })
    socket.on('error', () => undefined)
  }

  function start() {
    if (startPromise) return startPromise
    startPromise = new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        try { fs.unlinkSync(socketPath) } catch (error) {
          if (error?.code !== 'ENOENT') {
            reject(error)
            return
          }
        }
      }
      server = net.createServer(handleSocket)
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.removeListener('error', reject)
        server.on('error', (error) => log('warning', 'pi_agent_status_server_error', { reason: error?.name ?? 'unknown' }))
        if (process.platform !== 'win32') {
          try { fs.chmodSync(socketPath, 0o600) } catch { /* La randomizzazione e il token restano le guardie principali. */ }
        }
        resolve(Object.freeze({ socketPath, token }))
      })
    }).catch((error) => {
      startPromise = null
      try { server?.close() } catch { /* Nessun listener attivo da chiudere. */ }
      server = null
      throw error
    })
    return startPromise
  }

  async function descriptor() {
    return start()
  }

  async function stop() {
    const activeServer = server
    server = null
    startPromise = null
    if (activeServer) await new Promise((resolve) => activeServer.close(() => resolve()))
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath) } catch (error) { if (error?.code !== 'ENOENT') log('warning', 'pi_agent_status_socket_cleanup_failed', {}) }
    }
  }

  return Object.freeze({
    descriptor,
    setEventHandler: (handler) => { eventHandler = typeof handler === 'function' ? handler : () => undefined },
    start,
    stop,
  })
}

module.exports = { MAX_MESSAGE_BYTES, createPiAgentStatusServer }
