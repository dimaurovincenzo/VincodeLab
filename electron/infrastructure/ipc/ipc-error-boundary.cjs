const { getApplicationErrorLogMetadata } = require('../../domains/errors/application-error.cjs')
const { toIpcApplicationError } = require('./ipc-application-error.cjs')

const IPC_INSTALLATION = Symbol.for('vincodelab.ipc-error-experience')
const SAFE_CHANNEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/u

function safeChannel(value) {
  if (typeof value !== 'string') return 'operation'
  const normalized = value.trim()
  return SAFE_CHANNEL_PATTERN.test(normalized) ? normalized : 'operation'
}

function configuredLog(options) {
  if (typeof options.log === 'function') return options.log
  if (typeof options.logger === 'function') return options.logger
  if (options.logger && typeof options.logger.log === 'function') return options.logger.log.bind(options.logger)
  return null
}

function reportIpcError(error, options) {
  const log = configuredLog(options)
  if (!log) return
  try {
    const event = error.category === 'cancelled' ? 'ipc_handler_cancelled' : 'ipc_handler_failed'
    log(error.severity, event, getApplicationErrorLogMetadata(error))
  } catch {
    // Il logging è osservativo: un suo errore non sostituisce l'incidente originale.
  }
}

function wrapIpcHandler(channel, handler, options = {}) {
  if (typeof handler !== 'function') throw new TypeError('Handler IPC non valido.')
  const channelName = safeChannel(channel)

  function fail(error) {
    const applicationError = toIpcApplicationError(error, channelName, options)
    reportIpcError(applicationError, options)
    throw applicationError
  }

  return function wrappedIpcHandler(...args) {
    let result
    try {
      result = handler.apply(this, args)
    } catch (error) {
      return fail(error)
    }
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return result
    let then
    try {
      then = result.then
    } catch (error) {
      return fail(error)
    }
    if (typeof then !== 'function') return result
    return Promise.resolve(result).catch(fail)
  }
}

function installIpcMainErrorHandling(ipcMain, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain non valido.')
  if (ipcMain[IPC_INSTALLATION]) return ipcMain[IPC_INSTALLATION]

  const hadOwnHandle = Object.prototype.hasOwnProperty.call(ipcMain, 'handle')
  const originalHandle = ipcMain.handle
  let active = true

  function installedHandle(channel, handler) {
    return originalHandle.call(this, channel, wrapIpcHandler(channel, handler, options))
  }

  const installation = Object.freeze({
    uninstall() {
      if (!active) return false
      active = false
      if (ipcMain.handle === installedHandle) {
        if (hadOwnHandle) ipcMain.handle = originalHandle
        else delete ipcMain.handle
      }
      if (ipcMain[IPC_INSTALLATION] === installation) delete ipcMain[IPC_INSTALLATION]
      return true
    },
    wrap(channel, handler, handlerOptions = {}) {
      return wrapIpcHandler(channel, handler, { ...options, ...handlerOptions })
    },
  })

  ipcMain.handle = installedHandle
  Object.defineProperty(ipcMain, IPC_INSTALLATION, { configurable: true, value: installation })
  return installation
}

module.exports = { installIpcMainErrorHandling, wrapIpcHandler }
