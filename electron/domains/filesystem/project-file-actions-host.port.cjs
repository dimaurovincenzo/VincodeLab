const PROJECT_FILE_ACTIONS_HOST_METHODS = Object.freeze([
  'isMacApplicationBundle',
  'prepareAttachment',
  'resolveDirectory',
  'resolveFile',
])

function createProjectFileActionsHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host azioni file progetto non valida.')
  }

  const port = {}
  for (const method of PROJECT_FILE_ACTIONS_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host azioni file progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectFileActionsHostPort(port) {
  if (!port || PROJECT_FILE_ACTIONS_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host azioni file progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_FILE_ACTIONS_HOST_METHODS,
  assertProjectFileActionsHostPort,
  createProjectFileActionsHostPort,
}
