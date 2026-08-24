const path = require('node:path')

const WORKSPACE_INVOKE_CHANNELS = Object.freeze([
  'workspace:open',
  'workspace:getActive',
  'workspace:instanceStatus',
  'workspace:openInNewInstance',
  'workspace:listRecent',
  'workspace:reveal',
  'workspace:openRecent',
])

function createWorkspaceHandlers({
  applicationExecutable,
  applicationIsPackaged,
  assertTrustedSender,
  chooseAndOpenWorkspace,
  getActiveWorkspaceError,
  getActiveWorkspaceIncident,
  getActiveWorkspacePath,
  getApplicationPath,
  instanceRegistry,
  isDirectory,
  isLaunchInProgress,
  launchWorkspaceInstance,
  listRecentWorkspaces,
  log,
  openPath,
  openWorkspace,
  requireActiveWorkspace,
  revealWorkspace,
  scheduleTimeout,
  setLaunchInProgress,
  showErrorBox,
  toPublicErrorMessage,
}) {
  return new Map([
    ['workspace:open', (event) => {
      assertTrustedSender(event)
      return chooseAndOpenWorkspace()
    }],
    ['workspace:getActive', (event) => {
      assertTrustedSender(event)
      const workspacePath = getActiveWorkspacePath()
      return workspacePath ? { path: workspacePath, error: getActiveWorkspaceError(), errorIncident: getActiveWorkspaceIncident() } : null
    }],
    ['workspace:instanceStatus', (event, workspacePath) => {
      assertTrustedSender(event)
      if (workspacePath !== undefined && (typeof workspacePath !== 'string' || workspacePath.length > 4_096 || !path.isAbsolute(workspacePath))) {
        return { ...instanceRegistry.status(), canOpenNew: false, workspaceOpenElsewhere: false, reason: 'invalid-path' }
      }
      return instanceRegistry.status(workspacePath)
    }],
    ['workspace:openInNewInstance', async (event, workspacePath) => {
      assertTrustedSender(event)
      if (isLaunchInProgress()) return { launched: false, reason: 'limit', message: 'Apertura di una nuova finestra già in corso.' }
      if (typeof workspacePath !== 'string' || workspacePath.length > 4_096 || !path.isAbsolute(workspacePath) || !isDirectory(workspacePath)) {
        return { launched: false, reason: 'invalid-path', message: 'La cartella selezionata non è disponibile.' }
      }
      const status = instanceRegistry.status(workspacePath)
      if (!status.canOpenNew) {
        const reason = status.workspaceOpenElsewhere ? 'duplicate' : 'limit'
        return {
          launched: false,
          reason,
          message: reason === 'duplicate'
            ? 'Questo workspace è già aperto in un’altra finestra.'
            : 'Puoi usare al massimo due finestre contemporaneamente.',
        }
      }

      setLaunchInProgress(true)
      try {
        return await launchWorkspaceInstance({
          executable: applicationExecutable,
          appPath: getApplicationPath(),
          packaged: applicationIsPackaged,
          workspacePath,
          onPostLaunchError: (error) => {
            log('error', 'workspace_instance_process_error')
            showErrorBox(
              'Nuova finestra terminata',
              toPublicErrorMessage(error, { code: 'WORKSPACE_INSTANCE_PROCESS_FAILED', message: 'La nuova finestra non è rimasta disponibile.' }),
            )
          },
        })
      } catch (error) {
        log('error', 'workspace_instance_launch_failed')
        return {
          launched: false,
          reason: 'launch-failed',
          message: toPublicErrorMessage(error, { code: 'WORKSPACE_INSTANCE_LAUNCH_FAILED', message: 'Impossibile aprire una nuova finestra.' }),
        }
      } finally {
        const releaseLaunch = scheduleTimeout(() => { setLaunchInProgress(false) }, 2_000)
        releaseLaunch.unref()
      }
    }],
    ['workspace:listRecent', (event) => {
      assertTrustedSender(event)
      return listRecentWorkspaces()
    }],
    ['workspace:reveal', (event) => {
      assertTrustedSender(event)
      return revealWorkspace(requireActiveWorkspace(), { openPath: (workspacePath) => openPath(workspacePath) })
    }],
    ['workspace:openRecent', (event, workspacePath) => {
      assertTrustedSender(event)
      return openWorkspace(workspacePath)
    }],
  ])
}

function registerWorkspaceIpc({ ipcMain, ...dependencies }) {
  const handlers = createWorkspaceHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: WORKSPACE_INVOKE_CHANNELS })
}

module.exports = {
  WORKSPACE_INVOKE_CHANNELS,
  createWorkspaceHandlers,
  registerWorkspaceIpc,
}
