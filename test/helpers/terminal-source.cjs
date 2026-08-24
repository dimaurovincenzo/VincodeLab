const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const terminalRoot = path.join(projectRoot, 'src/features/terminal')

function sourceFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(absolutePath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.relative(projectRoot, absolutePath)] : []
  })
}

const terminalSourceFiles = sourceFilesUnder(terminalRoot).sort()

function readTerminalSource() {
  return terminalSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

function readTerminalModule(relativePath) {
  return fs.readFileSync(path.join(terminalRoot, relativePath), 'utf8')
}

module.exports = { readTerminalModule, readTerminalSource, terminalSourceFiles }
