const EXCLUDED_DIRECTORIES = new Set(['node_modules'])

function isEditorVisibleFile(fileName) {
  return typeof fileName === 'string' && fileName.length > 0
}

function assertEditorAccessiblePath(relativePath) {
  const containsExcludedDirectory = String(relativePath)
    .split('/')
    .some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))
  if (containsExcludedDirectory) throw new Error('Questa cartella di sistema non è accessibile dall’editor.')
}

function validateProjectDirectoryId(directoryId, { allowRoot = true } = {}) {
  if (typeof directoryId !== 'string' || directoryId.length > 4096 || (!allowRoot && directoryId.length === 0)
    || directoryId.startsWith('/') || directoryId.endsWith('/') || directoryId.includes('\\') || directoryId.includes('\0')) {
    throw new Error('Percorso file non valido.')
  }
  const segments = directoryId ? directoryId.split('/') : []
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Percorso file non valido.')
  if (directoryId) assertEditorAccessiblePath(directoryId)
  return directoryId
}

function validateProjectEntryName(entryName) {
  if (typeof entryName !== 'string' || !entryName.trim() || Buffer.byteLength(entryName, 'utf8') > 255
    || entryName === '.' || entryName === '..' || entryName.includes('/') || entryName.includes('\\') || entryName.includes('\0')) {
    throw new Error('Nome file non valido.')
  }
  return entryName
}

function validateProjectEntryKind(expectedKind) {
  if (expectedKind !== 'file' && expectedKind !== 'directory') throw new Error('Tipo elemento non valido.')
  return expectedKind
}

function validateProjectEntryId(entryId) {
  validateProjectDirectoryId(entryId, { allowRoot: false })
  assertEditorAccessiblePath(entryId)
  return entryId
}

module.exports = {
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  isEditorVisibleFile,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
}
