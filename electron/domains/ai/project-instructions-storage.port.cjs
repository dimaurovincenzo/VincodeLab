const PROJECT_INSTRUCTIONS_STORAGE_METHODS = Object.freeze([
  'read',
  'remove',
  'write',
])

function createProjectInstructionsStoragePort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta istruzioni progetto non valida.')
  }
  const port = {}
  for (const method of PROJECT_INSTRUCTIONS_STORAGE_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta istruzioni progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectInstructionsStoragePort(port) {
  if (!port || PROJECT_INSTRUCTIONS_STORAGE_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta istruzioni progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_INSTRUCTIONS_STORAGE_METHODS,
  assertProjectInstructionsStoragePort,
  createProjectInstructionsStoragePort,
}
