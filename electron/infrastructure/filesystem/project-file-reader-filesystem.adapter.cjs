const path = require('node:path')
const { createProjectFileReaderHostPort } = require('../../domains/filesystem/project-file-reader-host.port.cjs')
const { readBoundedFile } = require('./project-file-io-filesystem.service.cjs')
const {
  assertRegularProjectFile,
  resolveExistingProjectPath,
} = require('./project-path-filesystem.service.cjs')

function createProjectFileReaderFilesystemAdapter() {
  const targets = new WeakMap()

  function targetFor(handle) {
    const target = handle && typeof handle === 'object' ? targets.get(handle) : undefined
    if (!target) throw new TypeError('Handle lettura file progetto non valido.')
    return target
  }

  return createProjectFileReaderHostPort({
    prepareRead(workspacePath, fileId) {
      const filePath = resolveExistingProjectPath(workspacePath, fileId.split('/'), 'file').absolutePath
      assertRegularProjectFile(filePath, 'File non trovato.')
      const handle = Object.freeze({})
      targets.set(handle, { filePath })
      return Object.freeze({
        extension: path.extname(filePath).slice(1).toLowerCase(),
        handle,
        name: path.basename(filePath),
      })
    },

    async readBounded(handle, maxSize, tooLargeMessage) {
      const { filePath } = targetFor(handle)
      return readBoundedFile(filePath, maxSize, tooLargeMessage)
    },
  })
}

module.exports = { createProjectFileReaderFilesystemAdapter }
