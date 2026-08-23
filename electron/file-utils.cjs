const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function writeFileAtomic(filePath, content, mode = 0o600) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)

  try {
    fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' })
    fs.renameSync(temporaryPath, filePath)
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true })
  }
}

function assertRegularFile(filePath, notFoundMessage) {
  let stats
  try {
    stats = fs.lstatSync(filePath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(notFoundMessage)
    throw error
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Il file richiesto non è un file regolare.')
}

function assertDirectoryOrCreate(directoryPath) {
  if (fs.existsSync(directoryPath)) {
    const stats = fs.lstatSync(directoryPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory progetto non è sicura.')
    return
  }
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 })
}

module.exports = { assertDirectoryOrCreate, assertRegularFile, writeFileAtomic }
