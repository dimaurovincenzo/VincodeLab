const { assertProjectFileActionsHostPort } = require('./project-file-actions-host.port.cjs')
const {
  validateProjectDirectoryId,
  validateProjectEntryId,
} = require('./project-access-policy.cjs')

function createProjectFileActions(host) {
  const fileActionsHost = assertProjectFileActionsHostPort(host)

  function resolveProjectDirectory(workspacePath, directoryId) {
    validateProjectDirectoryId(directoryId)
    return fileActionsHost.resolveDirectory(workspacePath, directoryId)
  }

  function resolveProjectFile(workspacePath, fileId) {
    validateProjectEntryId(fileId)
    return fileActionsHost.resolveFile(workspacePath, fileId)
  }

  function prepareProjectFileAttachment(workspacePath, fileId) {
    validateProjectEntryId(fileId)
    return fileActionsHost.prepareAttachment(workspacePath, fileId)
  }

  function revealProjectFile(workspacePath, fileId, { showItemInFolder }) {
    const filePath = resolveProjectFile(workspacePath, fileId)
    showItemInFolder(filePath)
    return { revealed: true }
  }

  function revealProjectDirectory(workspacePath, directoryId, { showItemInFolder }) {
    const directoryPath = resolveProjectDirectory(workspacePath, directoryId)
    showItemInFolder(directoryPath)
    return { revealed: true }
  }

  async function openProjectFileWith(workspacePath, fileId, { chooseApplication, openWith }) {
    const filePath = resolveProjectFile(workspacePath, fileId)
    const applicationPath = await chooseApplication()
    if (!applicationPath) return { opened: false }
    if (!fileActionsHost.isMacApplicationBundle(applicationPath)) {
      throw new Error('Seleziona un’applicazione macOS valida.')
    }
    await openWith(applicationPath, filePath)
    return { opened: true }
  }

  return Object.freeze({
    openProjectFileWith,
    prepareProjectFileAttachment,
    resolveProjectDirectory,
    resolveProjectFile,
    revealProjectDirectory,
    revealProjectFile,
  })
}

module.exports = { createProjectFileActions }
