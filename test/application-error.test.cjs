const assert = require('node:assert/strict')
const test = require('node:test')

const {
  classifyApplicationError,
  domainFromIpcChannel,
  getApplicationErrorLogMetadata,
  installIpcMainErrorHandling,
  isApplicationError,
  toApplicationError,
  wrapIpcHandler,
} = require('../electron/application-error.cjs')
const { createPublicError, isPublicError, toPublicError } = require('../electron/public-error.cjs')

const PRIVATE_DETAIL = 'EACCES /Users/alice/secret/query.sql token=ghp_private SELECT * FROM customers'

test('intercetta un errore sincrono senza cambiare i successi sincroni', () => {
  const success = { saved: true }
  const successfulHandler = wrapIpcHandler('files:save', () => success)
  assert.equal(successfulHandler(), success)

  const logged = []
  const failingHandler = wrapIpcHandler('files:save', () => {
    const error = new Error(PRIVATE_DETAIL)
    error.code = 'EACCES'
    throw error
  }, { log: (...args) => logged.push(args) })

  assert.throws(() => failingHandler(), (error) => {
    assert.equal(isApplicationError(error), true)
    assert.equal(isPublicError(error), true)
    assert.equal(error.category, 'permission')
    assert.equal(error.domain, 'filesystem')
    assert.equal(error.operation, 'save')
    assert.equal(error.severity, 'error')
    assert.match(error.message, /^Impossibile salvare il file\. Verifica i permessi e riprova\. \[FILESYSTEM_SAVE_PERMISSION_DENIED\] \[ERR-[A-F0-9]{6}\]$/u)
    assert.doesNotMatch(error.message, /alice|query|token|ghp_|customers|EACCES/u)
    return true
  })

  assert.equal(logged.length, 1)
  assert.equal(logged[0][0], 'error')
  assert.equal(logged[0][1], 'ipc_handler_failed')
  assert.deepEqual(Object.keys(logged[0][2]).sort(), [
    'category',
    'code',
    'component',
    'correlationId',
    'fingerprint',
    'operation',
    'severity',
    'technicalCode',
    'technicalName',
  ])
  assert.match(logged[0][2].fingerprint, /^FP-[A-F0-9]{12}$/u)
  assert.equal(logged[0][2].technicalCode, 'EACCES')
  assert.equal(logged[0][2].technicalName, 'Error')
  assert.doesNotMatch(JSON.stringify(logged), /alice|query\.sql|ghp_|customers|SELECT|stack|message/u)
})

test('intercetta rejection asincrone e conserva il valore dei successi', async () => {
  const success = { rows: 2 }
  const successfulHandler = wrapIpcHandler('database:execute', async () => success)
  assert.equal(await successfulHandler(), success)

  const failingHandler = wrapIpcHandler('database:execute', async () => {
    const error = new Error('connect ETIMEDOUT postgres://admin:secret@private-db.local')
    error.code = 'ETIMEDOUT'
    throw error
  })

  await assert.rejects(failingHandler(), (error) => {
    assert.equal(error.category, 'timeout')
    assert.equal(error.domain, 'database')
    assert.equal(error.operation, 'execute')
    assert.match(error.message, /^Impossibile completare la query\. Il tempo disponibile è terminato\. Riprova\. \[DATABASE_EXECUTE_TIMEOUT\] \[ERR-[A-F0-9]{6}\]$/u)
    assert.doesNotMatch(error.message, /postgres|admin|secret|private-db|ETIMEDOUT/u)
    return true
  })
})

test('arricchisce un errore pubblico una volta sola preservando testo codice e identita', () => {
  const publicError = createPublicError('GITHUB_AUTH_REQUIRED', 'Accedi a GitHub e riprova.')
  const first = toApplicationError(publicError, { channel: 'github:data' })
  const second = toApplicationError(first, { channel: 'files:save' })
  const wrappedAgain = toPublicError(second, { code: 'OPERATION_FAILED', message: 'Messaggio sostitutivo.' })

  assert.equal(first, publicError)
  assert.equal(second, first)
  assert.equal(wrappedAgain, first)
  assert.equal(first.category, 'authentication')
  assert.equal(first.domain, 'github')
  assert.equal(first.code, 'GITHUB_AUTH_REQUIRED')
  assert.match(first.message, /^Accedi a GitHub e riprova\. \[GITHUB_AUTH_REQUIRED\] \[(ERR-[A-F0-9]{6})\]$/u)
  assert.equal((first.message.match(/ERR-[A-F0-9]{6}/gu) ?? []).length, 1)
})

test('classifica la cancellazione come informativa e non suggerisce un failure', () => {
  const logged = []
  const handler = wrapIpcHandler('terminal:resume', () => {
    const error = new Error('Abort requested with private context')
    error.name = 'AbortError'
    error.code = 'ABORT_ERR'
    throw error
  }, { log: (...args) => logged.push(args) })

  assert.throws(() => handler(), (error) => {
    assert.equal(error.category, 'cancelled')
    assert.equal(error.severity, 'info')
    assert.equal(error.recoverable, false)
    assert.match(error.message, /^Operazione annullata\. \[TERMINAL_RESUME_CANCELLED\] \[ERR-[A-F0-9]{6}\]$/u)
    assert.doesNotMatch(error.message, /private context|failed|non riuscita/iu)
    return true
  })

  assert.equal(logged[0][0], 'info')
  assert.equal(logged[0][1], 'ipc_handler_cancelled')
})

test('installa una boundary su ipcMain.handle e puo essere rimossa', async () => {
  const registrations = new Map()
  const ipcMain = {
    handle(channel, handler) {
      registrations.set(channel, handler)
      return `registered:${channel}`
    },
  }
  const originalHandle = ipcMain.handle
  const logs = []
  const installation = installIpcMainErrorHandling(ipcMain, { log: (...args) => logs.push(args) })

  assert.equal(installIpcMainErrorHandling(ipcMain), installation)
  const success = { active: true }
  assert.equal(ipcMain.handle('workspace:getActive', () => success), 'registered:workspace:getActive')
  assert.equal(registrations.get('workspace:getActive')(), success)

  ipcMain.handle('remoteFiles:browse', async () => {
    const error = new Error('getaddrinfo ENOTFOUND sftp.private.local password=secret')
    error.code = 'ENOTFOUND'
    throw error
  })
  await assert.rejects(registrations.get('remoteFiles:browse')(), (error) => {
    assert.equal(error.category, 'network')
    assert.equal(error.domain, 'remote')
    assert.doesNotMatch(error.message, /private|password|secret|ENOTFOUND/u)
    return true
  })
  assert.equal(logs.length, 1)

  assert.equal(installation.uninstall(), true)
  assert.equal(ipcMain.handle, originalHandle)
  assert.equal(installation.uninstall(), false)
})

test('deriva il dominio dal canale e produce soltanto metadati diagnostici consentiti', () => {
  assert.equal(domainFromIpcChannel('github:push'), 'git')
  assert.equal(domainFromIpcChannel('github:createIssue'), 'github')
  assert.equal(domainFromIpcChannel('database:execute'), 'database')
  assert.equal(domainFromIpcChannel('remoteFiles:upload'), 'remote')
  assert.equal(domainFromIpcChannel('pi:restart'), 'ai')

  const classification = classifyApplicationError(Object.assign(new Error('rate limit token=secret'), { status: 429 }), {
    channel: 'github:data',
  })
  assert.equal(classification.category, 'network')
  assert.equal(classification.domain, 'github')
  assert.match(classification.message, /Attendi qualche minuto e riprova\./u)

  const error = toApplicationError(new Error('/Users/alice/private.sql password=hunter2'), {
    channel: 'database:inspectSchema',
  })
  const metadata = getApplicationErrorLogMetadata(error)
  assert.deepEqual(metadata, {
    category: 'database',
    code: 'DATABASE_INSPECT_SCHEMA_FAILED',
    component: 'database',
    correlationId: error.correlationId,
    fingerprint: metadata.fingerprint,
    operation: 'inspectSchema',
    severity: 'error',
    technicalName: 'Error',
  })
  assert.match(metadata.fingerprint, /^FP-[A-F0-9]{12}$/u)
  assert.doesNotMatch(JSON.stringify(metadata), /alice|private|password|hunter2/u)
})

test('collega il correlation ID a diagnostica privata sanitizzata e a un fingerprint stabile', () => {
  function databaseIncident() {
    const error = createPublicError('DATABASE_QUERY_FAILED', 'La query non è stata completata.')
    Object.defineProperty(error, 'databaseDiagnostic', {
      value: 'DatabaseError ELOGIN password=hunter2 host=db.private.local SELECT * FROM private_customers',
    })
    return toApplicationError(error, { channel: 'database:execute' })
  }

  const first = databaseIncident()
  const second = databaseIncident()
  const firstMetadata = getApplicationErrorLogMetadata(first)
  const secondMetadata = getApplicationErrorLogMetadata(second)

  assert.notEqual(first.correlationId, second.correlationId)
  assert.equal(firstMetadata.fingerprint, secondMetadata.fingerprint)
  assert.equal(firstMetadata.correlationId, first.correlationId)
  assert.equal(firstMetadata.technicalName, 'Error')
  assert.match(firstMetadata.technicalDetail, /password=\[REDACTED\]/u)
  assert.match(firstMetadata.technicalDetail, /\[HOST REDACTED\]/u)
  assert.match(firstMetadata.technicalDetail, /\[QUERY REDACTED\]/u)
  assert.doesNotMatch(JSON.stringify(firstMetadata), /hunter2|db\.private|private_customers|SELECT/iu)
  assert.equal('fingerprint' in first, false)
  assert.equal('technicalDetail' in first, false)
})

test('classificazione e diagnostica restano total-safe con Proxy e getter ostili', () => {
  const hostile = new Proxy({}, {
    get() { throw new Error('getter alice.private@example.test /private/tmp/vincodelab-secret') },
    getPrototypeOf() { throw new Error('prototype /var/folders/private') },
  })

  const classification = classifyApplicationError(hostile, { channel: 'files:read' })
  assert.equal(classification.category, 'filesystem')
  assert.equal(classification.domain, 'filesystem')
  assert.equal(classification.operation, 'read')

  const incident = toApplicationError(hostile, { channel: 'files:read' })
  const metadata = getApplicationErrorLogMetadata(incident)
  assert.equal(isApplicationError(incident), true)
  assert.equal(metadata.technicalName, 'Error')
  assert.equal('technicalCode' in metadata, false)
  assert.equal('technicalDetail' in metadata, false)
  assert.doesNotMatch(JSON.stringify({ incident: incident.message, metadata }), /alice|example|private|tmp|folders|secret/iu)

  const hostileGetters = new Error('contenuto non consultabile')
  for (const key of ['name', 'code', 'errno', 'statusCode', 'status', 'message', 'cause', 'databaseDiagnostic']) {
    Object.defineProperty(hostileGetters, key, {
      configurable: true,
      get() { throw new Error(`getter ${key} non disponibile`) },
    })
  }
  assert.doesNotThrow(() => toApplicationError(hostileGetters, {
    channel: 'database:execute',
    get technicalDiagnostic() { throw new Error('diagnostica getter non disponibile') },
  }))
})

test('oscura email e percorsi temporanei in ogni diagnostica tecnica destinata ai log', () => {
  const sensitiveDetail = [
    'owner=alice.private+ops@example.test',
    '/tmp/vincodelab-private/query.sql',
    '/private/tmp/vincodelab-private/socket',
    '/var/folders/ab/cd/vincodelab-private/cache',
    'password=hunter2',
  ].join(' ')

  const databaseError = Object.assign(new Error('database indisponibile'), { code: 'EIO' })
  Object.defineProperty(databaseError, 'databaseDiagnostic', { value: sensitiveDetail })
  const databaseMetadata = getApplicationErrorLogMetadata(toApplicationError(databaseError, {
    channel: 'database:execute',
  }))

  const technicalMetadata = getApplicationErrorLogMetadata(toApplicationError(new Error('servizio indisponibile'), {
    channel: 'files:read',
    technicalDiagnostic: sensitiveDetail,
  }))

  for (const metadata of [databaseMetadata, technicalMetadata]) {
    assert.match(metadata.technicalDetail, /\[EMAIL REDACTED\]/u)
    assert.match(metadata.technicalDetail, /\[PATH REDACTED\]/u)
    assert.match(metadata.technicalDetail, /password=\[REDACTED\]/u)
    assert.doesNotMatch(JSON.stringify(metadata), /alice|example\.test|vincodelab-private|query\.sql|socket|folders|hunter2/iu)
  }
})
