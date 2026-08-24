const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const remoteFilesRoot = path.join(projectRoot, 'src/features/remote-files')

function sourceFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(absolutePath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.relative(projectRoot, absolutePath)] : []
  })
}

const remoteFilesSourceFiles = sourceFilesUnder(remoteFilesRoot).sort()

function readRemoteFilesSource() {
  return remoteFilesSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

function readRemoteFilesModule(relativePath) {
  return fs.readFileSync(path.join(remoteFilesRoot, relativePath), 'utf8')
}

module.exports = { readRemoteFilesModule, readRemoteFilesSource, remoteFilesSourceFiles }
