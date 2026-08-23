const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { ERR_ABORTED, createRendererRecoveryController } = require('../electron/renderer-recovery-controller.cjs')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function createFixture({ reload = () => undefined } = {}) {
  let destroyed = false
  let closing = false
  const choices = []
  const reloads = []
  const errors = []
  const pendingChoices = []
  const controller = createRendererRecoveryController({
    chooseRecovery: (incident) => {
      choices.push(incident)
      const choice = deferred()
      pendingChoices.push(choice)
      return choice.promise
    },
    reload: () => {
      reloads.push('reload')
      return reload()
    },
    isDestroyed: () => destroyed,
    isClosing: () => closing,
    onError: (error) => errors.push(error),
  })
  return {
    choices,
    controller,
    errors,
    pendingChoices,
    reloads,
    setClosing: (value) => { closing = value },
    setDestroyed: (value) => { destroyed = value },
  }
}

test('ignora load abortiti e frame secondari', () => {
  const fixture = createFixture()

  assert.equal(fixture.controller.handleLoadFailure({ errorCode: -105, isMainFrame: false }), false)
  assert.equal(fixture.controller.handleLoadFailure({ errorCode: ERR_ABORTED, isMainFrame: true }), false)
  assert.deepEqual(fixture.choices, [])
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('coalesca crash e load failure soltanto mentre la scelta dello stesso incidente è attiva', async () => {
  const fixture = createFixture()
  const crash = fixture.controller.handleProcessGone({ correlationId: 'ERR-A1B2C3', reason: 'crashed', privateDetail: '/Users/demo/workspace' })
  const loadFailure = fixture.controller.handleLoadFailure({ errorCode: -2, isMainFrame: true, validatedURL: 'file:///private/workspace' })

  assert.equal(crash, loadFailure)
  await Promise.resolve()
  assert.deepEqual(fixture.choices, [{ source: 'render-process-gone', reason: 'crashed', correlationId: 'ERR-A1B2C3' }])
  fixture.pendingChoices[0].resolve('reload')
  assert.equal(await crash, true)
  assert.deepEqual(fixture.reloads, ['reload'])
  assert.deepEqual(fixture.controller.getState(), { active: true, reloadRequested: true })
  assert.equal(fixture.controller.handleLoadFinished(), true)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('una scelta di restare aperti termina subito l’incidente e consente un recovery successivo', async () => {
  const fixture = createFixture()
  const first = fixture.controller.handleLoadFailure({ errorCode: -105, isMainFrame: true })
  await Promise.resolve()
  fixture.pendingChoices[0].resolve('stay')

  assert.equal(await first, false)
  assert.deepEqual(fixture.reloads, [])
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
  const second = fixture.controller.handleProcessGone({ reason: 'abnormal-exit' })
  await Promise.resolve()
  assert.equal(fixture.choices.length, 2)
  fixture.pendingChoices[1].resolve('reload')
  assert.equal(await second, true)
  assert.deepEqual(fixture.reloads, ['reload'])
})

test('un reload che fallisce produce feedback, resetta il controller e permette retry riuscito', async () => {
  let reloadAttempt = 0
  const fixture = createFixture({
    reload: () => {
      reloadAttempt += 1
      if (reloadAttempt === 1) throw new Error('reload non disponibile')
    },
  })
  const first = fixture.controller.handleProcessGone({ reason: 'crashed' })
  await Promise.resolve()
  fixture.pendingChoices[0].resolve('reload')

  assert.equal(await first, false)
  assert.deepEqual(fixture.errors.map((error) => error.message), ['reload non disponibile'])
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })

  const retry = fixture.controller.handleProcessGone({ reason: 'oom' })
  await Promise.resolve()
  assert.equal(fixture.choices.length, 2)
  fixture.pendingChoices[1].resolve('reload')
  assert.equal(await retry, true)
  assert.deepEqual(fixture.reloads, ['reload', 'reload'])
  assert.deepEqual(fixture.controller.getState(), { active: true, reloadRequested: true })
  assert.equal(fixture.controller.handleLoadFinished(), true)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('un did-fail-load dopo reload apre un nuovo incidente senza riusare la promessa conclusa', async () => {
  const fixture = createFixture()
  const first = fixture.controller.handleProcessGone({ reason: 'crashed' })
  await Promise.resolve()
  fixture.pendingChoices[0].resolve('reload')
  assert.equal(await first, true)

  const failedReload = fixture.controller.handleLoadFailure({ errorCode: -105, isMainFrame: true })
  assert.notEqual(failedReload, first)
  await Promise.resolve()
  assert.deepEqual(fixture.choices, [
    { source: 'render-process-gone', reason: 'crashed' },
    { source: 'did-fail-load', errorCode: -105 },
  ])
  fixture.pendingChoices[1].resolve('stay')
  assert.equal(await failedReload, false)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })

  const retry = fixture.controller.handleProcessGone({ reason: 'oom' })
  await Promise.resolve()
  assert.equal(fixture.choices.length, 3)
  fixture.pendingChoices[2].resolve('reload')
  assert.equal(await retry, true)
  assert.deepEqual(fixture.reloads, ['reload', 'reload'])
})

test('fallimenti ripetuti della scelta o del reload non lasciano lock né dialog paralleli', async () => {
  let reloadAttempt = 0
  const fixture = createFixture({
    reload: async () => {
      reloadAttempt += 1
      throw new Error(`reload failure ${reloadAttempt}`)
    },
  })

  const rejectedChoice = fixture.controller.handleProcessGone({ reason: 'launch-failed' })
  assert.equal(fixture.controller.handleLoadFailure({ errorCode: -2, isMainFrame: true }), rejectedChoice)
  await Promise.resolve()
  assert.equal(fixture.choices.length, 1)
  fixture.pendingChoices[0].reject(new Error('dialog failure'))
  assert.equal(await rejectedChoice, false)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })

  for (const [index, reason] of ['abnormal-exit', 'integrity-failure'].entries()) {
    const attempt = fixture.controller.handleProcessGone({ reason })
    assert.equal(fixture.controller.handleProcessGone({ reason: 'oom' }), attempt)
    await Promise.resolve()
    assert.equal(fixture.choices.length, index + 2)
    fixture.pendingChoices[index + 1].resolve('reload')
    assert.equal(await attempt, false)
    assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
  }

  assert.deepEqual(fixture.errors.map((error) => error.message), [
    'dialog failure',
    'reload failure 1',
    'reload failure 2',
  ])
  assert.deepEqual(fixture.reloads, ['reload', 'reload'])
})

test('did-finish-load invalida anche una scelta asincrona ormai stale', async () => {
  const fixture = createFixture()
  const pending = fixture.controller.handleProcessGone({ reason: 'launch-failed' })
  await Promise.resolve()

  assert.equal(fixture.controller.handleLoadFinished(), true)
  fixture.pendingChoices[0].resolve('reload')
  assert.equal(await pending, false)
  assert.deepEqual(fixture.reloads, [])
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('un preload fallito conserva il recovery fino alla scelta e correla il reload locale', async () => {
  const fixture = createFixture()
  const pending = fixture.controller.handlePreloadFailure({
    correlationId: 'ERR-8F2A1C',
    preloadPath: '/Users/demo/private/preload.cjs',
    message: 'token=secret',
  })
  await Promise.resolve()

  assert.deepEqual(fixture.choices, [{ source: 'preload-error', correlationId: 'ERR-8F2A1C' }])
  assert.equal(fixture.controller.handleLoadFinished(), false)
  assert.deepEqual(fixture.controller.getState(), { active: true, reloadRequested: false })

  fixture.pendingChoices[0].resolve('reload')
  assert.equal(await pending, true)
  assert.deepEqual(fixture.reloads, ['reload'])
  assert.equal(fixture.controller.handleLoadFinished(), true)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('non apre recovery né ricarica durante chiusura o dopo distruzione', async () => {
  const fixture = createFixture()
  fixture.setClosing(true)
  assert.equal(fixture.controller.handleProcessGone({ reason: 'killed' }), false)
  fixture.setClosing(false)
  fixture.setDestroyed(true)
  assert.equal(fixture.controller.handleLoadFailure({ errorCode: -2, isMainFrame: true }), false)
  assert.deepEqual(fixture.choices, [])

  fixture.setDestroyed(false)
  const pending = fixture.controller.handleProcessGone({ reason: 'integrity-failure' })
  await Promise.resolve()
  fixture.setClosing(true)
  fixture.pendingChoices[0].resolve('reload')
  assert.equal(await pending, false)
  assert.deepEqual(fixture.reloads, [])
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('dispose rende no-op il controller; un errore della scelta viene segnalato e lascia libero il retry', async () => {
  const fixture = createFixture()
  const failed = fixture.controller.handleProcessGone({ reason: 'valore-non-previsto' })
  await Promise.resolve()
  assert.deepEqual(fixture.choices, [{ source: 'render-process-gone', reason: 'unknown' }])
  fixture.pendingChoices[0].reject(new Error('dialog non disponibile'))
  assert.equal(await failed, false)
  assert.equal(fixture.errors.length, 1)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })

  const retry = fixture.controller.handleProcessGone({ reason: 'crashed' })
  await Promise.resolve()
  assert.equal(fixture.choices.length, 2)
  fixture.pendingChoices[1].resolve('stay')
  assert.equal(await retry, false)

  fixture.controller.dispose()
  assert.equal(fixture.controller.handleProcessGone({ reason: 'crashed' }), false)
  assert.equal(fixture.controller.handleLoadFinished(), false)
  assert.deepEqual(fixture.controller.getState(), { active: false, reloadRequested: false })
})

test('il main inoltra successi e failure del caricamento allo stesso controller locale', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  assert.match(main, /reload: \(\) => window\.webContents\.reload\(\)/)
  assert.match(main, /webContents\.on\('did-fail-load',[\s\S]{0,300}recoveryController\.handleLoadFailure\(\{ errorCode, isMainFrame \}\)/)
  assert.match(main, /webContents\.on\('did-finish-load',[\s\S]{0,160}recoveryController\.handleLoadFinished\(\)/)
  assert.match(main, /webContents\.on\('preload-error',[\s\S]{0,260}reportPreloadFailure\(error,[\s\S]{0,160}recoveryController\.handlePreloadFailure\(details\)/)
  assert.match(main, /onError: \(\) => log\('error', 'renderer_recovery_failed'\)/)
})
