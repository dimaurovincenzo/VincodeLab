const { validateProjectEntryId } = require('./project-access-policy.cjs')
const { assertProjectFileReaderHostPort } = require('./project-file-reader-host.port.cjs')
const { createFileRevision } = require('./project-file-revision.cjs')

const MAX_FILE_SIZE = 1_000_000
const MAX_PREVIEW_FILE_SIZE = 8 * 1024 * 1024
const PREVIEW_MIME_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['pdf', 'application/pdf'],
])

function isTextBuffer(buffer) {
  return !buffer.includes(0)
}

function assertPreparedRead(prepared) {
  if (!prepared || typeof prepared !== 'object' || !prepared.handle || typeof prepared.handle !== 'object'
    || typeof prepared.name !== 'string' || !prepared.name || typeof prepared.extension !== 'string') {
    throw new TypeError('Bersaglio lettura file progetto non valido.')
  }
  return prepared
}

function createProjectFileReader(host) {
  const fileReaderHost = assertProjectFileReaderHostPort(host)

  async function readProjectFile(workspacePath, fileId) {
    validateProjectEntryId(fileId)
    const prepared = assertPreparedRead(fileReaderHost.prepareRead(workspacePath, fileId))
    const { buffer, mtimeMs, size } = await fileReaderHost.readBounded(
      prepared.handle,
      MAX_FILE_SIZE,
      'Il file supera 1 MiB e non può essere aperto nell’editor.',
    )
    if (!isTextBuffer(buffer)) throw new Error('Il file sembra binario e non può essere aperto nell’editor.')
    return {
      id: fileId,
      name: prepared.name,
      content: buffer.toString('utf8'),
      revision: createFileRevision(buffer, { mtimeMs, size }),
      size,
    }
  }

  async function readProjectPreview(workspacePath, fileId) {
    validateProjectEntryId(fileId)
    const prepared = assertPreparedRead(fileReaderHost.prepareRead(workspacePath, fileId))
    const mimeType = PREVIEW_MIME_TYPES.get(prepared.extension)
    if (!mimeType) throw new Error('Questo formato non supporta l’anteprima.')
    const { buffer, size } = await fileReaderHost.readBounded(
      prepared.handle,
      MAX_PREVIEW_FILE_SIZE,
      'Il file supera 8 MiB e non può essere visualizzato in anteprima.',
    )
    return {
      id: fileId,
      name: prepared.name,
      kind: mimeType === 'application/pdf' ? 'pdf' : 'image',
      content: `data:${mimeType};base64,${buffer.toString('base64')}`,
      size,
    }
  }

  return Object.freeze({ readProjectFile, readProjectPreview })
}

module.exports = { createProjectFileReader }
