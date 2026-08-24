const fs = require('node:fs')
const path = require('node:path')

function resolveSystemShell(environment) {
  const candidates = [environment.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) continue
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      }
    } catch {
      // Una shell opzionale non disponibile non impedisce di provare il fallback.
    }
  }
  return null
}

function canonicalizeWorkspaceDirectory(workspacePath) {
  const root = path.resolve(fs.realpathSync(workspacePath))
  const stats = fs.lstatSync(root)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Il workspace non è una directory valida.')
  return root
}

function isSystemProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'ESRCH' ? false : null
  }
}

function createShellHostAdapter({ environment = process.env } = {}) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new TypeError('Ambiente host della shell non valido.')
  }
  return Object.freeze({
    canonicalizeWorkspace: canonicalizeWorkspaceDirectory,
    getEnvironment: () => environment,
    getExecutable: () => resolveSystemShell(environment),
    isProcessAlive: isSystemProcessAlive,
  })
}

module.exports = {
  canonicalizeWorkspaceDirectory,
  createShellHostAdapter,
  isSystemProcessAlive,
  resolveSystemShell,
}
