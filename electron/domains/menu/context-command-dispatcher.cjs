const { execFile } = require('node:child_process')
const path = require('node:path')

const WORKSPACE_FILE_CONTEXT_KINDS = new Set(['workspace-file', 'editor-workspace-tab'])
const WORKSPACE_DIRECTORY_CONTEXT_KIND = 'workspace-directory'
const WORKSPACE_ROOT_CONTEXT_KIND = 'workspace-root'

function createContextCommandDispatcher({
  clipboard,
  dialog,
  getWindow,
  log,
  openProjectFileWith,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
  sendToRenderer,
  shell,
  toPublicErrorMessage,
}) {
  function openWithMacApplication(applicationPath, filePath) {
    return new Promise((resolve, reject) => {
      execFile('/usr/bin/open', ['-a', applicationPath, filePath], { timeout: 15_000 }, (error) => error ? reject(error) : resolve())
    })
  }

  async function chooseMacApplication() {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Apri con',
      buttonLabel: 'Apri',
      defaultPath: '/Applications',
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  function resolveWorkspaceContextEntry(contextKind, contextId) {
    const workspacePath = requireActiveWorkspace()
    if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) {
      return { absolutePath: resolveProjectDirectory(workspacePath, ''), kind: 'directory', relativePath: '' }
    }
    if (contextKind === WORKSPACE_DIRECTORY_CONTEXT_KIND) {
      return { absolutePath: resolveProjectDirectory(workspacePath, contextId), kind: 'directory', relativePath: contextId }
    }
    if (WORKSPACE_FILE_CONTEXT_KINDS.has(contextKind)) {
      return { absolutePath: resolveProjectFile(workspacePath, contextId), kind: 'file', relativePath: contextId }
    }
    throw new Error('Elemento del workspace non valido.')
  }

  function reportFailure(error, operation, title) {
    log('error', operation)
    dialog.showErrorBox(title, toPublicErrorMessage(error, {
      code: 'CONTEXT_COMMAND_FAILED',
      message: 'L’operazione selezionata non è stata completata. Riprova.',
    }))
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
        clipboard.writeText(value)
      } catch (error) {
        reportFailure(error, 'workspace_context_copy_failed', 'Percorso non copiato')
      }
      return
    }
    if (command === 'workspaceEntry.reveal') {
      try {
        const entry = resolveWorkspaceContextEntry(contextKind, contextId)
        if (contextKind === WORKSPACE_ROOT_CONTEXT_KIND) {
          void shell.openPath(entry.absolutePath).then((message) => {
            if (message) throw new Error(message)
          }).catch((error) => reportFailure(error, 'workspace_context_reveal_failed', 'Workspace non mostrato'))
        } else {
          shell.showItemInFolder(entry.absolutePath)
        }
      } catch (error) {
        reportFailure(error, 'workspace_context_reveal_failed', 'Elemento non mostrato')
      }
      return
    }
    if (command === 'workspaceFile.openWith') {
      void openProjectFileWith(requireActiveWorkspace(), contextId, {
        chooseApplication: chooseMacApplication,
        openWith: openWithMacApplication,
      }).catch((error) => reportFailure(error, 'workspace_file_open_with_failed', 'Impossibile aprire il file'))
      return
    }
    if (command === 'recentWorkspace.copyPath' || command === 'gitFile.copyPath') {
      clipboard.writeText(contextId)
      return
    }
    if (command === 'recentWorkspace.reveal') {
      void shell.openPath(contextId).then((message) => {
        if (message) throw new Error(message)
      }).catch((error) => reportFailure(error, 'recent_workspace_reveal_failed', 'Workspace non mostrato'))
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
        shell.showItemInFolder(candidate)
      } catch (error) {
        reportFailure(error, 'git_file_reveal_failed', 'File non mostrato')
      }
      return
    }
    sendToRenderer('contextMenu:action', { command, contextId, contextKind })
  }

  return Object.freeze({ dispatch })
}

module.exports = { createContextCommandDispatcher }
