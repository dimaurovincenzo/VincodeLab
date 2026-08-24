const path = require('node:path')
const { assertRemoteRoot, assertSshDestination } = require('../workspace/workspace-command-model.cjs')

function assertManagedSshWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) throw new Error('Workspace non valido.')
  return workspacePath
}

function parseManagedSshCommand(command) {
  if (!command || command.kind !== 'ssh') throw new Error('Profilo SSH non valido.')
  return {
    destination: assertSshDestination(command.sshDestination),
    remoteRoot: assertRemoteRoot(command.remoteRoot),
  }
}

function quoteShellArg(value) {
  if (typeof value !== 'string' || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error('Argomento shell non valido.')
  return `'${value.replaceAll("'", "'\\''")}'`
}

function publicConnection(connection) {
  const { id, commandId, title, destination, remoteRoot, state, error } = connection
  return { id, commandId, title, destination, remoteRoot, state, ...(error ? { error } : {}) }
}

module.exports = {
  assertManagedSshWorkspacePath,
  parseManagedSshCommand,
  publicConnection,
  quoteShellArg,
}
