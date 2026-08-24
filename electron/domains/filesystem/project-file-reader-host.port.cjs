const PROJECT_FILE_READER_HOST_METHODS = Object.freeze([
  'prepareRead',
  'readBounded',
])

function createProjectFileReaderHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host lettura file progetto non valida.')
  }

  const port = {}
  for (const method of PROJECT_FILE_READER_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host lettura file progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectFileReaderHostPort(port) {
  if (!port || PROJECT_FILE_READER_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host lettura file progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_FILE_READER_HOST_METHODS,
  assertProjectFileReaderHostPort,
  createProjectFileReaderHostPort,
}
