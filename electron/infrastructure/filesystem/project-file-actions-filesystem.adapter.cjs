const fs = require('node:fs')
const path = require('node:path')
const { createProjectFileActionsHostPort } = require('../../domains/filesystem/project-file-actions-host.port.cjs')
const {
  assertRegularProjectFile,
  resolveExistingProjectPath,
} = require('./project-path-filesystem.service.cjs')

function segmentsForId(relativePath) {
  return relativePath ? relativePath.split('/') : []
}

function resolveDirectory(workspacePath, directoryId) {
  return resolveExistingProjectPath(workspacePath, segmentsForId(directoryId), 'directory').absolutePath
}

function resolveFile(workspacePath, fileId) {
  const filePath = resolveExistingProjectPath(workspacePath, segmentsForId(fileId), 'file').absolutePath
  assertRegularProjectFile(filePath, 'File non trovato.')
  return filePath
}

function createProjectFileActionsFilesystemAdapter() {
  return createProjectFileActionsHostPort({
    isMacApplicationBundle(applicationPath) {
      return typeof applicationPath === 'string' && path.extname(applicationPath).toLowerCase() === '.app'
    },

    prepareAttachment(workspacePath, fileId) {
      // Mantiene deliberatamente l'ordine storico resolve -> realpath -> access.
      // L'hardening del race symlink tra i primi due passaggi è una slice separata.
      const absolutePath = fs.realpathSync(resolveFile(workspacePath, fileId))
      fs.accessSync(absolutePath, fs.constants.R_OK)
      return { absolutePath, name: path.basename(absolutePath) }
    },

    resolveDirectory,
    resolveFile,
  })
}

module.exports = { createProjectFileActionsFilesystemAdapter }
