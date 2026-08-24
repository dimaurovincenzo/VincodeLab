const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_GITHUB_CLI_DIRECTORIES = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
]

function isExecutable(candidate) {
  if (!candidate) return false
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveGitHubCliExecutable({
  environment = process.env,
  fallbackDirectories = DEFAULT_GITHUB_CLI_DIRECTORIES,
} = {}) {
  const pathDirectories = String(environment.PATH || '').split(path.delimiter).filter(Boolean)
  const candidates = [
    environment.VINCODELAB_GH_PATH,
    ...pathDirectories.map((directory) => path.join(directory, 'gh')),
    ...fallbackDirectories.map((directory) => path.join(directory, 'gh')),
  ]

  return candidates.find(isExecutable)
}

function environmentForGitHubCli(executable, environment = process.env) {
  const executableDirectory = path.dirname(executable)
  const inheritedPath = String(environment.PATH || '').split(path.delimiter).filter(Boolean)
  const pathEntries = [executableDirectory, ...inheritedPath.filter((entry) => entry !== executableDirectory)]
  return { ...environment, PATH: pathEntries.join(path.delimiter) }
}

module.exports = { environmentForGitHubCli, resolveGitHubCliExecutable }
