const { getApplicationErrorLogMetadata, toApplicationError } = require('./application-error.cjs')

function reportPreloadFailure(error, { log, recover }) {
  if (typeof log !== 'function' || typeof recover !== 'function') throw new TypeError('Recovery preload non configurato.')

  const incident = toApplicationError(error, {
    category: 'internal',
    code: 'RENDERER_PRELOAD_FAILED',
    domain: 'internal',
    message: 'Impossibile avviare l’interfaccia di VincodeLab.',
    operation: 'preload',
    recoverable: true,
    severity: 'error',
  })

  try {
    log('error', 'preload_failed', getApplicationErrorLogMetadata(incident))
  } catch {
    // Il recupero locale deve restare disponibile anche se il sink diagnostico è degradato.
  }

  const recovery = recover({ correlationId: incident.correlationId })
  return Object.freeze({ incident, recovery })
}

module.exports = { reportPreloadFailure }
