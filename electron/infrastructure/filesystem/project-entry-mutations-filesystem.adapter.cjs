const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const {
  isEditorVisibleFile,
  validateProjectDirectoryId,
  validateProjectEntryId,
  validateProjectEntryKind,
} = require('../../domains/filesystem/project-access-policy.cjs')
const {
  PROJECT_ENTRY_DUPLICATE_RESULTS,
  createProjectEntryMutationsHostPort,
} = require('../../domains/filesystem/project-entry-mutations-host.port.cjs')
const {
  assertRegularProjectFile,
  resolveExistingProjectPath,
} = require('./project-path-filesystem.service.cjs')

function segmentsForId(entryId) {
  return entryId ? entryId.split('/') : []
}

function assertEditorAccessibleFile(filePath) {
  if (!isEditorVisibleFile(path.basename(filePath))) throw new Error('Nome file non valido.')
}

function resolveDirectory(workspacePath, directoryId) {
  validateProjectDirectoryId(directoryId)
  return resolveExistingProjectPath(workspacePath, segmentsForId(directoryId), 'directory').absolutePath
}

function resolveEntry(workspacePath, entryId, expectedKind) {
  validateProjectEntryId(entryId)
  validateProjectEntryKind(expectedKind)
  const entryPath = resolveExistingProjectPath(workspacePath, segmentsForId(entryId), expectedKind).absolutePath
  if (expectedKind === 'file') {
    assertRegularProjectFile(entryPath, 'File non trovato.')
    assertEditorAccessibleFile(entryPath)
  }
  return entryPath
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

function entryKind(stats) {
  if (stats.isSymbolicLink()) return 'symbolic-link'
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  return 'unsupported'
}

async function* directoryEntries(directoryPath) {
  const pending = [directoryPath]
  while (pending.length > 0) {
    const current = pending.pop()
    const directory = await fs.promises.opendir(current)
    for await (const entry of directory) {
      const entryPath = path.join(current, entry.name)
      const stats = await fs.promises.lstat(entryPath)
      const kind = entryKind(stats)
      if (kind === 'directory') pending.push(entryPath)
      yield Object.freeze({ kind, name: entry.name, size: kind === 'file' ? stats.size : 0 })
    }
  }
}

async function stageDirectoryCopy(sourcePath, temporaryPath, policies) {
  await policies.inspectDirectory(directoryEntries(sourcePath))
  await fs.promises.cp(sourcePath, temporaryPath, {
    dereference: false,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
    recursive: true,
    filter: async (source) => {
      const stats = await fs.promises.lstat(source)
      policies.validateCopyEntry(Object.freeze({
        isRoot: source === sourcePath,
        kind: entryKind(stats),
        name: path.basename(source),
      }))
      return true
    },
  })
  await policies.inspectDirectory(directoryEntries(temporaryPath))
}

async function copyOpenProjectFile(source, destination) {
  const buffer = Buffer.allocUnsafe(256 * 1024)
  let position = 0
  while (position < source.stats.size) {
    const requested = Math.min(buffer.length, source.stats.size - position)
    const { bytesRead } = await source.fileHandle.read(buffer, 0, requested, position)
    if (bytesRead === 0) return PROJECT_ENTRY_DUPLICATE_RESULTS.sourceChanged
    let written = 0
    while (written < bytesRead) {
      const result = await destination.write(buffer, written, bytesRead - written, position + written)
      if (result.bytesWritten === 0) return PROJECT_ENTRY_DUPLICATE_RESULTS.copyIncomplete
      written += result.bytesWritten
    }
    position += bytesRead
  }
  const finalStats = await source.fileHandle.stat()
  if (!sameFilesystemEntry(source.stats, finalStats) || finalStats.size !== source.stats.size || finalStats.mtimeMs !== source.stats.mtimeMs) {
    return PROJECT_ENTRY_DUPLICATE_RESULTS.sourceChanged
  }
  return PROJECT_ENTRY_DUPLICATE_RESULTS.created
}

function createProjectEntryMutationsFilesystemAdapter() {
  const targets = new WeakMap()

  function registerTarget(target) {
    const handle = Object.freeze({})
    targets.set(handle, target)
    return handle
  }

  function targetFor(handle, expectedType) {
    const target = handle && typeof handle === 'object' ? targets.get(handle) : undefined
    if (!target || target.type !== expectedType || target.disposed === true) {
      throw new TypeError('Handle mutazione progetto non valido.')
    }
    return target
  }

  async function prepareDuplicate(workspacePath, entryId, expectedKind, policies) {
    const sourcePath = resolveEntry(workspacePath, entryId, expectedKind)
    const sourceName = path.basename(sourcePath)
    const parentPath = path.dirname(sourcePath)

    if (expectedKind === 'file') {
      let fileHandle
      try {
        fileHandle = await fs.promises.open(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
        const stats = await fileHandle.stat()
        if (!stats.isFile()) {
          await fileHandle.close().catch(() => undefined)
          return Object.freeze({ status: PROJECT_ENTRY_DUPLICATE_RESULTS.notRegular })
        }
        const handle = registerTarget({ disposed: false, fileHandle, kind: 'file', parentPath, stats, type: 'duplicate' })
        return Object.freeze({ handle, name: sourceName, status: PROJECT_ENTRY_DUPLICATE_RESULTS.ready })
      } catch (error) {
        await fileHandle?.close().catch(() => undefined)
        if (error && typeof error === 'object' && error.code === 'ELOOP') {
          return Object.freeze({ status: PROJECT_ENTRY_DUPLICATE_RESULTS.symbolicLink })
        }
        throw error
      }
    }

    const temporaryPath = path.join(parentPath, `.vincodelab-duplicate-${randomUUID()}`)
    try {
      await stageDirectoryCopy(sourcePath, temporaryPath, policies)
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
    const handle = registerTarget({ disposed: false, kind: 'directory', parentPath, temporaryPath, type: 'duplicate' })
    return Object.freeze({ handle, name: sourceName, status: PROJECT_ENTRY_DUPLICATE_RESULTS.ready })
  }

  async function tryDuplicate(handle, name) {
    const source = targetFor(handle, 'duplicate')
    const destinationPath = path.join(source.parentPath, name)
    if (source.kind === 'directory') {
      const reservation = reserveDestination(destinationPath, 'directory')
      if (!reservation) return PROJECT_ENTRY_DUPLICATE_RESULTS.collision
      try {
        // La reservation resta deliberatamente separata dal rename: il relativo
        // race di sostituzione è un defect distinto da questa slice strutturale.
        await fs.promises.rename(source.temporaryPath, destinationPath)
        return PROJECT_ENTRY_DUPLICATE_RESULTS.created
      } catch (error) {
        releaseReservedDestination(reservation)
        throw error
      }
    }

    let destination
    try {
      destination = await fs.promises.open(
        destinationPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        source.stats.mode & 0o777,
      )
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EEXIST') return PROJECT_ENTRY_DUPLICATE_RESULTS.collision
      throw error
    }
    const reservation = { path: destinationPath, stats: await destination.stat(), kind: 'file' }
    try {
      const result = await copyOpenProjectFile(source, destination)
      if (result !== PROJECT_ENTRY_DUPLICATE_RESULTS.created) {
        await destination.close().catch(() => undefined)
        destination = undefined
        releaseReservedDestination(reservation)
        return result
      }
      await destination.chmod(source.stats.mode & 0o777)
      await destination.close()
      destination = undefined
      return PROJECT_ENTRY_DUPLICATE_RESULTS.created
    } catch (error) {
      await destination?.close().catch(() => undefined)
      releaseReservedDestination(reservation)
      throw error
    }
  }

  async function disposeDuplicate(handle) {
    const target = targetFor(handle, 'duplicate')
    target.disposed = true
    if (target.kind === 'file') await target.fileHandle.close().catch(() => undefined)
    else await fs.promises.rm(target.temporaryPath, { force: true, recursive: true }).catch(() => undefined)
  }

  return createProjectEntryMutationsHostPort({
    createDirectoryExclusive(directoryHandle, directoryName, mode) {
      const parent = targetFor(directoryHandle, 'directory')
      try {
        fs.mkdirSync(path.join(parent.directoryPath, directoryName), { mode })
        return true
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'EEXIST') return false
        throw error
      }
    },

    createFileExclusive(directoryHandle, fileName, mode) {
      const directory = targetFor(directoryHandle, 'directory')
      const filePath = path.join(directory.directoryPath, fileName)
      let descriptor
      try {
        descriptor = fs.openSync(filePath, 'wx', mode)
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'EEXIST') return null
        throw error
      }
      fs.closeSync(descriptor)
      const stats = fs.statSync(filePath)
      return Object.freeze({ mtimeMs: stats.mtimeMs, size: stats.size })
    },

    async disposeDuplicate(handle) {
      await disposeDuplicate(handle)
    },

    prepareDirectory(workspacePath, directoryId) {
      const directoryPath = resolveDirectory(workspacePath, directoryId)
      return registerTarget({ directoryPath, type: 'directory' })
    },

    async prepareDuplicate(workspacePath, entryId, expectedKind, policies) {
      return prepareDuplicate(workspacePath, entryId, expectedKind, policies)
    },

    prepareRename(workspacePath, entryId, expectedKind) {
      const sourcePath = resolveEntry(workspacePath, entryId, expectedKind)
      return registerTarget({ expectedKind, sourcePath, type: 'rename' })
    },

    rename(handle, entryName) {
      const target = targetFor(handle, 'rename')
      const destinationPath = path.join(path.dirname(target.sourcePath), entryName)
      const sourceStats = fs.lstatSync(target.sourcePath)
      try {
        const destinationStats = fs.lstatSync(destinationPath)
        if (!sameFilesystemEntry(sourceStats, destinationStats)) return false
        if (sourceStats.isFile() && sourceStats.nlink > 1) return false
        fs.renameSync(target.sourcePath, destinationPath)
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
        const reservation = reserveDestination(destinationPath, target.expectedKind)
        if (!reservation) return false
        try {
          // Mantiene la sequenza storica reservation -> rename senza un nuovo lstat.
          fs.renameSync(target.sourcePath, destinationPath)
        } catch (renameError) {
          releaseReservedDestination(reservation)
          throw renameError
        }
      }
      return true
    },

    async tryDuplicate(handle, name) {
      return tryDuplicate(handle, name)
    },
  })
}

module.exports = { createProjectEntryMutationsFilesystemAdapter }
