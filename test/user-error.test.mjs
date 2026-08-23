import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeUserError,
  reportUserError,
  sanitizeDiagnosticText,
  userErrorDiagnostic,
  userErrorMessage,
} from '../src/lib/user-error.js'

test('accetta il messaggio solo dal contratto pubblico strutturato', () => {
  const error = {
    category: 'database',
    code: 'DATABASE_QUERY_INVALID',
    correlationId: 'ERR-8F2A1C',
    message: 'La query non è valida o non può essere eseguita dal database. [DATABASE_QUERY_INVALID] [ERR-8F2A1C]',
    recoverable: true,
    severity: 'warning',
  }
  assert.equal(userErrorMessage(error, 'Operazione non riuscita.'), 'La query non è valida o non può essere eseguita dal database.')
})

test('non mostra messaggi raw anche se simulano il suffisso del contratto pubblico', () => {
  for (const error of [
    new Error("Error invoking remote method 'database:execute': Error: password=secret /Users/maria/private.db"),
    new Error('password=secret [DATABASE_QUERY_INVALID]'),
    'access_token super-secret [DATABASE_QUERY_INVALID]',
    { code: 'DATABASE_QUERY_INVALID', message: 'token segreto [DATABASE_QUERY_INVALID]' },
  ]) assert.equal(userErrorMessage(error, 'Impossibile completare la query.'), 'Impossibile completare la query.')
})

test('usa il fallback quando non riceve un errore leggibile', () => {
  assert.equal(userErrorMessage(null, 'Operazione non riuscita.'), 'Operazione non riuscita.')
})

test('separa il codice pubblico dal testo e classifica l autenticazione', () => {
  const result = normalizeUserError(new Error('Accedi di nuovo a GitHub e riprova. [GITHUB_AUTH_REQUIRED]'))

  assert.equal(result.category, 'authentication')
  assert.equal(result.code, undefined)
  assert.equal(result.description, 'Riprova. Se il problema continua, copia la diagnostica.')
  assert.match(result.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.doesNotMatch(result.description, /GITHUB_AUTH_REQUIRED/u)
})

test('riutilizza il correlation ID IPC senza promuovere testo o codice raw a dati pubblici', () => {
  const error = new Error("Error invoking remote method 'files:save': Error: Impossibile salvare il file. [FILESYSTEM_SAVE_FAILED] [ERR-8F2A1C]")
  const result = normalizeUserError(error, { fallbackDescription: 'Il file non è stato salvato.' })

  assert.equal(result.correlationId, 'ERR-8F2A1C')
  assert.equal(result.code, undefined)
  assert.equal(result.description, 'Il file non è stato salvato.')
  assert.equal(userErrorMessage(error, 'Fallback'), 'Fallback')
})

test('considera attendibile un errore già normalizzato senza riaprire il testo raw', () => {
  const normalized = normalizeUserError(new Error('token private'), {
    description: 'La connessione non è stata completata.',
    title: 'Connessione non disponibile',
  })

  assert.equal(userErrorMessage(normalized, 'Fallback'), 'La connessione non è stata completata.')
  assert.equal(normalizeUserError(normalized).description, 'La connessione non è stata completata.')
})

test('non usa messaggi tecnici non attendibili come descrizione utente e mantiene lo stesso riferimento', () => {
  const error = new Error('EACCES /Users/mario/private/settings.json token=super-secret')
  const first = normalizeUserError(error, { fallbackDescription: 'Impossibile salvare le impostazioni.' })
  const second = normalizeUserError(error, { fallbackDescription: 'Riprova.' })

  assert.equal(first.description, 'Impossibile salvare le impostazioni.')
  assert.equal(first.correlationId, second.correlationId)
  assert.equal(first.category, 'permission')
  assert.doesNotMatch(first.technicalMessage, /super-secret|\/Users\/mario/u)
})

test('produce una diagnostica sanitizzata e utile da copiare', () => {
  const result = normalizeUserError(new Error('password=hunter2'), {
    category: 'configuration',
    component: 'settings',
    operation: 'save',
    fallbackDescription: 'Impossibile salvare le impostazioni.',
  })
  const diagnostic = userErrorDiagnostic(result)

  assert.match(diagnostic, new RegExp(result.correlationId, 'u'))
  assert.match(diagnostic, /Categoria: configuration/u)
  assert.match(diagnostic, /Componente: settings/u)
  assert.doesNotMatch(diagnostic, /hunter2/u)
})

test('sanitizza gli ingressi diagnostici avversi senza dipendere dal separatore dei segreti', () => {
  // Composto a runtime: esercita il filtro senza inserire una firma token plausibile nel repository.
  const fakeGitHubToken = `gh${'p'}_abcdefghijklmnopqrstuvwxyz123456`
  const fixtures = [
    ['https://api.example.test/items?access_token=oauth-private&mode=full', /oauth-private/u],
    ['lettura fallita in /tmp/vincodelab/private-query.sql', /private-query/u],
    ['account mario.rossi@example.test non autorizzato', /mario\.rossi@example\.test/u],
    ['query failed params: ["private-customer", 42]', /private-customer/u],
    [`request rejected token ${fakeGitHubToken}`, new RegExp(fakeGitHubToken, 'u')],
    ['postgres://mario:secret@db.local /Users/mario/private token=abc123', /mario:secret|\/Users\/mario|abc123/u],
  ]

  for (const [input, privatePattern] of fixtures) {
    const sanitized = sanitizeDiagnosticText(input)
    assert.doesNotMatch(sanitized, privatePattern)
    assert.match(sanitized, /REDACTED/u)
  }
})

test('la diagnostica renderer usa solo name e code in allowlist, mai il messaggio raw', () => {
  const allowed = Object.assign(new TypeError('email alice@example.test token private /tmp/private.sql'), { code: 'EACCES' })
  const allowedResult = normalizeUserError(allowed)
  assert.equal(allowedResult.technicalMessage, 'Tipo: TypeError; Codice tecnico: EACCES')

  const untrusted = Object.assign(new Error('params: ["private-value"]'), { code: 'PRIVATE_VALUE' })
  const untrustedResult = normalizeUserError(untrusted)
  assert.equal(untrustedResult.technicalMessage, 'Tipo: Error')
  assert.doesNotMatch(userErrorDiagnostic(untrustedResult), /private-value|PRIVATE_VALUE/u)
})

test('non classifica come annullamento parole parziali o fallimenti del tentativo di annullare', () => {
  for (const error of [
    new Error('Abortive connection setup failed'),
    new Error('Cancellation unavailable'),
    new Error('Operazione non annullata per timeout'),
    Object.assign(new Error('Annullamento non disponibile'), { code: 'DATABASE_QUERY_CANCEL_FAILED' }),
  ]) assert.notEqual(normalizeUserError(error).category, 'cancelled')

  assert.equal(normalizeUserError(new DOMException('annullata', 'AbortError')).category, 'cancelled')
  assert.equal(normalizeUserError(Object.assign(new Error('operation stopped'), { code: 'ABORT_ERR' })).category, 'cancelled')
  assert.equal(normalizeUserError(new Error('Trasferimento annullato.')).category, 'cancelled')
})

test('resta total-safe quando i getter message e code lanciano', () => {
  const hostile = Object.create(null, {
    code: { get() { throw new Error('code getter must not escape') } },
    message: { get() { throw new Error('message getter must not escape') } },
    name: { get() { throw new Error('name getter must not escape') } },
  })

  assert.doesNotThrow(() => normalizeUserError(hostile, { fallbackDescription: 'Fallback sicuro.' }))
  assert.equal(normalizeUserError(hostile, { fallbackDescription: 'Fallback sicuro.' }).description, 'Fallback sicuro.')
  assert.equal(userErrorMessage(hostile, 'Fallback sicuro.'), 'Fallback sicuro.')
})

test('registra solo metadati consentiti senza contenuto privato', () => {
  const originalConsoleError = console.error
  const logged = []
  console.error = (value) => logged.push(value)
  try {
    const result = normalizeUserError(new Error('token=private-value'), {
      category: 'network',
      component: 'github',
      operation: 'fetch',
      fallbackDescription: 'Impossibile contattare GitHub.',
    })
    assert.equal(reportUserError(result), result)
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(logged.length, 1)
  const payload = JSON.parse(logged[0])
  assert.deepEqual(Object.keys(payload).sort(), [
    'category',
    'component',
    'correlationId',
    'event',
    'operation',
    'severity',
  ])
  assert.doesNotMatch(logged[0], /private-value/u)
})
