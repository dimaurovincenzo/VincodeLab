const { createShellSessionManager } = require('./shell-session-manager.cjs')
const { reportShellSessionOneWayFailure } = require('./shell-session-error-event.cjs')

function createShellSessionRuntime({
  canonicalizeWorkspace,
  deliverData,
  deliverExit,
  getActiveWorkspacePath,
  getEnvironment,
  getExecutable,
  isProcessAlive,
  log,
  managerFactory = createShellSessionManager,
  processFactory,
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

  function handleData(sessionEvent) {
    const state = activeState()
    if (!state || state.workspacePath !== sessionEvent.workspacePath) return
    deliverData({
      sessionId: sessionEvent.sessionId,
      attachmentId: sessionEvent.attachmentId,
      generation: sessionEvent.generation,
      sequence: sessionEvent.sequence,
      data: sessionEvent.data,
    })
  }

  function handleExit(sessionEvent) {
    const state = activeState()
    if (!state || state.workspacePath !== sessionEvent.workspacePath) return
    deliverExit({
      sessionId: sessionEvent.sessionId,
      exitCode: sessionEvent.exitCode,
      signal: sessionEvent.signal,
      reason: sessionEvent.reason,
    })
    log(sessionEvent.reason === 'exit' && (sessionEvent.exitCode !== 0 || sessionEvent.signal) ? 'error' : 'info', 'shell_session_exited', {
      sessionId: sessionEvent.sessionId,
      reason: sessionEvent.reason,
      exitCode: sessionEvent.exitCode,
      signal: sessionEvent.signal,
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

  function handleOneWay(sessionId, operation, perform, deliverFailure) {
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
        send: deliverFailure,
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
