const fs = require('node:fs')
const path = require('node:path')
const { createProjectInstructionsStoragePort } = require('../../domains/ai/project-instructions-storage.port.cjs')
const { writeFileAtomic } = require('./project-file-io-filesystem.service.cjs')
const { assertRegularProjectFile } = require('./project-path-filesystem.service.cjs')

const INSTRUCTIONS_FILE = path.join('.pi', 'APPEND_SYSTEM.md')

function getInstructionsPath(workspacePath) {
  return path.join(workspacePath, INSTRUCTIONS_FILE)
}

function assertDirectoryOrCreate(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    const stats = fs.lstatSync(directoryPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory progetto non è sicura.')
    return
  }
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
}

function createProjectInstructionsFilesystemAdapter() {
  return createProjectInstructionsStoragePort({
    read(workspacePath) {
      const filePath = getInstructionsPath(workspacePath)
      if (!fs.existsSync(filePath)) return null
      assertRegularProjectFile(filePath, 'Istruzioni progetto non trovate.')
      return fs.readFileSync(filePath, 'utf8')
    },

    remove(workspacePath) {
      const filePath = getInstructionsPath(workspacePath)
      if (!fs.existsSync(filePath)) return
      assertRegularProjectFile(filePath, 'Istruzioni progetto non trovate.')
      fs.rmSync(filePath)
    },

    write(workspacePath, content) {
      const filePath = getInstructionsPath(workspacePath)
      assertDirectoryOrCreate(path.dirname(filePath))
      if (fs.existsSync(filePath)) assertRegularProjectFile(filePath, 'Istruzioni progetto non trovate.')
      writeFileAtomic(filePath, content)
    },
  })
}

module.exports = { createProjectInstructionsFilesystemAdapter }
