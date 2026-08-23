const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { assertRegularFile, writeFileAtomic } = require('./file-utils.cjs')
const { createPublicError } = require('./public-error.cjs')

const MAX_FILE_SIZE = 1_000_000
const MAX_PREVIEW_FILE_SIZE = 8 * 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 1_000
const DIRECTORY_SCAN_YIELD_INTERVAL = 256
const MAX_DIRECTORY_DUPLICATE_ENTRIES = 5_000
const MAX_DIRECTORY_DUPLICATE_BYTES = 64 * 1024 * 1024
const MAX_DUPLICATE_NAME_ATTEMPTS = 1_000
const FILE_REVISION_PATTERN = /^v1-[A-Za-z0-9_-]{43}$/u
const EXCLUDED_DIRECTORIES = new Set(['node_modules'])
const PREVIEW_MIME_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'], ['webp', 'image/webp'], ['pdf', 'application/pdf'],
])

function isEditorVisibleFile(fileName) {
  return typeof fileName === 'string' && fileName.length > 0
}

function assertEditorAccessibleFile(filePath) {
  if (!isEditorVisibleFile(path.basename(filePath))) throw new Error('Nome file non valido.')
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

function workspaceRoot(workspacePath) {
  return fs.realpathSync(workspacePath)
}

function toId(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function createFileRevision(buffer, stats) {
  const digest = createHash('sha256')
    .update('vincodelab-project-file-v1\0')
    .update(buffer)
    .update('\0')
    .update(String(stats.size))
    .update('\0')
    .update(String(Math.round(stats.mtimeMs * 1_000)))
    .digest('base64url')
  return `v1-${digest}`
}

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

function compareDirectoryEntries(left, right) {
  return Number(right.isDirectory) - Number(left.isDirectory)
    || left.name.localeCompare(right.name)
    || left.scanIndex - right.scanIndex
}

function pushBoundedDirectoryEntry(heap, entry, limit) {
  if (heap.length < limit) {
    heap.push(entry)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compareDirectoryEntries(heap[parent], heap[index]) >= 0) break
      ;[heap[parent], heap[index]] = [heap[index], heap[parent]]
      index = parent
    }
    return
  }

  if (compareDirectoryEntries(entry, heap[0]) >= 0) return
  heap[0] = entry
  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let worst = index
    if (left < heap.length && compareDirectoryEntries(heap[left], heap[worst]) > 0) worst = left
    if (right < heap.length && compareDirectoryEntries(heap[right], heap[worst]) > 0) worst = right
    if (worst === index) break
    ;[heap[index], heap[worst]] = [heap[worst], heap[index]]
    index = worst
  }
}

async function collectDirectoryEntries(directoryEntries, { limit = MAX_DIRECTORY_ENTRIES, yieldInterval = DIRECTORY_SCAN_YIELD_INTERVAL } = {}) {
  const retained = []
  let eligibleEntries = 0
  let scannedEntries = 0
  let peakRetainedEntries = 0

  for await (const entry of directoryEntries) {
    scannedEntries += 1
    const isDirectory = entry.isDirectory()
    if (!(isDirectory && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
      && (isDirectory || entry.isFile() || entry.isSymbolicLink())) {
      pushBoundedDirectoryEntry(retained, {
        name: entry.name,
        isDirectory,
        scanIndex: scannedEntries,
      }, limit)
      eligibleEntries += 1
      peakRetainedEntries = Math.max(peakRetainedEntries, retained.length)
    }

    // Anche un async iterable in memoria può produrre soltanto microtask: il yield
    // esplicito mantiene reattivo il processo main durante directory molto grandi.
    if (yieldInterval > 0 && scannedEntries % yieldInterval === 0) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  retained.sort(compareDirectoryEntries)
  return {
    entries: retained,
    truncated: eligibleEntries > limit,
    peakRetainedEntries,
  }
}

async function listDirectoryEntries(workspacePath, directoryId = '') {
  const root = workspaceRoot(workspacePath)
  if (directoryId) assertEditorAccessiblePath(directoryId)
  const directory = resolveProjectPath(workspacePath, directoryId, 'directory')
  const directoryHandle = await fs.promises.opendir(directory)
  const result = await collectDirectoryEntries(directoryHandle)
  return {
    entries: result.entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      // I symlink restano elencati per rendere il workspace completo, ma resolveProjectPath
      // continua a rifiutarli: l'editor non segue file esterni attraverso un collegamento.
      return { id: toId(path.relative(root, entryPath)), name: entry.name, kind: entry.isDirectory ? 'directory' : 'file' }
    }),
    truncated: result.truncated,
  }
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

function prepareProjectFileAttachment(workspacePath, fileId) {
  const absolutePath = fs.realpathSync(resolveProjectFile(workspacePath, fileId))
  fs.accessSync(absolutePath, fs.constants.R_OK)
  return { absolutePath, name: path.basename(absolutePath) }
}

function createProjectFile(workspacePath, directoryId, fileName) {
  validateProjectDirectoryId(directoryId)
  validateProjectEntryName(fileName)

  let directory
  try {
    directory = resolveProjectPath(workspacePath, directoryId, 'directory')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new Error('Cartella non trovata.')
    throw error
  }

  const filePath = path.join(directory, fileName)
  assertEditorAccessiblePath(directoryId ? `${directoryId}/${fileName}` : fileName)
  let descriptor
  try {
    descriptor = fs.openSync(filePath, 'wx', 0o644)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') throw new Error('Un file con questo nome esiste già.')
    throw error
  }
  fs.closeSync(descriptor)
  const fileId = directoryId ? `${directoryId}/${fileName}` : fileName
  const stats = fs.statSync(filePath)
  return { id: fileId, name: fileName, content: '', revision: createFileRevision(Buffer.alloc(0), stats), size: 0 }
}

function createProjectDirectory(workspacePath, parentId, directoryName) {
  validateProjectDirectoryId(parentId)
  validateProjectEntryName(directoryName)
  const parent = resolveProjectDirectory(workspacePath, parentId)
  const id = parentId ? `${parentId}/${directoryName}` : directoryName
  assertEditorAccessiblePath(id)
  const directoryPath = path.join(parent, directoryName)
  try {
    fs.mkdirSync(directoryPath, { mode: 0o755 })
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') throw new Error('Un elemento con questo nome esiste già.')
    throw error
  }
  return { id, kind: 'directory', name: directoryName }
}

function destinationIdFor(entryId, entryName) {
  const parentId = entryId.split('/').slice(0, -1).join('/')
  return parentId ? `${parentId}/${entryName}` : entryName
}

function sameFilesystemEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function reserveDestination(destinationPath, expectedKind) {
  try {
    if (expectedKind === 'directory') fs.mkdirSync(destinationPath, { mode: 0o700 })
    else fs.closeSync(fs.openSync(destinationPath, 'wx', 0o600))
    return { path: destinationPath, stats: fs.lstatSync(destinationPath), kind: expectedKind }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') return null
    throw error
  }
}

function releaseReservedDestination(reservation) {
  try {
    const current = fs.lstatSync(reservation.path)
    if (!sameFilesystemEntry(current, reservation.stats)) return
    if (reservation.kind === 'directory') fs.rmdirSync(reservation.path)
    else fs.unlinkSync(reservation.path)
  } catch (error) {
    // Il cleanup non deve cancellare una risorsa comparsa per concorrenza né
    // nascondere il failure originale della mutazione.
    if (!error || typeof error !== 'object' || !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error
  }
}

function renameProjectEntry(workspacePath, entryId, entryName, expectedKind) {
  validateProjectEntryKind(expectedKind)
  validateProjectEntryId(entryId)
  validateProjectEntryName(entryName)
  const sourcePath = resolveProjectEntry(workspacePath, entryId, expectedKind)
  const destinationId = destinationIdFor(entryId, entryName)
  assertEditorAccessiblePath(destinationId)
  if (destinationId === entryId) return { id: entryId, kind: expectedKind, name: entryName, previousId: entryId, renamed: false }

  const destinationPath = path.join(path.dirname(sourcePath), entryName)
  const sourceStats = fs.lstatSync(sourcePath)
  try {
    const destinationStats = fs.lstatSync(destinationPath)
    if (!sameFilesystemEntry(sourceStats, destinationStats)) throw new Error('Un elemento con questo nome esiste già.')
    // Due nomi distinti dello stesso file implicano almeno due hard link. In
    // quel caso la destinazione esiste davvero e non va confusa con l'alias di
    // maiuscole/minuscole restituito da un filesystem case-insensitive.
    if (sourceStats.isFile() && sourceStats.nlink > 1) throw new Error('Un elemento con questo nome esiste già.')
    // Su filesystem case-insensitive il nuovo spelling può risolvere allo stesso inode.
    fs.renameSync(sourcePath, destinationPath)
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
    const reservation = reserveDestination(destinationPath, expectedKind)
    if (!reservation) throw new Error('Un elemento con questo nome esiste già.')
    try {
      fs.renameSync(sourcePath, destinationPath)
    } catch (renameError) {
      releaseReservedDestination(reservation)
      throw renameError
    }
  }
  return { id: destinationId, kind: expectedKind, name: entryName, previousId: entryId, renamed: true }
}

function duplicateEntryName(entryName, expectedKind, attempt) {
  const extension = expectedKind === 'file' ? path.extname(entryName) : ''
  const stem = extension ? entryName.slice(0, -extension.length) : entryName
  const suffix = attempt === 1 ? ' copia' : ` copia ${attempt}`
  return validateProjectEntryName(`${stem}${suffix}${extension}`)
}

async function inspectDirectoryForDuplicate(directoryPath) {
  const pending = [directoryPath]
  let entries = 0
  let bytes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    const directory = await fs.promises.opendir(current)
    for await (const entry of directory) {
      const entryPath = path.join(current, entry.name)
      const stats = await fs.promises.lstat(entryPath)
      if (stats.isSymbolicLink()) throw new Error('Le cartelle contenenti link simbolici non possono essere duplicate.')
      if (stats.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) throw new Error('Le cartelle contenenti node_modules non possono essere duplicate.')
        pending.push(entryPath)
      } else if (stats.isFile()) bytes += stats.size
      else throw new Error('La cartella contiene un elemento non supportato e non può essere duplicata.')
      entries += 1
      if (entries > MAX_DIRECTORY_DUPLICATE_ENTRIES || bytes > MAX_DIRECTORY_DUPLICATE_BYTES) {
        throw new Error('La cartella supera il limite di 5.000 elementi o 64 MiB e non può essere duplicata.')
      }
    }
  }
  return { bytes, entries }
}

async function copyDirectoryWithoutFollowingSymlinks(sourcePath, temporaryPath) {
  await inspectDirectoryForDuplicate(sourcePath)
  await fs.promises.cp(sourcePath, temporaryPath, {
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
    filter: async (source) => {
      const stats = await fs.promises.lstat(source)
      if (stats.isSymbolicLink()) throw new Error('Le cartelle contenenti link simbolici non possono essere duplicate.')
      if (stats.isDirectory() && source !== sourcePath && EXCLUDED_DIRECTORIES.has(path.basename(source).toLowerCase())) {
        throw new Error('Le cartelle contenenti node_modules non possono essere duplicate.')
      }
      return true
    },
  })
  await inspectDirectoryForDuplicate(temporaryPath)
}

async function openRegularFileWithoutFollowingSymlinks(filePath) {
  let handle
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error('Il file da duplicare non è un file regolare.')
    return { handle, stats }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    if (error && typeof error === 'object' && error.code === 'ELOOP') {
      throw new Error('I link simbolici non sono accessibili dall’editor.')
    }
    throw error
  }
}

async function copyOpenProjectFile(source, destination) {
  const buffer = Buffer.allocUnsafe(256 * 1024)
  let position = 0
  while (position < source.stats.size) {
    const requested = Math.min(buffer.length, source.stats.size - position)
    const { bytesRead } = await source.handle.read(buffer, 0, requested, position)
    if (bytesRead === 0) throw new Error('Il file è cambiato durante la duplicazione. Riprova.')
    let written = 0
    while (written < bytesRead) {
      const result = await destination.write(buffer, written, bytesRead - written, position + written)
      if (result.bytesWritten === 0) throw new Error('La copia del file non è stata completata.')
      written += result.bytesWritten
    }
    position += bytesRead
  }
  const finalStats = await source.handle.stat()
  if (!sameFilesystemEntry(source.stats, finalStats) || finalStats.size !== source.stats.size || finalStats.mtimeMs !== source.stats.mtimeMs) {
    throw new Error('Il file è cambiato durante la duplicazione. Riprova.')
  }
}

async function duplicateProjectEntry(workspacePath, entryId, expectedKind) {
  validateProjectEntryKind(expectedKind)
  validateProjectEntryId(entryId)
  const sourcePath = resolveProjectEntry(workspacePath, entryId, expectedKind)
  const sourceName = path.basename(sourcePath)
  const parentPath = path.dirname(sourcePath)

  if (expectedKind === 'file') {
    const source = await openRegularFileWithoutFollowingSymlinks(sourcePath)
    try {
      for (let attempt = 1; attempt <= MAX_DUPLICATE_NAME_ATTEMPTS; attempt += 1) {
        const name = duplicateEntryName(sourceName, expectedKind, attempt)
        const destinationPath = path.join(parentPath, name)
        let destination
        try {
          destination = await fs.promises.open(destinationPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, source.stats.mode & 0o777)
        } catch (error) {
          if (error && typeof error === 'object' && error.code === 'EEXIST') continue
          throw error
        }
        const reservation = { path: destinationPath, stats: await destination.stat(), kind: expectedKind }
        try {
          await copyOpenProjectFile(source, destination)
          await destination.chmod(source.stats.mode & 0o777)
          await destination.close()
          destination = undefined
          return { id: destinationIdFor(entryId, name), kind: expectedKind, name, sourceId: entryId }
        } catch (error) {
          await destination?.close().catch(() => undefined)
          releaseReservedDestination(reservation)
          throw error
        }
      }
      throw new Error('Impossibile trovare un nome disponibile per la copia.')
    } finally {
      await source.handle.close().catch(() => undefined)
    }
  }

  const temporaryPath = path.join(parentPath, `.vincodelab-duplicate-${randomUUID()}`)
  try {
    await copyDirectoryWithoutFollowingSymlinks(sourcePath, temporaryPath)
    for (let attempt = 1; attempt <= MAX_DUPLICATE_NAME_ATTEMPTS; attempt += 1) {
      const name = duplicateEntryName(sourceName, expectedKind, attempt)
      const destinationPath = path.join(parentPath, name)
      const reservation = reserveDestination(destinationPath, expectedKind)
      if (!reservation) continue
      try {
        await fs.promises.rename(temporaryPath, destinationPath)
        return { id: destinationIdFor(entryId, name), kind: expectedKind, name, sourceId: entryId }
      } catch (error) {
        releaseReservedDestination(reservation)
        throw error
      }
    }
    throw new Error('Impossibile trovare un nome disponibile per la copia.')
  } finally {
    await fs.promises.rm(temporaryPath, { force: true, recursive: true }).catch(() => {
      // Il percorso è temporaneo e casuale; un cleanup fallito non deve oscurare
      // la causa principale, che verrà comunque registrata dal confine IPC.
    })
  }
}

function isTextBuffer(buffer) {
  return !buffer.includes(0)
}

async function listProjectFiles(workspacePath) {
  return listDirectoryEntries(workspacePath)
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

async function readProjectFile(workspacePath, fileId) {
  const filePath = resolveProjectFile(workspacePath, fileId)
  const { buffer, revision, size } = await readBoundedFile(filePath, MAX_FILE_SIZE, 'Il file supera 1 MiB e non può essere aperto nell’editor.')
  if (!isTextBuffer(buffer)) throw new Error('Il file sembra binario e non può essere aperto nell’editor.')
  return { id: fileId, name: path.basename(filePath), content: buffer.toString('utf8'), revision, size }
}

async function readProjectPreview(workspacePath, fileId) {
  const filePath = resolveProjectFile(workspacePath, fileId)
  const extension = path.extname(filePath).slice(1).toLowerCase()
  const mimeType = PREVIEW_MIME_TYPES.get(extension)
  if (!mimeType) throw new Error('Questo formato non supporta l’anteprima.')
  const { buffer, size } = await readBoundedFile(filePath, MAX_PREVIEW_FILE_SIZE, 'Il file supera 8 MiB e non può essere visualizzato in anteprima.')
  const content = buffer.toString('base64')
  return { id: fileId, name: path.basename(filePath), kind: mimeType === 'application/pdf' ? 'pdf' : 'image', content: `data:${mimeType};base64,${content}`, size }
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
  collectDirectoryEntries,
  createProjectDirectory,
  createProjectFile,
  duplicateProjectEntry,
  isEditorVisibleFile,
  listDirectoryEntries,
  listProjectFiles,
  openProjectFileWith,
  prepareProjectFileAttachment,
  readProjectFile,
  readProjectPreview,
  renameProjectEntry,
  resolveProjectDirectory,
  resolveProjectFile,
  revealProjectDirectory,
  revealProjectFile,
  saveProjectFile,
}
