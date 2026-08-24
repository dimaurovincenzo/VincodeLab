const fs = require('node:fs')
const path = require('node:path')
const { createProjectInstructionsStoragePort } = require('../../domains/ai/project-instructions-storage.port.cjs')
const { assertDirectoryOrCreate, assertRegularFile, writeFileAtomic } = require('../../domains/filesystem/file-utils.cjs')

const INSTRUCTIONS_FILE = path.join('.pi', 'APPEND_SYSTEM.md')

function getInstructionsPath(workspacePath) {
  return path.join(workspacePath, INSTRUCTIONS_FILE)
}

function createProjectInstructionsFilesystemAdapter() {
  return createProjectInstructionsStoragePort({
    read(workspacePath) {
      const filePath = getInstructionsPath(workspacePath)
      if (!fs.existsSync(filePath)) return null
      assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
      return fs.readFileSync(filePath, 'utf8')
    },

    remove(workspacePath) {
      const filePath = getInstructionsPath(workspacePath)
      if (!fs.existsSync(filePath)) return
      assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
      fs.rmSync(filePath)
    },

    write(workspacePath, content) {
      const filePath = getInstructionsPath(workspacePath)
      assertDirectoryOrCreate(path.dirname(filePath))
      if (fs.existsSync(filePath)) assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
      writeFileAtomic(filePath, content)
    },
  })
}

module.exports = { createProjectInstructionsFilesystemAdapter }
