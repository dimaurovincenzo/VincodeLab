const assert = require('node:assert/strict')
const test = require('node:test')

const { restorePublicInvokeError } = require('../electron/preload/public-error-restorer.cjs')

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function invokeError(channel, message, code, correlationId = 'ERR-A1B2C3') {
  return new Error(`Error invoking remote method '${channel}': Error: ${message} [${code}] [${correlationId}]`)
}

test('ricostruisce soltanto il contratto pubblico proveniente dal canale invoke atteso', () => {
  const restored = restorePublicInvokeError(
    invokeError('pi:reload', 'Il provider AI non ha completato la richiesta.', 'AI_PROVIDER_RATE_LIMITED'),
    'pi:reload',
  )

  assert.deepEqual(plain(restored), {
    category: 'network',
    code: 'AI_PROVIDER_RATE_LIMITED',
    correlationId: 'ERR-A1B2C3',
    message: 'Il provider AI non ha completato la richiesta. [AI_PROVIDER_RATE_LIMITED] [ERR-A1B2C3]',
    recoverable: true,
    severity: 'error',
  })
  assert.equal(Object.isFrozen(restored), true)
})

test('preserva il failure originale se canale, formato o copy non sono attendibili', () => {
  const wrongChannel = invokeError('files:save', 'Impossibile salvare il file.', 'FILESYSTEM_SAVE_FAILED')
  const privateCopy = invokeError('files:save', 'token=private /tmp/private.sql', 'FILESYSTEM_SAVE_FAILED')
  const forged = new Error('token=private [FILESYSTEM_SAVE_FAILED] [ERR-A1B2C3]')

  assert.equal(restorePublicInvokeError(wrongChannel, 'files:read'), wrongChannel)
  assert.equal(restorePublicInvokeError(privateCopy, 'files:save'), privateCopy)
  assert.equal(restorePublicInvokeError(forged, 'files:save'), forged)
})

test('classifica configurazione, cancellazione e domini senza usare il dettaglio raw', () => {
  assert.equal(restorePublicInvokeError(invokeError('pi:restart', 'Configura il provider e riprova.', 'AI_PROVIDER_CONFIG_MISSING'), 'pi:restart').category, 'configuration')
  assert.deepEqual(
    plain(restorePublicInvokeError(invokeError('database:execute', 'Query annullata.', 'DATABASE_QUERY_CANCELLED'), 'database:execute')),
    {
      category: 'cancelled',
      code: 'DATABASE_QUERY_CANCELLED',
      correlationId: 'ERR-A1B2C3',
      message: 'Query annullata. [DATABASE_QUERY_CANCELLED] [ERR-A1B2C3]',
      recoverable: false,
      severity: 'info',
    },
  )
  assert.equal(restorePublicInvokeError(invokeError('github:data', 'GitHub non ha completato la richiesta.', 'GITHUB_API_FAILURE'), 'github:data').category, 'github')
})

test('rimane total-safe con getter ostili', () => {
  const hostile = Object.defineProperty({}, 'message', { get() { throw new Error('getter exploded') } })
  assert.equal(restorePublicInvokeError(hostile, 'pi:reload'), hostile)
})
