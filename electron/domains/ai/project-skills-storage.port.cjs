const PROJECT_SKILLS_STORAGE_METHODS = Object.freeze([
  'create',
  'list',
  'read',
  'remove',
  'write',
])

function createProjectSkillsStoragePort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta skill progetto non valida.')
  }
  const port = {}
  for (const method of PROJECT_SKILLS_STORAGE_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta skill progetto incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertProjectSkillsStoragePort(port) {
  if (!port || PROJECT_SKILLS_STORAGE_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta skill progetto non valida.')
  }
  return port
}

module.exports = {
  PROJECT_SKILLS_STORAGE_METHODS,
  assertProjectSkillsStoragePort,
  createProjectSkillsStoragePort,
}
