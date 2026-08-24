const path = require('node:path')

function createWorkspaceOpener({
  cleanupWorkspaceRuntime,
  getActiveWorkspacePath,
  getInstanceRegistry,
  getWindow,
  instanceId,
  isDirectory,
  log,
  notifyWhenBackground,
  projectFileIndex,
  recordWorkspace,
  remoteRuntime,
  setActiveWorkspaceError,
  setActiveWorkspaceIncident,
  setActiveWorkspacePath,
  showOpenDialog,
  startPi,
  stopTerminal,
  workspaceFailure,
}) {
  let openGeneration = 0

  async function open(workspacePath) {
    if (typeof workspacePath !== 'string' || workspacePath.length === 0 || workspacePath.length > 4_096
      || !path.isAbsolute(workspacePath) || !isDirectory(workspacePath)) {
      log('warn', 'workspace_rejected')
      return workspaceFailure(new Error('Workspace path unavailable'), {
        category: 'not-found',
        code: 'WORKSPACE_NOT_FOUND',
        domain: 'workspace',
        message: 'La cartella selezionata non è più disponibile.',
        operation: 'open',
        severity: 'warning',
      })
    }

    const previousWorkspacePath = getActiveWorkspacePath() ?? null
    const instanceRegistry = getInstanceRegistry()
    const reservation = instanceRegistry?.setWorkspace(instanceId, workspacePath)
    if (reservation && !reservation.accepted) {
      log('warn', 'workspace_duplicate_rejected')
      return workspaceFailure(new Error('Workspace already reserved'), {
        category: 'conflict',
        code: 'WORKSPACE_ALREADY_OPEN',
        domain: 'workspace',
        message: 'Questo workspace è già aperto in un’altra finestra.',
        operation: 'open',
        severity: 'warning',
      })
    }
    const normalizedWorkspacePath = reservation?.workspacePath ?? workspacePath
    const generation = ++openGeneration

    try {
      if (previousWorkspacePath && previousWorkspacePath !== normalizedWorkspacePath) {
        await cleanupWorkspaceRuntime(previousWorkspacePath, 'workspace-change')
      } else {
        // Anche una riapertura dello stesso workspace deve sostituire la sessione
        // Pi, senza invalidare connessioni Database/SSH della vista corrente.
        await stopTerminal('workspace-change')
      }
      if (generation !== openGeneration) {
        return workspaceFailure(new DOMException('Workspace open superseded', 'AbortError'), {
          category: 'cancelled',
          code: 'WORKSPACE_OPEN_SUPERSEDED',
          domain: 'workspace',
          message: 'Apertura sostituita da una richiesta workspace più recente.',
          operation: 'open',
          recoverable: true,
          severity: 'info',
        })
      }
      // Editor, Git e GitHub restano operativi anche quando Pi non è disponibile.
      recordWorkspace(normalizedWorkspacePath)
      setActiveWorkspacePath(normalizedWorkspacePath)
      setActiveWorkspaceError(undefined)
      setActiveWorkspaceIncident(undefined)
      remoteRuntime.openWorkspace(normalizedWorkspacePath)
      projectFileIndex.clear()
      void projectFileIndex.build(normalizedWorkspacePath).catch((error) => {
        if (error?.name !== 'AbortError') log('warn', 'project_file_index_failed')
      })
      try {
        await startPi(normalizedWorkspacePath)
        log('info', 'workspace_opened')
        return { path: normalizedWorkspacePath }
      } catch (error) {
        const failure = workspaceFailure(error, {
          code: 'PI_START_FAILED',
          domain: 'ai',
          message: 'Impossibile avviare Pi per questo workspace.',
          operation: 'start',
        })
        setActiveWorkspaceError(failure.error)
        setActiveWorkspaceIncident(failure.errorIncident)
        const piMissing = failure.errorIncident.code === 'PI_NOT_INSTALLED'
        log(piMissing ? 'warning' : 'error', piMissing ? 'pi_not_installed' : 'pi_start_failed')
        if (!piMissing) notifyWhenBackground('VincodeLab · Pi', failure.error)
        return { path: normalizedWorkspacePath, ...failure }
      }
    } catch (error) {
      if (generation === openGeneration) {
        instanceRegistry?.setWorkspace(instanceId, previousWorkspacePath)
        if (previousWorkspacePath) remoteRuntime.openWorkspace(previousWorkspacePath)
      }
      const failure = workspaceFailure(error, {
        code: 'WORKSPACE_OPEN_FAILED',
        domain: 'workspace',
        message: 'Impossibile aprire il workspace.',
        operation: 'open',
      })
      log('error', 'workspace_open_failed')
      notifyWhenBackground('VincodeLab · Pi', failure.error)
      return failure
    }
  }

  async function chooseAndOpen() {
    const result = await showOpenDialog(getWindow(), {
      title: 'Apri cartella di lavoro',
      buttonLabel: 'Apri workspace',
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return open(result.filePaths[0])
  }

  return Object.freeze({ chooseAndOpen, open })
}

module.exports = { createWorkspaceOpener }
