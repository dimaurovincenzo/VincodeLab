const fs = require('node:fs')
const path = require('node:path')

function prepareTerminalAttachment(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || !path.isAbsolute(filePath)) {
    throw new Error('Il percorso allegato deve essere assoluto e valido.')
  }

  let stats
  try {
    stats = fs.lstatSync(filePath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('Il file allegato non disponibile.')
    throw error
  }

  if (stats.isSymbolicLink()) throw new Error('I link simbolici non possono essere allegati.')
  if (!stats.isFile()) throw new Error('L’allegato deve essere un file regolare.')

  const absolutePath = fs.realpathSync(filePath)
  fs.accessSync(absolutePath, fs.constants.R_OK)
  return { absolutePath, name: path.basename(absolutePath) }
}

module.exports = { prepareTerminalAttachment }
