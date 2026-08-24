const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const githubRoot = path.join(projectRoot, 'src/features/github')

function sourceFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(absolutePath)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path.relative(projectRoot, absolutePath)] : []
  })
}

const githubSourceFiles = sourceFilesUnder(githubRoot).sort()

function readGitHubSource() {
  return githubSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

function readGitHubModule(relativePath) {
  return fs.readFileSync(path.join(githubRoot, relativePath), 'utf8')
}

module.exports = { githubSourceFiles, readGitHubModule, readGitHubSource }
