const fs = require('node:fs')
const path = require('node:path')
const {
  isEditorVisibleFile,
  assertEditorAccessiblePath,
  validateProjectEntryId,
} = require('../../domains/filesystem/project-access-policy.cjs')
const { createProjectFileSaveHostPort } = require('../../domains/filesystem/project-file-save-host.port.cjs')
const { readBoundedFile, writeFileAtomic } = require('./project-file-io-filesystem.service.cjs')
const {
  assertRegularProjectFile,
  resolveExistingProjectPath,
} = require('./project-path-filesystem.service.cjs')

function assertEditorAccessibleFile(filePath) {
  if (!isEditorVisibleFile(path.basename(filePath))) throw new Error('Nome file non valido.')
}

function resolveExistingFile(workspacePath, fileId) {
  validateProjectEntryId(fileId)
  const filePath = resolveExistingProjectPath(workspacePath, fileId.split('/'), 'file').absolutePath
  assertRegularProjectFile(filePath, 'File non trovato.')
  assertEditorAccessibleFile(filePath)
  return filePath
}

function resolveForcedFile(workspacePath, fileId) {
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 4096) throw new Error('Percorso file non valido.')
  assertEditorAccessiblePath(fileId)
  const segments = fileId.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
    throw new Error('Percorso file non valido.')
  }

  const directory = resolveExistingProjectPath(workspacePath, segments.slice(0, -1), 'directory').absolutePath
  const filePath = path.join(directory, segments.at(-1))
  try {
    const stats = fs.lstatSync(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('Il file richiesto non è un file regolare.')
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }
  assertEditorAccessibleFile(filePath)
  return filePath
}

function createProjectFileSaveFilesystemAdapter() {
  const targets = new WeakMap()

  function targetFor(handle) {
    const target = handle && typeof handle === 'object' ? targets.get(handle) : undefined
    if (!target) throw new TypeError('Handle salvataggio file progetto non valido.')
    return target
  }

  function prepareSave(workspacePath, fileId, force) {
    const filePath = force
      ? resolveForcedFile(workspacePath, fileId)
      : resolveExistingFile(workspacePath, fileId)
    const handle = Object.freeze({})
    targets.set(handle, Object.freeze({ filePath }))
    return handle
  }

  async function readBounded(handle, maxSize, tooLargeMessage) {
    const { filePath } = targetFor(handle)
    return readBoundedFile(filePath, maxSize, tooLargeMessage)
  }

  return createProjectFileSaveHostPort({
    exists(handle) {
      return fs.existsSync(targetFor(handle).filePath)
    },
    prepareSave,
    readBounded,
    readMode(handle) {
      return fs.statSync(targetFor(handle).filePath).mode
    },
    writeAtomic(handle, content, mode) {
      writeFileAtomic(targetFor(handle).filePath, content, mode)
    },
  })
}

module.exports = { createProjectFileSaveFilesystemAdapter }
