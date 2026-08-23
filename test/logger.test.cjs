const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createLogger, parseRendererDiagnosticMessage, sanitizeFields } = require('../electron/logger.cjs')

function temporaryLogs(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-logger-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function fileSystemWithPromises(overrides) {
  return {
    promises: new Proxy(fs.promises, {
      get(target, property) {
        if (property in overrides) return overrides[property]
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
  }
}

test('scrive in coda senza conservare percorsi, query o segreti arbitrari', async (t) => {
  const root = temporaryLogs(t)
  const logger = createLogger({ getLogsDirectory: () => root })

  logger.log('error', 'database_failed', {
    connectionId: 'connection-1',
    message: 'password=hunter2 SELECT * FROM private_table',
    preloadPath: '/Users/alice/project/private.js',
    operation: 'connect',
  })
  await logger.flush()

  const content = fs.readFileSync(path.join(root, 'VincodeLab', 'app.log'), 'utf8')
  assert.match(content, /"event":"database_failed"/u)
  assert.match(content, /"connectionId":"connection-1"/u)
  assert.match(content, /"operation":"connect"/u)
  assert.doesNotMatch(content, /hunter2|private_table|alice|preloadPath|message/u)
})

test('limita tipi, chiavi e stringhe dei campi diagnostici', () => {
  const fields = sanitizeFields({
    eventChannel: 'terminal:error',
    globalCount: 2,
    total: 3,
    failed: Number.POSITIVE_INFINITY,
    reason: `password=segreta ${'x'.repeat(1_000)}`,
    query: 'SELECT token FROM users',
    nested: { password: 'no' },
  })

  assert.equal(fields.total, 3)
  assert.equal(fields.globalCount, 2)
  assert.equal(fields.eventChannel, 'terminal:error')
  assert.equal('failed' in fields, false)
  assert.equal('query' in fields, false)
  assert.equal('nested' in fields, false)
  assert.match(fields.reason, /password=\[redacted\]/u)
  assert.ok(Buffer.byteLength(fields.reason) <= 256)
})

test('mantiene bounded la coda anche se il filesystem è più lento dei producer', async (t) => {
  const root = temporaryLogs(t)
  const logger = createLogger({ getLogsDirectory: () => root, maxQueueBytes: 1_024 })

  for (let index = 0; index < 200; index += 1) logger.log('info', 'burst', { sessionId: `session-${index}-${'x'.repeat(120)}` })
  await logger.flush()

  const filePath = path.join(root, 'VincodeLab', 'app.log')
  const content = fs.readFileSync(filePath, 'utf8')
  assert.match(content, /log_queue_entries_dropped/u)
  assert.ok(fs.statSync(filePath).size < 4_096)
})

test('ritenta un append transitorio senza perdere o duplicare il batch', async (t) => {
  const root = temporaryLogs(t)
  let attempts = 0
  const logger = createLogger({
    fileSystem: fileSystemWithPromises({
      appendFile: async (...args) => {
        attempts += 1
        if (attempts < 3) throw Object.assign(new Error('sink temporaneamente indisponibile'), { code: 'EIO' })
        return fs.promises.appendFile(...args)
      },
    }),
    getLogsDirectory: () => root,
    maxWriteAttempts: 3,
  })

  logger.log('error', 'retryable_write', { correlationId: 'ERR-8F2A1C' })
  await logger.flush()

  const content = fs.readFileSync(path.join(root, 'VincodeLab', 'app.log'), 'utf8')
  assert.equal(attempts, 3)
  assert.equal((content.match(/"event":"retryable_write"/gu) ?? []).length, 1)
})

test('limita i tentativi su un sink guasto e accetta nuovi eventi dopo il ripristino', async (t) => {
  const root = temporaryLogs(t)
  let attempts = 0
  let available = false
  const logger = createLogger({
    fileSystem: fileSystemWithPromises({
      appendFile: async (...args) => {
        attempts += 1
        if (!available) throw Object.assign(new Error('sink non disponibile'), { code: 'EIO' })
        return fs.promises.appendFile(...args)
      },
    }),
    getLogsDirectory: () => root,
    maxWriteAttempts: 2,
  })

  logger.log('error', 'bounded_write_failure')
  await logger.flush()
  assert.equal(attempts, 2)

  available = true
  logger.log('info', 'write_recovered')
  await logger.flush()

  assert.equal(attempts, 3)
  const content = fs.readFileSync(path.join(root, 'VincodeLab', 'app.log'), 'utf8')
  assert.doesNotMatch(content, /bounded_write_failure/u)
  assert.match(content, /"event":"write_recovered"/u)
})

test('ritenta anche una rotazione transitoria prima di scrivere il nuovo batch', async (t) => {
  const root = temporaryLogs(t)
  const directory = path.join(root, 'VincodeLab')
  const filePath = path.join(directory, 'app.log')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(filePath, 'x'.repeat(1_024))
  let renameAttempts = 0
  const logger = createLogger({
    fileSystem: fileSystemWithPromises({
      rename: async (...args) => {
        renameAttempts += 1
        if (renameAttempts === 1) throw Object.assign(new Error('rotazione occupata'), { code: 'EBUSY' })
        return fs.promises.rename(...args)
      },
    }),
    getLogsDirectory: () => root,
    maxLogBytes: 1_024,
    maxWriteAttempts: 2,
  })

  logger.log('info', 'rotation_recovered')
  await logger.flush()

  assert.equal(renameAttempts, 2)
  assert.equal(fs.statSync(`${filePath}.1`).size, 1_024)
  assert.match(fs.readFileSync(filePath, 'utf8'), /"event":"rotation_recovered"/u)
})

test('accetta soltanto diagnostica renderer strutturata e privacy-safe', () => {
  assert.deepEqual(parseRendererDiagnosticMessage(JSON.stringify({
    event: 'renderer_app_error',
    sessionId: 'renderer-a1b2c3d4',
    reason: 'TypeError',
  })), {
    event: 'renderer_app_error',
    fields: { sessionId: 'renderer-a1b2c3d4', reason: 'TypeError' },
  })

  assert.deepEqual(parseRendererDiagnosticMessage(JSON.stringify({
    event: 'renderer_user_error',
    category: 'database',
    code: 'DB_QUERY_TIMEOUT',
    component: 'database',
    correlationId: 'ERR-8F2A1C',
    operation: 'execute-query',
    severity: 'warning',
  })), {
    event: 'renderer_user_error',
    fields: {
      category: 'database',
      code: 'DB_QUERY_TIMEOUT',
      component: 'database',
      correlationId: 'ERR-8F2A1C',
      operation: 'execute-query',
      severity: 'warning',
    },
    level: 'warning',
  })

  for (const value of [
    'stack e contenuto privato',
    JSON.stringify({ event: 'renderer_app_error', sessionId: 'renderer-ok', reason: 'Error', stack: '/Users/alice/private.ts' }),
    JSON.stringify({ event: 'renderer_app_error', sessionId: 'renderer-ok', reason: 'password=secret' }),
    JSON.stringify({ event: 'renderer_user_error', category: 'database', correlationId: 'ERR-8F2A1C', severity: 'error', detail: 'token=secret' }),
    JSON.stringify({ event: 'renderer_user_error', category: 'unknown', correlationId: 'ERR-8F2A1C', severity: 'error' }),
    JSON.stringify({ event: 'renderer_user_error', category: 'database', correlationId: 'bad-id', severity: 'error' }),
    JSON.stringify({ event: 'evento_arbitrario', sessionId: 'renderer-ok', reason: 'Error' }),
  ]) assert.equal(parseRendererDiagnosticMessage(value), null)
})

test('supporta i quattro livelli canonici del sistema errori', async (t) => {
  const root = temporaryLogs(t)
  const logger = createLogger({ getLogsDirectory: () => root })

  for (const level of ['debug', 'info', 'warning', 'error']) logger.log(level, `${level}_event`)
  await logger.flush()

  const content = fs.readFileSync(path.join(root, 'VincodeLab', 'app.log'), 'utf8')
  for (const level of ['debug', 'info', 'warning', 'error']) assert.match(content, new RegExp(`"level":"${level}"`, 'u'))
})
