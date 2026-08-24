const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createFileRevision } = require('./project-file-revision.cjs')
const {
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  resolveProjectDirectory,
  resolveProjectEntry,
  resolveProjectPath,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
  validateProjectEntryName,
} = require('./project-path-model.cjs')

const MAX_DIRECTORY_DUPLICATE_ENTRIES = 5_000
const MAX_DIRECTORY_DUPLICATE_BYTES = 64 * 1024 * 1024
const MAX_DUPLICATE_NAME_ATTEMPTS = 1_000

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

module.exports = {
  createProjectDirectory,
  createProjectFile,
  duplicateProjectEntry,
  renameProjectEntry,
}
