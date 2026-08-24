const { createPublicError } = require('../errors/public-error.cjs')
const { createFileRevision } = require('./project-file-revision.cjs')
const { assertProjectFileSaveHostPort } = require('./project-file-save-host.port.cjs')

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

function assertSaveHandle(handle) {
  if (!handle || typeof handle !== 'object') throw new TypeError('Bersaglio salvataggio file progetto non valido.')
  return handle
}

function createProjectFileSaver(host) {
  const fileSaveHost = assertProjectFileSaveHostPort(host)

  async function saveProjectFile(workspacePath, fileId, content, options) {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
      throw new Error('Il contenuto supera 1MiB o non è valido.')
    }
    const { force, revision } = validateSaveOptions(options)
    let handle
    try {
      handle = assertSaveHandle(fileSaveHost.prepareSave(workspacePath, fileId, force))
    } catch (error) {
      if (!force && isExternalFileStateError(error)) throw externalFileConflict()
      throw error
    }

    let mode = 0o644
    if (!force || fileSaveHost.exists(handle)) {
      let current
      try {
        current = await fileSaveHost.readBounded(handle, MAX_FILE_SIZE, 'Il file supera 1 MiB e non può essere salvato nell’editor.')
      } catch (error) {
        if (!force && isExternalFileStateError(error)) throw externalFileConflict()
        throw error
      }
      const currentRevision = createFileRevision(current.buffer, current)
      if (!force && currentRevision !== revision) throw externalFileConflict()
      // Il file può essere uno script eseguibile: il salvataggio non deve alterare i permessi del progetto.
      mode = fileSaveHost.readMode(handle) & 0o777
    }

    fileSaveHost.writeAtomic(handle, content, mode)
    const saved = await fileSaveHost.readBounded(handle, MAX_FILE_SIZE, 'Il file supera 1 MiB e non può essere salvato nell’editor.')
    if (saved.buffer.toString('utf8') !== content) throw externalFileConflict()
    return {
      id: fileId,
      revision: createFileRevision(saved.buffer, saved),
      size: saved.size,
    }
  }

  return Object.freeze({ saveProjectFile })
}

module.exports = { createProjectFileSaver }
