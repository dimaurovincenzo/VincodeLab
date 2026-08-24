const path = require('node:path')

const MAX_WORKSPACE_PATH_LENGTH = 4_096
const LAUNCH_RELEASE_DELAY_MS = 2_000

function isValidWorkspacePath(workspacePath) {
  return typeof workspacePath === 'string'
    && workspacePath.length <= MAX_WORKSPACE_PATH_LENGTH
    && path.isAbsolute(workspacePath)
}

function createWorkspaceInstanceUseCases({
  applicationExecutable,
  applicationIsPackaged,
  getApplicationPath,
  getInstanceStatus,
  isDirectory,
  launchWorkspaceInstance,
  log,
  scheduleTimeout = setTimeout,
  showErrorBox,
  toPublicErrorMessage,
}) {
  let launchInProgress = false

  function getStatus(workspacePath) {
    if (workspacePath !== undefined && !isValidWorkspacePath(workspacePath)) {
      return {
        ...getInstanceStatus(),
        canOpenNew: false,
        workspaceOpenElsewhere: false,
        reason: 'invalid-path',
      }
    }
    return getInstanceStatus(workspacePath)
  }

  async function openInNewInstance(workspacePath) {
    if (launchInProgress) {
      return { launched: false, reason: 'limit', message: 'Apertura di una nuova finestra già in corso.' }
    }
    if (!isValidWorkspacePath(workspacePath) || !isDirectory(workspacePath)) {
      return { launched: false, reason: 'invalid-path', message: 'La cartella selezionata non è disponibile.' }
    }

    const status = getInstanceStatus(workspacePath)
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

    launchInProgress = true
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
            toPublicErrorMessage(error, {
              code: 'WORKSPACE_INSTANCE_PROCESS_FAILED',
              message: 'La nuova finestra non è rimasta disponibile.',
            }),
          )
        },
      })
    } catch (error) {
      log('error', 'workspace_instance_launch_failed')
      return {
        launched: false,
        reason: 'launch-failed',
        message: toPublicErrorMessage(error, {
          code: 'WORKSPACE_INSTANCE_LAUNCH_FAILED',
          message: 'Impossibile aprire una nuova finestra.',
        }),
      }
    } finally {
      const releaseLaunch = scheduleTimeout(() => { launchInProgress = false }, LAUNCH_RELEASE_DELAY_MS)
      releaseLaunch.unref()
    }
  }

  return Object.freeze({ getStatus, openInNewInstance })
}

module.exports = { createWorkspaceInstanceUseCases }
