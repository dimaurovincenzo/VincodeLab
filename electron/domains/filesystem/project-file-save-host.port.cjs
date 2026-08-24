const PROJECT_FILE_SAVE_HOST_METHODS = Object.freeze([
  'prepareSave',
  'exists',
  'readBounded',
  'readMode',
  'writeAtomic',
])

function createProjectFileSaveHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host salvataggio file progetto non valida.')
  }

  const port = {}
  for (const method of PROJECT_FILE_SAVE_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host salvataggio file progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectFileSaveHostPort(port) {
  if (!port || PROJECT_FILE_SAVE_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host salvataggio file progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_FILE_SAVE_HOST_METHODS,
  assertProjectFileSaveHostPort,
  createProjectFileSaveHostPort,
}
