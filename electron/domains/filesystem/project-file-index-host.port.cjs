const PROJECT_FILE_INDEX_HOST_METHODS = Object.freeze([
  'inspectEntry',
  'normalizeWorkspacePath',
  'readDirectory',
  'resolveWorkspace',
])

function createProjectFileIndexHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host indice file non valida.')
  }
  const port = {}
  for (const method of PROJECT_FILE_INDEX_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host indice file incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectFileIndexHostPort(port) {
  if (!port || PROJECT_FILE_INDEX_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host indice file non valida.')
  }
  return port
}

module.exports = {
  PROJECT_FILE_INDEX_HOST_METHODS,
  assertProjectFileIndexHostPort,
  createProjectFileIndexHostPort,
}
