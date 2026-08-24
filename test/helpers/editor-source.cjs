const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const editorRoot = path.join(projectRoot, 'src/features/editor')

function sourceFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(absolutePath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.relative(projectRoot, absolutePath)] : []
  })
}

const editorSourceFiles = sourceFilesUnder(editorRoot).sort()

function readEditorSource() {
  return editorSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

function readEditorModule(relativePath) {
  return fs.readFileSync(path.join(editorRoot, relativePath), 'utf8')
}

module.exports = { editorSourceFiles, readEditorModule, readEditorSource }
