import net from 'node:net'

const sessionId = process.env.VINCODELAB_PI_SESSION_ID
const socketPath = process.env.VINCODELAB_PI_STATUS_SOCKET
const token = process.env.VINCODELAB_PI_STATUS_TOKEN

function report(state) {
  if (!sessionId || !socketPath || !token) return
  try {
    const socket = net.createConnection(socketPath)
    socket.setTimeout(1_000, () => socket.destroy())
    socket.once('connect', () => socket.end(JSON.stringify({ sessionId, state, token })))
    socket.on('error', () => undefined)
  } catch {
    // La telemetria di stato è opzionale: non deve mai interrompere Pi.
  }
}

export default function vincodeLabAgentStatus(pi) {
  pi.on('session_start', () => report('ready'))
  pi.on('agent_start', () => report('working'))
  pi.on('agent_settled', (_event, context) => {
    if (context?.isIdle?.() !== false) report('completed')
  })
}
