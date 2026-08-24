const DATABASE_DRIVER_PORT_METHODS = Object.freeze([
  'createMssqlConnection',
  'createMysqlClient',
  'createPostgresClient',
  'executeRemote',
])

function createDatabaseDriverPort(implementation) {
  if (!implementation || typeof implementation !== 'object') throw new TypeError('Porta driver database non valida.')
  const port = {}
  for (const method of DATABASE_DRIVER_PORT_METHODS) {
    if (typeof implementation[method] !== 'function') throw new TypeError(`Porta driver database incompleta: ${method}.`)
    port[method] = implementation[method].bind(implementation)
  }
  return Object.freeze(port)
}

function assertDatabaseDriverPort(port) {
  if (!port || DATABASE_DRIVER_PORT_METHODS.some((method) => typeof port[method] !== 'function')) {
    throw new TypeError('Porta driver database non valida.')
  }
  return port
}

module.exports = { DATABASE_DRIVER_PORT_METHODS, assertDatabaseDriverPort, createDatabaseDriverPort }
