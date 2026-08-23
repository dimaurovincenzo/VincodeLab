const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const preloadSource = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
const start = preloadSource.indexOf('// BEGIN PRELOAD_PUBLIC_ERROR_RESTORER')
const end = preloadSource.indexOf('// END PRELOAD_PUBLIC_ERROR_RESTORER')
assert.ok(start >= 0 && end > start, 'Restorer preload non trovato.')
const context = {}
vm.runInNewContext(`${preloadSource.slice(start, end)}; this.restorePublicInvokeError = restorePublicInvokeError`, context)
const { restorePublicInvokeError } = context

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
