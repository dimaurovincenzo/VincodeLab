const { IPC_CHANNELS } = require('../../ipc/channels.cjs')
const { createShellSessionManager } = require('./shell-session-manager.cjs')
const { reportShellSessionOneWayFailure } = require('./shell-session-error-event.cjs')

function createShellSessionRuntime({
  canonicalizeWorkspace,
  getActiveWorkspacePath,
  getEnvironment,
  getExecutable,
  isProcessAlive,
  log,
  managerFactory = createShellSessionManager,
  processFactory,
  sendToRenderer,
}) {
  let manager

  function activeState() {
    const workspacePath = getActiveWorkspacePath()
    if (!workspacePath) return null
    try {
      return manager.list(workspacePath)
    } catch {
      // Best-effort durante cambio workspace/chiusura: il manager conserva lo
      // stato autorevole e le operazioni esplicite espongono la recovery alla UI.
      return null
    }
  }

  function handleData(event) {
    const state = activeState()
    if (!state || state.workspacePath !== event.workspacePath) return
    sendToRenderer(IPC_CHANNELS.SHELL_SESSIONS_DATA, {
      sessionId: event.sessionId,
      attachmentId: event.attachmentId,
      generation: event.generation,
      sequence: event.sequence,
      data: event.data,
    })
  }

  function handleExit(event) {
    const state = activeState()
    if (!state || state.workspacePath !== event.workspacePath) return
    sendToRenderer(IPC_CHANNELS.SHELL_SESSIONS_EXIT, {
      sessionId: event.sessionId,
      exitCode: event.exitCode,
      signal: event.signal,
      reason: event.reason,
    })
    log(event.reason === 'exit' && (event.exitCode !== 0 || event.signal) ? 'error' : 'info', 'shell_session_exited', {
      sessionId: event.sessionId,
      reason: event.reason,
      exitCode: event.exitCode,
      signal: event.signal,
    })
  }

  manager = managerFactory({
    canonicalizeWorkspace,
    getEnvironment,
    getExecutable,
    isProcessAlive,
    processFactory,
    onData: handleData,
    onExit: handleExit,
  })

  function handleOneWay(event, sessionId, operation, perform) {
    try {
      const result = perform()
      if (result === false) {
        const error = new Error('Il trasporto renderer del terminale ha rifiutato il messaggio.')
        error.code = `SHELL_SESSION_${operation.toUpperCase()}_REJECTED`
        throw error
      }
      return result
    } catch (error) {
      reportShellSessionOneWayFailure({
        error,
        log,
        operation,
        sessionId,
        send: (channel, payload) => {
          if (!event.sender.isDestroyed()) event.sender.send(channel, payload)
        },
      })
      return undefined
    }
  }

  async function closeSessions(workspacePath = getActiveWorkspacePath()) {
    if (!workspacePath) return { closed: 0 }
    const result = await manager.closeAll(workspacePath)
    if (result.closed > 0) log('info', 'shell_sessions_stopped', { total: result.closed })
    return result
  }

  function requireRunning(workspacePath) {
    const state = manager.list(workspacePath)
    const session = state.sessions.find((item) => item.sessionId === state.activeSessionId)
    if (!session || session.status !== 'running') throw new Error('La shell non è attiva per questo workspace.')
    return session
  }

  return Object.freeze({ activeState, closeSessions, handleOneWay, manager, requireRunning })
}

module.exports = { createShellSessionRuntime }
