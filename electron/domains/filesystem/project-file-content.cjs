const fs = require('node:fs')
const path = require('node:path')
const { createPublicError } = require('../errors/public-error.cjs')
const { writeFileAtomic } = require('./file-utils.cjs')
const { createFileRevision } = require('./project-file-revision.cjs')
const {
  assertEditorAccessibleFile,
  assertEditorAccessiblePath,
  resolveProjectFile,
  resolveProjectPath,
} = require('./project-path-model.cjs')

const MAX_FILE_SIZE = 1_000_000
const FILE_REVISION_PATTERN = /^v1-[A-Za-z0-9_-]{43}$/u

function externalFileConflict() {
  return createPublicError(
    'FILESYSTEM_EXTERNAL_CONFLICT',
    'Il file è stato modificato o rimosso da un’altra applicazione. Le modifiche locali non sono state sovrascritte.',
  )
}

function isExternalFileStateError(error) {
  if (!error || typeof error !== 'object') return false
  if (error.code === 'ENOENT' || error.code === 'ELOOP') return true
  return /File non trovato|link simbolici|non è un file regolare|cambiato durante la lettura/u.test(error.message ?? '')
}

async function readBoundedFile(filePath, maxSize, tooLargeMessage) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow)
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new Error('Il file richiesto non è un file regolare.')
    if (before.size > maxSize) throw new Error(tooLargeMessage)

    // Una lettura normale alloca soltanto quanto dichiarato dal file. Il byte extra
    // rileva una crescita concorrente senza permettere a un append continuo di
    // espandere la memoria oltre il limite già verificato.
    const allocation = Buffer.allocUnsafe(before.size + 1)
    let bytesRead = 0
    while (bytesRead < allocation.length) {
      const result = await handle.read(allocation, bytesRead, allocation.length - bytesRead, null)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }

    const after = await handle.stat()
    if (bytesRead > maxSize || after.size > maxSize) throw new Error(tooLargeMessage)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.size !== bytesRead) {
      throw new Error('Il file è cambiato durante la lettura. Riprova.')
    }
    const buffer = allocation.subarray(0, bytesRead)
    return { buffer, revision: createFileRevision(buffer, after), size: after.size }
  } finally {
    await handle.close()
  }
}

function resolveProjectFileForForcedSave(workspacePath, fileId) {
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 4096) throw new Error('Percorso file non valido.')
  assertEditorAccessiblePath(fileId)
  const segments = fileId.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0'))) {
    throw new Error('Percorso file non valido.')
  }
  const directoryId = segments.slice(0, -1).join('/')
  const directory = resolveProjectPath(workspacePath, directoryId, 'directory')
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

function validateSaveOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Opzioni salvataggio file non valide.')
  const keys = Object.keys(options)
  if (keys.some((key) => key !== 'force' && key !== 'revision') || (options.force !== undefined && typeof options.force !== 'boolean')) {
    throw new Error('Opzioni salvataggio file non valide.')
  }
  const force = options.force === true
  const revision = typeof options.revision === 'string' && FILE_REVISION_PATTERN.test(options.revision) ? options.revision : null
  if (!force && !revision) throw new Error('Revisione file non valida.')
  return { force, revision }
}

async function saveProjectFile(workspacePath, fileId, content, options) {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
    throw new Error('Il contenuto supera 1MiB o non è valido.')
  }
  const { force, revision } = validateSaveOptions(options)
  let filePath
  try {
    filePath = force
      ? resolveProjectFileForForcedSave(workspacePath, fileId)
      : resolveProjectFile(workspacePath, fileId)
  } catch (error) {
    if (!force && isExternalFileStateError(error)) throw externalFileConflict()
    throw error
  }

  let mode = 0o644
  if (!force || fs.existsSync(filePath)) {
    let current
    try {
      current = await readBoundedFile(filePath, MAX_FILE_SIZE, 'Il file supera 1 MiB e non può essere salvato nell’editor.')
    } catch (error) {
      if (!force && isExternalFileStateError(error)) throw externalFileConflict()
      throw error
    }
    if (!force && current.revision !== revision) throw externalFileConflict()
    mode = fs.statSync(filePath).mode & 0o777
  }

  // Il file può essere uno script eseguibile: il salvataggio non deve alterare i permessi del progetto.
  writeFileAtomic(filePath, content, mode)
  const saved = await readBoundedFile(filePath, MAX_FILE_SIZE, 'Il file supera 1 MiB e non può essere salvato nell’editor.')
  if (saved.buffer.toString('utf8') !== content) throw externalFileConflict()
  return { id: fileId, revision: saved.revision, size: saved.size }
}

module.exports = { createFileRevision, saveProjectFile }
