const fs = require('node:fs')
const path = require('node:path')
const { createProjectDirectoryListingHostPort } = require('../../domains/filesystem/project-directory-listing-host.port.cjs')

function toId(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function resolveDirectory(workspacePath, relativePath) {
  const root = fs.realpathSync(workspacePath)
  const segments = relativePath ? relativePath.split('/').filter(Boolean) : []
  if ((typeof relativePath !== 'string' && relativePath !== undefined)
    || segments.some((segment) => segment === '.' || segment === '..' || segment.includes(path.sep))) {
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
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('Cartella non trovata.')
  return {
    directory: current,
    directoryId: toId(path.relative(root, current)),
  }
}

function neutralEntry(entry) {
  const kind = entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : entry.isSymbolicLink()
        ? 'symbolic-link'
        : 'unsupported'
  return Object.freeze({ kind, name: entry.name })
}

async function* streamDirectoryEntries(directoryHandle) {
  for await (const entry of directoryHandle) yield neutralEntry(entry)
}

function createProjectDirectoryListingFilesystemAdapter() {
  return createProjectDirectoryListingHostPort({
    async openDirectory(workspacePath, directoryId = '') {
      const resolved = resolveDirectory(workspacePath, directoryId)
      const directoryHandle = await fs.promises.opendir(resolved.directory)
      return Object.freeze({
        directoryId: resolved.directoryId,
        entries: streamDirectoryEntries(directoryHandle),
      })
    },
  })
}

module.exports = { createProjectDirectoryListingFilesystemAdapter }
