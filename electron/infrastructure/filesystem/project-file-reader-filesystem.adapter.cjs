const fs = require('node:fs')
const path = require('node:path')
const { createProjectFileReaderHostPort } = require('../../domains/filesystem/project-file-reader-host.port.cjs')
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
      const noFollow = fs.constants.O_NOFOLLOW ?? 0
      const fileHandle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow)
      try {
        const before = await fileHandle.stat()
        if (!before.isFile()) throw new Error('Il file richiesto non è un file regolare.')
        if (before.size > maxSize) throw new Error(tooLargeMessage)

        const allocation = Buffer.allocUnsafe(before.size + 1)
        let bytesRead = 0
        while (bytesRead < allocation.length) {
          const result = await fileHandle.read(allocation, bytesRead, allocation.length - bytesRead, null)
          if (result.bytesRead === 0) break
          bytesRead += result.bytesRead
        }

        const after = await fileHandle.stat()
        if (bytesRead > maxSize || after.size > maxSize) throw new Error(tooLargeMessage)
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.size !== bytesRead) {
          throw new Error('Il file è cambiato durante la lettura. Riprova.')
        }
        return { buffer: allocation.subarray(0, bytesRead), mtimeMs: after.mtimeMs, size: after.size }
      } finally {
        await fileHandle.close()
      }
    },
  })
}

module.exports = { createProjectFileReaderFilesystemAdapter }
