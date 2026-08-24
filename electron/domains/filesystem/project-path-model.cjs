const fs = require('node:fs')
const path = require('node:path')
const { assertRegularFile } = require('./file-utils.cjs')
const {
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  isEditorVisibleFile,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
} = require('./project-access-policy.cjs')

function assertEditorAccessibleFile(filePath) {
  if (!isEditorVisibleFile(path.basename(filePath))) throw new Error('Nome file non valido.')
}

function workspaceRoot(workspacePath) {
  return fs.realpathSync(workspacePath)
}

function toId(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function resolveProjectPath(workspacePath, relativePath, expectedKind) {
  const root = workspaceRoot(workspacePath)
  const segments = relativePath ? relativePath.split('/').filter(Boolean) : []
  if (typeof relativePath !== 'string' && relativePath !== undefined || segments.some((segment) => segment === '.' || segment === '..' || segment.includes(path.sep))) {
    throw new Error('Percorso file non valido.')
  }

  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = fs.lstatSync(current)
    if (stats.isSymbolicLink()) throw new Error('I link simbolici non sono accessibili dall’editor.')
  }
  if (current !== root && !current.startsWith(`${root}${path.sep}`)) throw new Error('Percorso file non valido.')

  const stats = fs.lstatSync(current)
  if (stats.isSymbolicLink() || (expectedKind === 'file' && !stats.isFile()) || (expectedKind === 'directory' && !stats.isDirectory())) {
    throw new Error(expectedKind === 'file' ? 'File non trovato.' : 'Cartella non trovata.')
  }
  return current
}

function resolveProjectFile(workspacePath, fileId) {
  validateProjectEntryId(fileId)
  const filePath = resolveProjectPath(workspacePath, fileId, 'file')
  assertRegularFile(filePath, 'File non trovato.')
  assertEditorAccessibleFile(filePath)
  return filePath
}

function resolveProjectDirectory(workspacePath, directoryId = '') {
  validateProjectDirectoryId(directoryId)
  return resolveProjectPath(workspacePath, directoryId, 'directory')
}

function resolveProjectEntry(workspacePath, entryId, expectedKind) {
  validateProjectEntryId(entryId)
  validateProjectEntryKind(expectedKind)
  return expectedKind === 'file'
    ? resolveProjectFile(workspacePath, entryId)
    : resolveProjectDirectory(workspacePath, entryId)
}

module.exports = {
  assertEditorAccessibleFile,
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  isEditorVisibleFile,
  resolveProjectDirectory,
  resolveProjectEntry,
  resolveProjectFile,
  resolveProjectPath,
  toId,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
  workspaceRoot,
}
