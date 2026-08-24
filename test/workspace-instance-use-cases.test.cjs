const assert = require('node:assert/strict')
const test = require('node:test')

const { createWorkspaceInstanceUseCases } = require('../electron/domains/workspace/workspace-instance-use-cases.cjs')

function workspaceInstanceFixture(overrides = {}) {
  const calls = []
  const launchOptions = []
  const scheduled = []
  const results = {
    launch: { launched: true },
    status: { activeCount: 1, canOpenNew: true, maxInstances: 2, workspaceOpenElsewhere: false },
  }
  const dependencies = {
    applicationExecutable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    applicationIsPackaged: true,
    getApplicationPath: () => { calls.push(['get-app-path']); return '/Applications/VincodeLab.app' },
    getInstanceStatus: (workspacePath) => { calls.push(['instance-status', workspacePath]); return results.status },
    isDirectory: (workspacePath) => { calls.push(['is-directory', workspacePath]); return true },
    launchWorkspaceInstance: async (options) => {
      launchOptions.push(options)
      calls.push(['launch-instance', {
        executable: options.executable,
        appPath: options.appPath,
        packaged: options.packaged,
        workspacePath: options.workspacePath,
        onPostLaunchError: typeof options.onPostLaunchError,
      }])
      return results.launch
    },
    log: (...args) => { calls.push(['log', ...args]) },
    scheduleTimeout: (callback, delay) => {
      calls.push(['schedule-timeout', delay])
      const timer = { callback, delay, unref: () => { calls.push(['timer-unref']); return timer } }
      scheduled.push(timer)
      return timer
    },
    showErrorBox: (title, message) => { calls.push(['show-error-box', title, message]) },
    toPublicErrorMessage: (error, options) => {
      calls.push(['to-public-error', error, options])
      return `Messaggio ${options.code}`
    },
    ...overrides,
  }

  return {
    calls,
    launchOptions,
    results,
    scheduled,
    useCases: createWorkspaceInstanceUseCases(dependencies),
  }
}

test('getStatus valida il path e conserva il DTO base del registry', () => {
  for (const workspacePath of [null, 7, 'relative/path', `/${'x'.repeat(4_096)}`]) {
    const fixture = workspaceInstanceFixture()
    assert.deepEqual(fixture.useCases.getStatus(workspacePath), {
      ...fixture.results.status,
      canOpenNew: false,
      workspaceOpenElsewhere: false,
      reason: 'invalid-path',
    })
    assert.deepEqual(fixture.calls, [['instance-status', undefined]])
  }

  for (const workspacePath of [undefined, '/workspace/current', `/${'x'.repeat(4_095)}`]) {
    const fixture = workspaceInstanceFixture()
    assert.equal(fixture.useCases.getStatus(workspacePath), fixture.results.status)
    assert.deepEqual(fixture.calls, [['instance-status', workspacePath]])
  }
})

test('openInNewInstance rifiuta path invalidi e directory non disponibili prima del registry', async () => {
  for (const workspacePath of [undefined, null, 'relative/path', `/${'x'.repeat(4_096)}`]) {
    const fixture = workspaceInstanceFixture()
    assert.deepEqual(await fixture.useCases.openInNewInstance(workspacePath), {
      launched: false,
      reason: 'invalid-path',
      message: 'La cartella selezionata non è disponibile.',
    })
    assert.deepEqual(fixture.calls, [])
  }

  const missingFixture = workspaceInstanceFixture({ isDirectory: (workspacePath) => {
    missingFixture.calls.push(['is-directory', workspacePath])
    return false
  } })
  assert.deepEqual(await missingFixture.useCases.openInNewInstance('/workspace/missing'), {
    launched: false,
    reason: 'invalid-path',
    message: 'La cartella selezionata non è disponibile.',
  })
  assert.deepEqual(missingFixture.calls, [['is-directory', '/workspace/missing']])
})

test('openInNewInstance distingue limite globale e workspace duplicato', async () => {
  const cases = [
    [{ activeCount: 1, canOpenNew: false, maxInstances: 2, workspaceOpenElsewhere: true }, 'duplicate', 'Questo workspace è già aperto in un’altra finestra.'],
    [{ activeCount: 2, canOpenNew: false, maxInstances: 2, workspaceOpenElsewhere: false }, 'limit', 'Puoi usare al massimo due finestre contemporaneamente.'],
  ]

  for (const [status, reason, message] of cases) {
    const fixture = workspaceInstanceFixture({ getInstanceStatus: (workspacePath) => {
      fixture.calls.push(['instance-status', workspacePath])
      return status
    } })
    assert.deepEqual(await fixture.useCases.openInNewInstance('/workspace/current'), { launched: false, reason, message })
    assert.deepEqual(fixture.calls, [
      ['is-directory', '/workspace/current'],
      ['instance-status', '/workspace/current'],
    ])
  }
})

test('openInNewInstance lancia con i dati applicativi e rilascia il lock dopo due secondi', async () => {
  const fixture = workspaceInstanceFixture()

  assert.equal(await fixture.useCases.openInNewInstance('/workspace/current'), fixture.results.launch)
  assert.deepEqual(fixture.calls, [
    ['is-directory', '/workspace/current'],
    ['instance-status', '/workspace/current'],
    ['get-app-path'],
    ['launch-instance', {
      executable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
      appPath: '/Applications/VincodeLab.app',
      packaged: true,
      workspacePath: '/workspace/current',
      onPostLaunchError: 'function',
    }],
    ['schedule-timeout', 2_000],
    ['timer-unref'],
  ])
  assert.equal(Object.isFrozen(fixture.useCases), true)
  assert.equal(fixture.scheduled.length, 1)

  assert.deepEqual(await fixture.useCases.openInNewInstance('/workspace/other'), {
    launched: false,
    reason: 'limit',
    message: 'Apertura di una nuova finestra già in corso.',
  })
  assert.equal(fixture.calls.at(-1)[0], 'timer-unref')

  fixture.scheduled[0].callback()
  assert.equal(await fixture.useCases.openInNewInstance('/workspace/other'), fixture.results.launch)

  const processError = new Error('child terminated')
  fixture.launchOptions[0].onPostLaunchError(processError)
  assert.deepEqual(fixture.calls.slice(-3), [
    ['log', 'error', 'workspace_instance_process_error'],
    ['to-public-error', processError, { code: 'WORKSPACE_INSTANCE_PROCESS_FAILED', message: 'La nuova finestra non è rimasta disponibile.' }],
    ['show-error-box', 'Nuova finestra terminata', 'Messaggio WORKSPACE_INSTANCE_PROCESS_FAILED'],
  ])
})

test('openInNewInstance acquisisce il lock prima di attendere il launch', async () => {
  let resolveLaunch
  const pendingLaunch = new Promise((resolve) => { resolveLaunch = resolve })
  const fixture = workspaceInstanceFixture({ launchWorkspaceInstance: async () => pendingLaunch })

  const firstLaunch = fixture.useCases.openInNewInstance('/workspace/current')
  assert.deepEqual(await fixture.useCases.openInNewInstance('/workspace/other'), {
    launched: false,
    reason: 'limit',
    message: 'Apertura di una nuova finestra già in corso.',
  })

  resolveLaunch(fixture.results.launch)
  assert.equal(await firstLaunch, fixture.results.launch)
  assert.equal(fixture.scheduled.length, 1)
})

test('openInNewInstance trasforma il failure iniziale e pianifica comunque il rilascio', async () => {
  const failure = new Error('spawn failed')
  const fixture = workspaceInstanceFixture({ launchWorkspaceInstance: async () => {
    fixture.calls.push(['launch-instance-failed'])
    throw failure
  } })

  assert.deepEqual(await fixture.useCases.openInNewInstance('/workspace/current'), {
    launched: false,
    reason: 'launch-failed',
    message: 'Messaggio WORKSPACE_INSTANCE_LAUNCH_FAILED',
  })
  assert.deepEqual(fixture.calls.slice(-5), [
    ['launch-instance-failed'],
    ['log', 'error', 'workspace_instance_launch_failed'],
    ['to-public-error', failure, { code: 'WORKSPACE_INSTANCE_LAUNCH_FAILED', message: 'Impossibile aprire una nuova finestra.' }],
    ['schedule-timeout', 2_000],
    ['timer-unref'],
  ])
  assert.equal(fixture.scheduled.length, 1)

  assert.deepEqual(await fixture.useCases.openInNewInstance('/workspace/other'), {
    launched: false,
    reason: 'limit',
    message: 'Apertura di una nuova finestra già in corso.',
  })
  fixture.scheduled[0].callback()
})
