const fs = require('node:fs')
const path = require('node:path')
const {
  resolveProjectDirectory,
  resolveProjectFile,
} = require('./project-path-model.cjs')

function prepareProjectFileAttachment(workspacePath, fileId) {
  const absolutePath = fs.realpathSync(resolveProjectFile(workspacePath, fileId))
  fs.accessSync(absolutePath, fs.constants.R_OK)
  return { absolutePath, name: path.basename(absolutePath) }
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
  if (typeof applicationPath !== 'string' || path.extname(applicationPath).toLowerCase() !== '.app') {
    throw new Error('Seleziona un’applicazione macOS valida.')
  }
  await openWith(applicationPath, filePath)
  return { opened: true }
}

module.exports = {
  openProjectFileWith,
  prepareProjectFileAttachment,
  revealProjectDirectory,
  revealProjectFile,
}
