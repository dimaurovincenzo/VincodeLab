const { createPublicError } = require('./public-error.cjs')

function safeProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try { return value[key] } catch { return undefined }
}

function classifyStartupLoadFailure(error) {
  const code = safeProperty(error, 'code')
  const message = safeProperty(error, 'message')
  const signal = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`
  const incompatible = /ERR_DLOPEN_FAILED|incompatible architecture|mach-o|node_module_version|was compiled against|symbol not found/iu.test(signal)
  if (incompatible) return createPublicError(
    'APP_RUNTIME_INCOMPATIBLE',
    'Questa installazione di VincodeLab non è compatibile con l’architettura o la versione di macOS in uso. Installa il pacchetto corretto per questo Mac.',
  )
  const incomplete = code === 'MODULE_NOT_FOUND'
    || code === 'ERR_MODULE_NOT_FOUND'
    || /cannot find module|module did not self-register/iu.test(signal)
  if (incomplete) return createPublicError(
    'APP_INSTALLATION_INCOMPLETE',
    'Questa installazione di VincodeLab è incompleta. Reinstalla l’applicazione; Node, npm e i client database di sistema non risolvono questo problema.',
  )
  return null
}

module.exports = { classifyStartupLoadFailure }
