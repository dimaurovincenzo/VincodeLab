const path = require('node:path')

const { IPC_CHANNELS } = require('../ipc/channels.cjs')

const WORKSPACE_FILE_CONTEXT_KINDS = new Set(['workspace-file', 'editor-workspace-tab'])
const WORKSPACE_DIRECTORY_CONTEXT_KIND = 'workspace-directory'
const WORKSPACE_ROOT_CONTEXT_KIND = 'workspace-root'

function createContextCommandRuntime({
  chooseApplication,
  copyText,
  log,
  openPath,
  openProjectFileWith,
  openWithApplication,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
  revealItem,
  sendToRenderer,
  showError,
  toPublicErrorMessage,
}) {
  const dependencies = {
    chooseApplication,
    copyText,
    log,
    openPath,
    openProjectFileWith,
    openWithApplication,
    requireActiveWorkspace,
    resolveProjectDirectory,
    resolveProjectFile,
    revealItem,
    sendToRenderer,
    showError,
    toPublicErrorMessage,
  }
  if (Object.values(dependencies).some((dependency) => typeof dependency !== 'function')) {
    throw new TypeError('Dipendenze comandi contestuali non valide.')
  }

  function resolveWorkspaceContextEntry(contextKind, contextId) {
    const workspacePath = requireActiveWorkspace()
    if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) {
      return { absolutePath: resolveProjectDirectory(workspacePath, ''), relativePath: '' }
    }
    if (contextKind === WORKSPACE_DIRECTORY_CONTEXT_KIND) {
      return { absolutePath: resolveProjectDirectory(workspacePath, contextId), relativePath: contextId }
    }
    if (WORKSPACE_FILE_CONTEXT_KINDS.has(contextKind)) {
      return { absolutePath: resolveProjectFile(workspacePath, contextId), relativePath: contextId }
    }
    throw new Error('Elemento del workspace non valido.')
  }

  function reportFailure(error, operation, title) {
    log('error', operation)
    showError(title, toPublicErrorMessage(error, {
      code: 'CONTEXT_COMMAND_FAILED',
      message: 'L’operazione selezionata non è stata completata. Riprova.',
    }))
  }

  function revealPath(targetPath, operation, title) {
    let result
    try {
      result = openPath(targetPath)
    } catch (error) {
      reportFailure(error, operation, title)
      return
    }
    void Promise.resolve(result).then((message) => {
      if (message) throw new Error(message)
    }).catch((error) => reportFailure(error, operation, title))
  }

  function dispatch(command, contextId, contextKind) {
    if (command === 'workspaceEntry.copyName' || command === 'workspaceEntry.copyRelativePath' || command === 'workspaceEntry.copyAbsolutePath') {
      try {
        const entry = resolveWorkspaceContextEntry(contextKind, contextId)
        const value = command === 'workspaceEntry.copyName'
          ? path.basename(entry.absolutePath)
          : command === 'workspaceEntry.copyRelativePath'
            ? entry.relativePath || '.'
            : entry.absolutePath
        copyText(value)
      } catch (error) {
        reportFailure(error, 'workspace_context_copy_failed', 'Percorso non copiato')
      }
      return
    }
    if (command === 'workspaceEntry.reveal') {
      try {
        const entry = resolveWorkspaceContextEntry(contextKind, contextId)
        if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) {
          revealPath(entry.absolutePath, 'workspace_context_reveal_failed', 'Workspace non mostrato')
        } else {
          revealItem(entry.absolutePath)
        }
      } catch (error) {
        reportFailure(error, 'workspace_context_reveal_failed', 'Elemento non mostrato')
      }
      return
    }
    if (command === 'workspaceFile.openWith') {
      try {
        void Promise.resolve(openProjectFileWith(requireActiveWorkspace(), contextId, {
          chooseApplication,
          openWith: openWithApplication,
        })).catch((error) => reportFailure(error, 'workspace_file_open_with_failed', 'Impossibile aprire il file'))
      } catch (error) {
        reportFailure(error, 'workspace_file_open_with_failed', 'Impossibile aprire il file')
      }
      return
    }
    if (command === 'recentWorkspace.copyPath' || command === 'gitFile.copyPath') {
      copyText(contextId)
      return
    }
    if (command === 'recentWorkspace.reveal') {
      revealPath(contextId, 'recent_workspace_reveal_failed', 'Workspace non mostrato')
      return
    }
    if (command === 'gitFile.reveal') {
      try {
        const workspaceRoot = resolveProjectDirectory(requireActiveWorkspace(), '')
        const candidate = path.resolve(workspaceRoot, contextId)
        const relative = path.relative(workspaceRoot, candidate)
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
          throw new Error('File Git non valido.')
        }
        revealItem(candidate)
      } catch (error) {
        reportFailure(error, 'git_file_reveal_failed', 'File non mostrato')
      }
      return
    }
    sendToRenderer(IPC_CHANNELS.CONTEXT_MENU_ACTION, { command, contextId, contextKind })
  }

  return Object.freeze({ dispatch })
}

module.exports = { createContextCommandRuntime }
