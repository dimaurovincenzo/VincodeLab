const fs = require('node:fs')
const path = require('node:path')
const { createProjectFileIndexHostPort } = require('../../domains/filesystem/project-file-index-host.port.cjs')

function normalizeWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.includes('\0') || !path.isAbsolute(workspacePath)) {
    throw new Error('Percorso workspace non valido.')
  }
  return path.resolve(workspacePath)
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function assertPathInside(root, candidate) {
  if (!isPathInside(root, candidate)) throw new Error('Il percorso indicizzato esce dal workspace.')
}

function toEntryId(root, entryPath) {
  assertPathInside(root, entryPath)
  const relativePath = path.relative(root, entryPath)
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Percorso file indicizzato non valido.')
  return relativePath.split(path.sep).join('/')
}

function directoryPath(root, directoryId) {
  const candidate = directoryId
    ? path.resolve(root, ...directoryId.split('/'))
    : root
  assertPathInside(root, candidate)
  return candidate
}

function entryPath(root, directoryId, entryName) {
  if (typeof entryName !== 'string' || !entryName || entryName === '.' || entryName === '..' || entryName.includes('/') || entryName.includes('\\') || entryName.includes('\0')) {
    throw new Error('Percorso file indicizzato non valido.')
  }
  const candidate = path.resolve(directoryPath(root, directoryId), entryName)
  assertPathInside(root, candidate)
  return candidate
}

function statsKind(stats) {
  if (stats.isSymbolicLink()) return 'symbolic-link'
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  return 'unsupported'
}

function createProjectFileIndexFilesystemAdapter() {
  return createProjectFileIndexHostPort({
    async inspectEntry(root, directoryId, entryName) {
      const absolutePath = entryPath(root, directoryId, entryName)
      const stats = await fs.promises.lstat(absolutePath)
      const kind = statsKind(stats)
      if (kind === 'directory') {
        return Object.freeze({ kind, directoryId: toEntryId(root, absolutePath) })
      }
      if (kind === 'file') {
        const id = toEntryId(root, absolutePath)
        return Object.freeze({
          kind,
          file: Object.freeze({
            id,
            name: entryName,
            directory: path.posix.dirname(id) === '.' ? '' : path.posix.dirname(id),
            extension: path.extname(entryName).slice(1).toLowerCase(),
            size: stats.size,
            modifiedAt: stats.mtimeMs,
          }),
        })
      }
      return Object.freeze({ kind })
    },

    normalizeWorkspacePath,

    async readDirectory(root, directoryId) {
      const absolutePath = directoryPath(root, directoryId)
      const stats = await fs.promises.lstat(absolutePath)
      const kind = statsKind(stats)
      if (kind !== 'directory') return Object.freeze({ kind })

      const realPath = path.resolve(await fs.promises.realpath(absolutePath))
      assertPathInside(root, realPath)
      if (realPath !== absolutePath) return Object.freeze({ kind: 'symbolic-link' })

      const handle = await fs.promises.opendir(realPath)
      const entries = []
      for await (const entry of handle) {
        entries.push(Object.freeze({ name: entry.name, symbolicLink: entry.isSymbolicLink() }))
      }
      return Object.freeze({ kind: 'directory', entries: Object.freeze(entries) })
    },

    async resolveWorkspace(workspacePath) {
      const requestedPath = normalizeWorkspacePath(workspacePath)
      const root = path.resolve(await fs.promises.realpath(requestedPath))
      const stats = await fs.promises.lstat(root)
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Il workspace non è una directory valida.')
      return Object.freeze({ requestedPath, root })
    },
  })
}

module.exports = { createProjectFileIndexFilesystemAdapter }
