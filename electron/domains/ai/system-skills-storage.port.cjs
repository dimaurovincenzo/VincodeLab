const SYSTEM_SKILLS_STORAGE_METHODS = Object.freeze([
  'assertRootPresent',
  'create',
  'list',
  'prepareUpdate',
  'read',
  'remove',
  'write',
])

function createSystemSkillsStoragePort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta skill di sistema non valida.')
  }
  const port = {}
  for (const method of SYSTEM_SKILLS_STORAGE_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta skill di sistema incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertSystemSkillsStoragePort(port) {
  if (!port || SYSTEM_SKILLS_STORAGE_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta skill di sistema non valida.')
  }
  return port
}

module.exports = {
  SYSTEM_SKILLS_STORAGE_METHODS,
  assertSystemSkillsStoragePort,
  createSystemSkillsStoragePort,
}
