const { assertProjectFileActionsHostPort } = require('./project-file-actions-host.port.cjs')
const {
  validateProjectDirectoryId,
  validateProjectEntryId,
} = require('./project-access-policy.cjs')

function createProjectFileActions(host) {
  const fileActionsHost = assertProjectFileActionsHostPort(host)

  function prepareProjectFileAttachment(workspacePath, fileId) {
    validateProjectEntryId(fileId)
    return fileActionsHost.prepareAttachment(workspacePath, fileId)
  }

  function revealProjectFile(workspacePath, fileId, { showItemInFolder }) {
    validateProjectEntryId(fileId)
    const filePath = fileActionsHost.resolveFile(workspacePath, fileId)
    showItemInFolder(filePath)
    return { revealed: true }
  }

  function revealProjectDirectory(workspacePath, directoryId, { showItemInFolder }) {
    validateProjectDirectoryId(directoryId)
    const directoryPath = fileActionsHost.resolveDirectory(workspacePath, directoryId)
    showItemInFolder(directoryPath)
    return { revealed: true }
  }

  async function openProjectFileWith(workspacePath, fileId, { chooseApplication, openWith }) {
    validateProjectEntryId(fileId)
    const filePath = fileActionsHost.resolveFile(workspacePath, fileId)
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
    revealProjectDirectory,
    revealProjectFile,
  })
}

module.exports = { createProjectFileActions }
