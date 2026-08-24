const assert = require('node:assert/strict')
const test = require('node:test')

const { isApplicationError } = require('../electron/domains/errors/application-error.cjs')
const {
  createShellSessionErrorEvent,
  reportShellSessionOneWayFailure,
} = require('../electron/domains/shell/shell-session-error-event.cjs')

const PRIVATE_DETAIL = '/Users/alice/private-workspace token=ghp_secret command="sudo deploy"'
const SESSION_ID = 'session-0001'

test('write e resize producono eventi locali sanitizzati con recovery distinta', async (t) => {
  const cases = [
    {
      operation: 'write',
      code: 'SHELL_SESSION_WRITE_FAILED',
      category: 'process',
      recovery: 'restart',
      message: /testo non è stato inviato alla shell/i,
      errorCode: 'EPIPE',
    },
    {
      operation: 'resize',
      code: 'SHELL_SESSION_RESIZE_FAILED',
      category: 'permission',
      recovery: 'resize',
      message: /terminale non è stato ridimensionato/i,
      errorCode: 'EACCES',
    },
  ]

  for (const fixture of cases) {
    await t.test(fixture.operation, () => {
      const error = Object.assign(new Error(`PTY ${fixture.operation} failed ${PRIVATE_DETAIL}`), { code: fixture.errorCode })
      const logs = []
      const deliveries = []
      const result = reportShellSessionOneWayFailure({
        error,
        operation: fixture.operation,
        sessionId: SESSION_ID,
        log: (...entry) => logs.push(entry),
        send: (payload) => deliveries.push(payload),
      })

      assert.equal(isApplicationError(result.incident), true)
      assert.equal(result.incident.category, fixture.category)
      assert.equal(result.incident.domain, 'terminal')
      assert.equal(result.incident.operation, fixture.operation)
      assert.equal(result.payload.sessionId, SESSION_ID)
      assert.equal(result.payload.operation, fixture.operation)
      assert.equal(result.payload.recovery, fixture.recovery)
      assert.equal(result.payload.error.code, fixture.code)
      assert.equal(result.payload.error.correlationId, result.incident.correlationId)
      assert.match(result.payload.error.message, fixture.message)
      assert.match(result.payload.error.message, new RegExp(`\\[${fixture.code}\\] \\[ERR-[A-F0-9]{6}\\]$`))
      assert.deepEqual(deliveries, [result.payload])
      assert.equal(logs.length, 1)
      assert.equal(logs[0][0], result.incident.severity)
      assert.equal(logs[0][1], 'shell_session_one_way_failed')
      assert.deepEqual(Object.keys(logs[0][2]).sort(), [
        'category',
        'code',
        'component',
        'correlationId',
        'fingerprint',
        'operation',
        'sessionId',
        'severity',
        'technicalCode',
        'technicalName',
      ])
      assert.match(logs[0][2].fingerprint, /^FP-[A-F0-9]{12}$/u)
      assert.equal(logs[0][2].technicalCode, fixture.errorCode)
      assert.equal(logs[0][2].technicalName, 'Error')
      assert.doesNotMatch(JSON.stringify({ deliveries, logs }), /alice|private-workspace|ghp_|secret|sudo|deploy|command=/i)
    })
  }
})

test('ready ack e disconnect richiedono il recupero locale dell output', () => {
  for (const operation of ['ready', 'ack', 'disconnect']) {
    const result = createShellSessionErrorEvent(new Error(`renderer transport rejected ${PRIVATE_DETAIL}`), {
      operation,
      sessionId: SESSION_ID,
    })
    assert.equal(result.payload.operation, operation)
    assert.equal(result.payload.recovery, 'resume')
    assert.equal(result.payload.error.code, `SHELL_SESSION_${operation.toUpperCase()}_FAILED`)
    assert.doesNotMatch(result.payload.error.message, /alice|private-workspace|ghp_|secret|sudo|deploy/i)
  }
})

test('un sessionId non valido viene registrato ma non attraversa IPC', () => {
  const unsafeSessionId = `../../${PRIVATE_DETAIL}`
  const deliveries = []
  const logs = []
  const result = reportShellSessionOneWayFailure({
    error: new Error(`PTY write failed ${PRIVATE_DETAIL}`),
    operation: 'write',
    sessionId: unsafeSessionId,
    log: (...entry) => logs.push(entry),
    send: (payload) => deliveries.push(payload),
  })

  assert.equal(result.payload, null)
  assert.equal(result.incident.code, 'SHELL_SESSION_INVALID')
  assert.equal(result.incident.category, 'validation')
  assert.deepEqual(deliveries, [])
  assert.equal('sessionId' in logs[0][2], false)
  assert.doesNotMatch(JSON.stringify(logs), /alice|private-workspace|ghp_|secret|sudo|deploy|\.\.\//i)
})
