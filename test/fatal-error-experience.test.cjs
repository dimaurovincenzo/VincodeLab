const assert = require('node:assert/strict')
const test = require('node:test')

const { createFatalErrorExperience } = require('../electron/app/fatal-error-experience.cjs')

function harness(responses = [0]) {
  const calls = { clipboard: [], dialogs: [], exits: [], logs: [], relaunches: 0, flushes: 0 }
  const experience = createFatalErrorExperience({
    app: {
      exit: (code) => calls.exits.push(code),
      relaunch: () => { calls.relaunches += 1 },
    },
    clipboard: { writeText: (value) => calls.clipboard.push(value) },
    dialog: {
      showMessageBox: async (options) => {
        calls.dialogs.push(options)
        return { response: responses.shift() ?? 0 }
      },
    },
    flushLogs: async () => { calls.flushes += 1 },
    log: (...entry) => calls.logs.push(entry),
    now: () => new Date('2026-08-23T10:00:00.000Z'),
  })
  return { calls, experience }
}

test('l’avvio mostra recovery, copia diagnostica sanitizzata e riavvia', async () => {
  const { calls, experience } = harness([1, 0])
  const error = Object.assign(new Error('password=secret /Users/alice/private/project.db'), { code: 'EACCES' })

  assert.equal(await experience.handleStartup(error), 'restart')
  assert.equal(calls.dialogs.length, 2)
  assert.deepEqual(calls.dialogs[0].buttons, ['Riprova avvio', 'Copia diagnostica', 'Esci'])
  assert.match(calls.dialogs[0].detail, /Riferimento ERR-[A-F0-9]{6}/u)
  assert.equal(calls.clipboard.length, 1)
  assert.match(calls.clipboard[0], /Categoria: permission/u)
  assert.match(calls.clipboard[0], /Operazione: startup/u)
  assert.doesNotMatch(calls.clipboard[0], /secret|alice|private|project\.db|stack/u)
  assert.equal(calls.relaunches, 1)
  assert.deepEqual(calls.exits, [1])
  assert.equal(calls.flushes, 1)
  assert.deepEqual(Object.keys(calls.logs[0][2]).sort(), [
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
  assert.match(calls.logs[0][2].fingerprint, /^FP-[A-F0-9]{12}$/u)
  assert.equal(calls.logs[0][2].technicalCode, 'EACCES')
  assert.equal(calls.logs[0][2].technicalName, 'Error')
})

test('un’installazione incompleta indica la reinstallazione senza retry cieco', async () => {
  const { calls, experience } = harness([1, 0])
  const error = new Error('binding privato non disponibile')

  assert.equal(await experience.handleInstallationFailure(error), 'exit')
  assert.deepEqual(calls.dialogs[0].buttons, ['Esci e reinstalla', 'Copia diagnostica'])
  assert.equal(calls.dialogs[0].title, 'Installazione da riparare')
  assert.match(calls.dialogs[0].detail, /pacchetto adatto a questo Mac/u)
  assert.match(calls.clipboard[0], /Operazione: load-bundled-runtime/u)
  assert.deepEqual(calls.exits, [1])
})

test('una rejection non gestita può restare confinata senza terminare l’app', async () => {
  const { calls, experience } = harness([0])

  assert.equal(await experience.handleUnhandledRejection(new Error('socket closed token=secret')), 'continue')
  assert.equal(calls.dialogs.length, 1)
  assert.deepEqual(calls.dialogs[0].buttons, ['Continua', 'Copia diagnostica', 'Riavvia VincodeLab'])
  assert.deepEqual(calls.exits, [])
  assert.equal(calls.relaunches, 0)
})

test('una cancellazione attesa viene registrata senza interrompere il focus con un dialog', async () => {
  const { calls, experience } = harness([0])
  const cancellation = new Error('request aborted')
  cancellation.name = 'AbortError'
  cancellation.code = 'ABORT_ERR'

  assert.equal(await experience.handleUnhandledRejection(cancellation), 'continue')
  assert.equal(calls.dialogs.length, 0)
  assert.deepEqual(calls.exits, [])
  assert.equal(calls.logs[0][2].category, 'cancelled')
})

test('se il dialog fatal non è disponibile il main termina in modo deterministico', async () => {
  const calls = { exits: [], logs: [] }
  const experience = createFatalErrorExperience({
    app: { exit: (code) => calls.exits.push(code), relaunch: () => undefined },
    clipboard: { writeText: () => undefined },
    dialog: { showMessageBox: async () => { throw new Error('dialog unavailable') } },
    flushLogs: async () => undefined,
    log: (...entry) => calls.logs.push(entry),
  })

  assert.equal(await experience.handleUncaughtException(new Error('main failure')), 'exit')
  assert.deepEqual(calls.exits, [1])
  assert.ok(calls.logs.some((entry) => entry[1] === 'fatal_error_dialog_failed'))
})

test('la diagnostica fatal accetta solo nomi e codici tecnici allowlisted', async () => {
  const { calls, experience } = harness([1, 2])
  const error = new Error('owner=alice.private@example.test /tmp/vincodelab-private/source.ts')
  error.name = 'alice.private@example.test'
  error.code = '/private/tmp/vincodelab-private/code'

  assert.equal(await experience.handleStartup(error), 'exit')
  assert.equal(calls.clipboard.length, 1)
  assert.match(calls.clipboard[0], /Tipo tecnico: Error/u)
  assert.doesNotMatch(calls.clipboard[0], /Codice tecnico:/u)
  assert.doesNotMatch(JSON.stringify(calls), /alice|example\.test|vincodelab-private|source\.ts|private\/tmp/iu)
  assert.equal(calls.logs[0][2].technicalName, 'Error')
  assert.equal('technicalCode' in calls.logs[0][2], false)
})

test('il percorso fatal resta operativo con un Proxy che rifiuta ogni lettura', async () => {
  const { calls, experience } = harness([1, 0])
  const hostile = new Proxy({}, {
    get() { throw new Error('getter alice.private@example.test /var/folders/vincodelab-secret') },
    getPrototypeOf() { throw new Error('prototype /private/tmp/vincodelab-secret') },
  })

  assert.equal(await experience.handleUnhandledRejection(hostile), 'continue')
  assert.equal(calls.clipboard.length, 1)
  assert.match(calls.clipboard[0], /Tipo tecnico: Error/u)
  assert.doesNotMatch(calls.clipboard[0], /Codice tecnico:/u)
  assert.doesNotMatch(JSON.stringify(calls), /alice|example\.test|var\/folders|private\/tmp|vincodelab-secret/iu)
  assert.equal(calls.logs[0][2].technicalName, 'Error')
  assert.equal('technicalCode' in calls.logs[0][2], false)
})
