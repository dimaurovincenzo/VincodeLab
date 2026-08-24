const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function isExecutable(candidate) {
  if (!candidate) return false
  try {
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function nvmCandidates(homeDirectory) {
  const versionsDirectory = path.join(homeDirectory, '.nvm', 'versions', 'node')
  try {
    return fs.readdirSync(versionsDirectory)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => path.join(versionsDirectory, version, 'bin', 'pi'))
  } catch {
    return []
  }
}

function pathCandidates(environment = process.env) {
  return (environment.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'pi'))
}

function environmentForPi(executable, environment = process.env) {
  const executableDirectory = path.dirname(executable)
  const inheritedPath = (environment.PATH || '').split(path.delimiter).filter(Boolean)
  const pathEntries = [executableDirectory, ...inheritedPath.filter((entry) => entry !== executableDirectory)]

  return { ...environment, PATH: pathEntries.join(path.delimiter) }
}

function resolvePiExecutable({ environment = process.env, homeDirectory = os.homedir() } = {}) {
  if (Object.hasOwn(environment, 'VINCODELAB_PI_PATH')) {
    return isExecutable(environment.VINCODELAB_PI_PATH) ? environment.VINCODELAB_PI_PATH : undefined
  }
  const candidates = [
    ...pathCandidates(environment),
    path.join(homeDirectory, '.local', 'bin', 'pi'),
    path.join(homeDirectory, '.npm-global', 'bin', 'pi'),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi',
    ...nvmCandidates(homeDirectory),
  ]

  return candidates.find(isExecutable)
}

module.exports = { environmentForPi, resolvePiExecutable }
