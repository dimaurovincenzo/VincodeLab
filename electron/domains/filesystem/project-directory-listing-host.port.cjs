const PROJECT_DIRECTORY_LISTING_HOST_METHODS = Object.freeze([
  'openDirectory',
])

function createProjectDirectoryListingHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host elenco directory non valida.')
  }

  const port = {}
  for (const method of PROJECT_DIRECTORY_LISTING_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host elenco directory incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectDirectoryListingHostPort(port) {
  if (!port || PROJECT_DIRECTORY_LISTING_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host elenco directory non valida.')
  }
  return port
}

module.exports = {
  PROJECT_DIRECTORY_LISTING_HOST_METHODS,
  assertProjectDirectoryListingHostPort,
  createProjectDirectoryListingHostPort,
}
