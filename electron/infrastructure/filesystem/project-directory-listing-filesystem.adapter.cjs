const fs = require('node:fs')
const { createProjectDirectoryListingHostPort } = require('../../domains/filesystem/project-directory-listing-host.port.cjs')
const { resolveExistingProjectPath } = require('./project-path-filesystem.service.cjs')

function resolveDirectory(workspacePath, relativePath) {
  const segments = relativePath ? relativePath.split('/').filter(Boolean) : []
  if ((typeof relativePath !== 'string' && relativePath !== undefined)
    || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Percorso file non valido.')
  }
  const resolved = resolveExistingProjectPath(workspacePath, segments, 'directory')
  return { directory: resolved.absolutePath, directoryId: resolved.id }
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
