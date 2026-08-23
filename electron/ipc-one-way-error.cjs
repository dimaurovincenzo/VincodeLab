const { getApplicationErrorLogMetadata, toApplicationError } = require('./application-error.cjs')

const ONE_WAY_ERROR_CONFIGURATION = Object.freeze({
  'terminal:ready': Object.freeze({
    code: 'TERMINAL_READY_FAILED',
    domain: 'terminal',
    eventChannel: 'terminal:error',
    message: 'Impossibile collegare l’output del Terminale AI. Recupera lo storico e riprova.',
    operation: 'ready',
    recovery: 'resume',
  }),
  'terminal:ack': Object.freeze({
    code: 'TERMINAL_ACK_FAILED',
    domain: 'terminal',
    eventChannel: 'terminal:error',
    message: 'L’output del Terminale AI non è stato confermato. Recupera lo storico per riallinearlo.',
    operation: 'ack',
    recovery: 'resume',
  }),
  'terminal:key': Object.freeze({
    code: 'TERMINAL_INPUT_FAILED',
    domain: 'terminal',
    eventChannel: 'terminal:error',
    message: 'Il testo non è stato inviato al Terminale AI. La sessione è rimasta disponibile.',
    operation: 'key',
    recovery: 'restart',
  }),
  'terminal:resize': Object.freeze({
    code: 'TERMINAL_RESIZE_FAILED',
    domain: 'terminal',
    eventChannel: 'terminal:error',
    message: 'Il Terminale AI non è stato ridimensionato. La sessione è rimasta attiva.',
    operation: 'resize',
    recovery: 'resize',
  }),
  'piConfig:input': Object.freeze({
    code: 'PI_CONFIG_INPUT_FAILED',
    domain: 'configuration',
    eventChannel: 'piConfig:error',
    message: 'Il testo non è stato inviato alla configurazione di Pi. Riapri la configurazione e riprova.',
    operation: 'input',
    recovery: 'restart',
  }),
  'piConfig:resize': Object.freeze({
    code: 'PI_CONFIG_RESIZE_FAILED',
    domain: 'configuration',
    eventChannel: 'piConfig:error',
    message: 'Il terminale di configurazione non è stato ridimensionato. Puoi continuare a usarlo.',
    operation: 'resize',
    recovery: 'resize',
  }),
})

function createIpcOneWayFailure(error, channel) {
  const configuration = ONE_WAY_ERROR_CONFIGURATION[channel]
  const incident = toApplicationError(error, configuration
    ? {
        channel,
        code: configuration.code,
        domain: configuration.domain,
        message: configuration.message,
        operation: configuration.operation,
        recoverable: true,
      }
    : { channel })
  const payload = configuration
    ? Object.freeze({
        operation: configuration.operation,
        recovery: configuration.recovery,
        error: Object.freeze({
          category: incident.category,
          code: incident.publicCode,
          correlationId: incident.correlationId,
          message: incident.message,
          recoverable: incident.recoverable,
          severity: incident.severity,
        }),
      })
    : null
  return Object.freeze({ eventChannel: configuration?.eventChannel ?? null, incident, payload })
}

function safelyLog(log, level, event, metadata) {
  if (typeof log !== 'function') return
  try {
    log(level, event, metadata)
  } catch {
    // Il logging è osservativo e non deve riaprire il failure one-way.
  }
}

function wrapIpcListener(channel, listener, options = {}) {
  if (typeof channel !== 'string' || !channel) throw new TypeError('Canale IPC one-way non valido.')
  if (typeof listener !== 'function') throw new TypeError('Listener IPC one-way non valido.')

  function fail(error, args) {
    const failure = createIpcOneWayFailure(error, channel)
    const metadata = getApplicationErrorLogMetadata(failure.incident)
    safelyLog(options.log, failure.incident.severity, 'ipc_listener_failed', metadata)
    if (typeof options.onFailure === 'function') {
      try {
        options.onFailure(failure, args)
      } catch {
        safelyLog(options.log, 'warning', 'ipc_listener_error_delivery_failed', metadata)
      }
    }
  }

  return function wrappedIpcListener(...args) {
    let result
    try {
      result = listener.apply(this, args)
    } catch (error) {
      fail(error, args)
      return undefined
    }
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return result
    let then
    try {
      then = result.then
    } catch (error) {
      fail(error, args)
      return undefined
    }
    if (typeof then !== 'function') return result
    void Promise.resolve(result).catch((error) => fail(error, args))
    return undefined
  }
}

module.exports = {
  ONE_WAY_ERROR_CONFIGURATION,
  createIpcOneWayFailure,
  wrapIpcListener,
}
