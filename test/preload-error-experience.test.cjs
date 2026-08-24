const { expandIpcChannelConstants } = require('./helpers/ipc-source.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { reportPreloadFailure } = require('../electron/app/preload-error-experience.cjs')

test('classifica il preload failure, correla il recovery e non inoltra dettagli raw', () => {
  const logs = []
  const recoveries = []
  const raw = new Error('token=secret in /Users/alice/private/preload.cjs')
  raw.stack = 'Error: token=secret\n    at /Users/alice/private/preload.cjs:1:1'

  const result = reportPreloadFailure(raw, {
    log: (...entry) => logs.push(entry),
    recover: (details) => {
      recoveries.push(details)
      return Promise.resolve(true)
    },
  })

  assert.equal(result.incident.category, 'internal')
  assert.equal(result.incident.publicCode, 'RENDERER_PRELOAD_FAILED')
  assert.equal(result.incident.publicMessage, 'Impossibile avviare l’interfaccia di VincodeLab.')
  assert.match(result.incident.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.deepEqual(recoveries, [{ correlationId: result.incident.correlationId }])
  assert.deepEqual(logs, [[
    'error',
    'preload_failed',
    {
      category: 'internal',
      code: 'RENDERER_PRELOAD_FAILED',
      component: 'internal',
      correlationId: result.incident.correlationId,
      fingerprint: logs[0][2].fingerprint,
      operation: 'preload',
      severity: 'error',
      technicalName: 'Error',
    },
  ]])
  assert.match(logs[0][2].fingerprint, /^FP-[A-F0-9]{12}$/u)
  assert.doesNotMatch(JSON.stringify({ logs, recoveries }), /secret|alice|preload\.cjs|stack|message|path/iu)
})

test('mantiene disponibile il recovery anche se il logger è degradato', () => {
  const recoveries = []
  const result = reportPreloadFailure(new Error('private detail'), {
    log: () => { throw new Error('sink non disponibile') },
    recover: (details) => {
      recoveries.push(details)
      return false
    },
  })

  assert.deepEqual(recoveries, [{ correlationId: result.incident.correlationId }])
  assert.equal(result.recovery, false)
})

test('il main non passa path, messaggi, tabella o connessione grezzi ai log interessati', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const startupRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-startup-runtime.cjs'), 'utf8')
  const windowLifecycle = fs.readFileSync(path.join(__dirname, '../electron/app/window-lifecycle-runtime.cjs'), 'utf8')
  const databaseIpc = expandIpcChannelConstants(fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/database.ipc.cjs'), 'utf8'))
  const preloadHandler = windowLifecycle.match(/webContents\.on\('preload-error',[\s\S]*?\n    \}\)/u)?.[0] ?? ''
  const migrationHandler = startupRuntime.match(/function migrateLegacyDatabaseSecretsInBatches\(\) \{[\s\S]*?\n  \}/u)?.[0] ?? ''
  const tableRowsHandler = databaseIpc.match(/\['database:tableRows',[\s\S]*?\n    \}\],/u)?.[0] ?? ''

  assert.match(preloadHandler, /reportPreloadFailure\(error/u)
  assert.doesNotMatch(preloadHandler, /log\([^\n]*(?:preloadPath|error\.message|message:)/u)
  assert.match(migrationHandler, /getApplicationErrorLogMetadata\(incident\)/u)
  assert.doesNotMatch(migrationHandler, /message:\s*error|String\(error\)/u)
  assert.match(tableRowsHandler, /getApplicationErrorLogMetadata\(incident\)/u)
  assert.doesNotMatch(tableRowsHandler, /log\([^\n]*(?:connectionId|tableName|error\.message|message:)/u)
  assert.match(main, /createApplicationStartupRuntime\(\{/u)
})
