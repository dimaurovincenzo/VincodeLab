const PROJECT_ENTRY_MUTATIONS_HOST_METHODS = Object.freeze([
  'prepareDirectory',
  'createFileExclusive',
  'createDirectoryExclusive',
  'prepareRename',
  'rename',
  'prepareDuplicate',
  'tryDuplicate',
  'disposeDuplicate',
])

const PROJECT_ENTRY_DUPLICATE_RESULTS = Object.freeze({
  collision: 'collision',
  copyIncomplete: 'copy-incomplete',
  created: 'created',
  notRegular: 'not-regular',
  ready: 'ready',
  sourceChanged: 'source-changed',
  symbolicLink: 'symbolic-link',
})

function createProjectEntryMutationsHostPort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta host mutazioni progetto non valida.')
  }

  const port = {}
  for (const method of PROJECT_ENTRY_MUTATIONS_HOST_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta host mutazioni progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectEntryMutationsHostPort(port) {
  if (!port || PROJECT_ENTRY_MUTATIONS_HOST_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta host mutazioni progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_ENTRY_DUPLICATE_RESULTS,
  PROJECT_ENTRY_MUTATIONS_HOST_METHODS,
  assertProjectEntryMutationsHostPort,
  createProjectEntryMutationsHostPort,
}
