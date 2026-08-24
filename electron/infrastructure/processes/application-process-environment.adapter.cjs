const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_HOMEBREW_PREFIXES = Object.freeze(['/opt/homebrew', '/usr/local'])

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory()
  } catch {
    return false
  }
}

function isExecutableFile(candidate) {
  try {
    if (!fs.statSync(candidate).isFile()) return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function uniquePathEntries(entries) {
  const identities = new Set()
  return entries.filter((entry) => {
    let identity = entry
    try { identity = fs.realpathSync(entry) } catch { /* Un path ereditato può essere creato dopo l’avvio. */ }
    if (identities.has(identity)) return false
    identities.add(identity)
    return true
  })
}

function validatedHomebrewPrefix(candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\0') || !path.isAbsolute(candidate)) return null
  try {
    const prefix = fs.realpathSync(candidate)
    if (!path.isAbsolute(prefix) || !isDirectory(prefix)) return null
    return isExecutableFile(path.join(prefix, 'bin', 'brew')) ? prefix : null
  } catch {
    return null
  }
}

function discoverHomebrewPrefix({
  candidatePrefixes = DEFAULT_HOMEBREW_PREFIXES,
  environment = process.env,
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') return null
  const candidates = [environment?.HOMEBREW_PREFIX, ...candidatePrefixes]
  for (const candidate of candidates) {
    const prefix = validatedHomebrewPrefix(candidate)
    if (prefix) return prefix
  }
  return null
}

function createApplicationProcessEnvironment(environment = process.env, options = {}) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new TypeError('Ambiente applicativo non valido.')
  const homebrewPrefix = options.discoverHomebrew === false
    ? null
    : discoverHomebrewPrefix({
        candidatePrefixes: options.candidatePrefixes,
        environment,
        platform: options.platform,
      })
  const inheritedEntries = String(environment.PATH || '').split(path.delimiter).filter(Boolean)
  const homebrewEntries = homebrewPrefix
    ? [path.join(homebrewPrefix, 'bin'), path.join(homebrewPrefix, 'sbin')].filter(isDirectory)
    : []
  const pathEntries = uniquePathEntries([...homebrewEntries, ...inheritedEntries])

  return Object.freeze({
    environment: Object.freeze({ ...environment, PATH: pathEntries.join(path.delimiter) }),
    homebrewPrefix,
    pathEntries: Object.freeze(pathEntries),
  })
}

function installApplicationProcessEnvironment(environment = process.env, options = {}) {
  const configured = createApplicationProcessEnvironment(environment, options)
  environment.PATH = configured.environment.PATH
  return configured
}

module.exports = {
  DEFAULT_HOMEBREW_PREFIXES,
  createApplicationProcessEnvironment,
  discoverHomebrewPrefix,
  installApplicationProcessEnvironment,
  validatedHomebrewPrefix,
}
