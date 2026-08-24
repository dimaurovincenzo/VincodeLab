const fs = require('node:fs')
const path = require('node:path')

function validateTraversalSegments(segments) {
  if (!Array.isArray(segments)
    || segments.some((segment) => typeof segment !== 'string' || !segment || segment === '.' || segment === '..' || segment.includes(path.sep))) {
    throw new Error('Percorso file non valido.')
  }
}

function toProjectId(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function resolveExistingProjectPath(workspacePath, segments, expectedKind) {
  validateTraversalSegments(segments)
  if (expectedKind !== 'file' && expectedKind !== 'directory') throw new Error('Tipo elemento non valido.')

  const root = fs.realpathSync(workspacePath)
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stats = fs.lstatSync(current)
    if (stats.isSymbolicLink()) throw new Error('I link simbolici non sono accessibili dall’editor.')
  }
  if (current !== root && !current.startsWith(`${root}${path.sep}`)) throw new Error('Percorso file non valido.')

  const stats = fs.lstatSync(current)
  if (stats.isSymbolicLink() || (expectedKind === 'file' && !stats.isFile()) || (expectedKind === 'directory' && !stats.isDirectory())) {
    throw new Error(expectedKind === 'file' ? 'File non trovato.' : 'Cartella non trovata.')
  }
  return {
    absolutePath: current,
    id: toProjectId(path.relative(root, current)),
  }
}

function assertRegularProjectFile(filePath, notFoundMessage) {
  let stats
  try {
    stats = fs.lstatSync(filePath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(notFoundMessage)
    throw error
  }
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Il file richiesto non è un file regolare.')
}

module.exports = {
  assertRegularProjectFile,
  resolveExistingProjectPath,
}
