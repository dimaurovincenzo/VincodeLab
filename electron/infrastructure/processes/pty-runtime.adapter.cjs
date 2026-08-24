const { createPublicError } = require('../../domains/errors/public-error.cjs')

const PTY_UNAVAILABLE_MESSAGE = 'Il componente Terminale di questa installazione non è disponibile. Gli altri strumenti restano utilizzabili. Reinstalla VincodeLab con il pacchetto adatto a questo Mac.'

function classifyPtyLoadFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const message = typeof error?.message === 'string' ? error.message : ''
  const incompatible = code === 'ERR_DLOPEN_FAILED'
    || /(?:incompatible architecture|mach-o|node_module_version|was compiled against|symbol not found)/iu.test(message)
  return createPublicError(
    incompatible ? 'PTY_RUNTIME_INCOMPATIBLE' : 'PTY_RUNTIME_UNAVAILABLE',
    PTY_UNAVAILABLE_MESSAGE,
  )
}

function createPtyRuntime(load = () => require('node-pty')) {
  let implementation = null
  let loadError = null
  try {
    const candidate = load()
    if (!candidate || typeof candidate.spawn !== 'function') throw new TypeError('node-pty non espone spawn.')
    implementation = candidate
  } catch (error) {
    loadError = classifyPtyLoadFailure(error)
  }

  return Object.freeze({
    getStatus() {
      return implementation
        ? Object.freeze({ state: 'ready' })
        : Object.freeze({ state: 'broken', code: loadError.publicCode })
    },
    spawn(executable, args, options) {
      if (!implementation) throw loadError
      return implementation.spawn(executable, args, options)
    },
  })
}

module.exports = { PTY_UNAVAILABLE_MESSAGE, classifyPtyLoadFailure, createPtyRuntime }
