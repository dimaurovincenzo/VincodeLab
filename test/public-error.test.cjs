const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createPublicError,
  ensurePublicErrorCorrelation,
  getPublicErrorCorrelationId,
  isPublicError,
  toPublicError,
  toPublicErrorMessage,
} = require('../electron/domains/errors/public-error.cjs')

const PRIVATE_DETAIL = 'fallito in /Users/demo/Segreti/progetto.db?token=ghp_supersegreto con Authorization=Bearer abc.def.ghi'

test('converte errori interni in un messaggio italiano codificato senza dettagli grezzi', () => {
  const internal = new Error(PRIVATE_DETAIL)
  internal.code = 'EACCES'

  const message = toPublicErrorMessage(internal, {
    code: 'REMOTE_READ_LOCAL_FAILED',
    message: 'Lettura della copia locale non riuscita.',
  })

  assert.equal(message, 'Lettura della copia locale non riuscita. Verifica i permessi e riprova. [REMOTE_READ_LOCAL_FAILED]')
  assert.doesNotMatch(message, /Users|progetto\.db|token|ghp_|Authorization|Bearer|abc\.def|\?/i)
})

test('un errore pubblico resta stabile quando attraversa piu confini', () => {
  const publicError = createPublicError('UPDATE_HEALTH_CHECK_FAILED', 'Verifica della nuova versione non riuscita.')
  const wrapped = toPublicError(publicError, { code: 'UPDATE_ACTIVATION_FAILED', message: 'Attivazione non riuscita.' })

  assert.equal(wrapped, publicError)
  assert.equal(isPublicError(wrapped), true)
  assert.equal(wrapped.code, 'UPDATE_HEALTH_CHECK_FAILED')
  assert.equal(wrapped.message, 'Verifica della nuova versione non riuscita. [UPDATE_HEALTH_CHECK_FAILED]')
  assert.equal('cause' in wrapped, false)
})

test('usa un fallback professionale quando non è disponibile un messaggio contestuale', () => {
  const wrapped = toPublicError(new Error('token=privato /tmp/vincodelab-private/source.ts'))

  assert.equal(wrapped.message, 'Impossibile completare la richiesta. [OPERATION_FAILED]')
  assert.doesNotMatch(wrapped.message, /token|privato|tmp|source\.ts/iu)
})

test('le verifiche degli errori pubblici sono total-safe con Proxy e getter ostili', () => {
  const hostile = new Proxy({}, {
    get() { throw new Error('getter alice.private@example.test /private/tmp/vincodelab-secret') },
    getPrototypeOf() { throw new Error('prototype /var/folders/private') },
  })

  assert.equal(isPublicError(hostile), false)
  assert.equal(getPublicErrorCorrelationId(hostile), null)
  assert.equal(ensurePublicErrorCorrelation(hostile, 'ERR-A1B2C3'), hostile)
  assert.equal(
    toPublicErrorMessage(hostile),
    'Impossibile completare la richiesta. [OPERATION_FAILED]',
  )

  const publicError = createPublicError('FILESYSTEM_READ_FAILED', 'Impossibile leggere il file.')
  Object.defineProperty(publicError, 'correlationId', {
    configurable: true,
    get() { throw new Error('correlation getter non disponibile') },
  })
  Object.defineProperty(publicError, 'message', {
    configurable: true,
    get() { throw new Error('message getter non disponibile') },
    set() { throw new Error('message setter non disponibile') },
  })

  assert.equal(isPublicError(publicError), true)
  assert.equal(getPublicErrorCorrelationId(publicError), null)
  assert.doesNotThrow(() => ensurePublicErrorCorrelation(publicError, 'ERR-D4E5F6'))
  assert.equal(getPublicErrorCorrelationId(publicError), 'ERR-D4E5F6')
  assert.equal(
    toPublicErrorMessage(publicError),
    'Impossibile leggere il file. [FILESYSTEM_READ_FAILED] [ERR-D4E5F6]',
  )
})
