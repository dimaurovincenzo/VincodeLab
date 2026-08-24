const PI_PACKAGE_SKILLS_SOURCE_METHODS = Object.freeze(['scan'])

function createPiPackageSkillsSourcePort(implementation) {
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('Porta catalogo skill dei pacchetti Pi non valida.')
  }
  const port = {}
  for (const method of PI_PACKAGE_SKILLS_SOURCE_METHODS) {
    if (typeof implementation[method] !== 'function') {
      throw new TypeError(`Porta catalogo skill dei pacchetti Pi incompleta: ${method}.`)
    }
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertPiPackageSkillsSourcePort(port) {
  if (!port || PI_PACKAGE_SKILLS_SOURCE_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta catalogo skill dei pacchetti Pi non valida.')
  }
  return port
}

module.exports = {
  PI_PACKAGE_SKILLS_SOURCE_METHODS,
  assertPiPackageSkillsSourcePort,
  createPiPackageSkillsSourcePort,
}
