const assert = require('node:assert/strict')
const test = require('node:test')

const {
  WORKSPACE_INVOKE_CHANNELS,
  createWorkspaceHandlers,
  registerWorkspaceIpc,
} = require('../electron/ipc/domains/workspace.ipc.cjs')

function workspaceFixture(overrides = {}) {
  const calls = []
  const launchOptions = []
  const registrations = new Map()
  const revealOptions = []
  const scheduled = []
  let launchInProgress = overrides.launchInProgress ?? false
  const results = {
    activeError: 'Pi non disponibile',
    activeIncident: { code: 'PI_NOT_INSTALLED', correlationId: 'ERR-PI' },
    launch: { launched: true },
    open: { path: '/workspace/chosen' },
    recentOpen: { path: '/workspace/recent' },
    recents: [{ name: 'Recent', path: '/workspace/recent' }],
    reveal: { revealed: true },
    status: { activeCount: 1, canOpenNew: true, maxInstances: 2, workspaceOpenElsewhere: false },
  }
  const dependencies = {
    applicationExecutable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    applicationIsPackaged: true,
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    chooseAndOpenWorkspace: () => { calls.push(['choose-and-open']); return results.open },
    getActiveWorkspaceError: () => { calls.push(['get-active-error']); return results.activeError },
    getActiveWorkspaceIncident: () => { calls.push(['get-active-incident']); return results.activeIncident },
    getActiveWorkspacePath: () => { calls.push(['get-active-path']); return '/workspace/current' },
    getApplicationPath: () => { calls.push(['get-app-path']); return '/Applications/VincodeLab.app' },
    instanceRegistry: {
      status(workspacePath) {
        calls.push(['instance-status', workspacePath])
        return results.status
      },
    },
    isDirectory: (workspacePath) => { calls.push(['is-directory', workspacePath]); return true },
    isLaunchInProgress: () => { calls.push(['get-launch-in-progress']); return launchInProgress },
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
    listRecentWorkspaces: () => { calls.push(['list-recent']); return results.recents },
    log: (...args) => { calls.push(['log', ...args]) },
    openPath: (workspacePath) => { calls.push(['open-path', workspacePath]); return Promise.resolve('') },
    openWorkspace: (workspacePath) => { calls.push(['open-workspace', workspacePath]); return results.recentOpen },
    requireActiveWorkspace: () => { calls.push(['require-workspace']); return '/workspace/current' },
    revealWorkspace: (workspacePath, options) => {
      calls.push(['reveal-workspace', workspacePath])
      revealOptions.push(options)
      return results.reveal
    },
    scheduleTimeout: (callback, delay) => {
      calls.push(['schedule-timeout', delay])
      const timer = { callback, delay, unref: () => { calls.push(['timer-unref']); return timer } }
      scheduled.push(timer)
      return timer
    },
    setLaunchInProgress: (value) => { calls.push(['set-launch-in-progress', value]); launchInProgress = value },
    showErrorBox: (title, message) => { calls.push(['show-error-box', title, message]) },
    toPublicErrorMessage: (error, options) => {
      calls.push(['to-public-error', error, options])
      return `Messaggio ${options.code}`
    },
    ...overrides,
  }
  delete dependencies.launchInProgress
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return {
    calls,
    dependencies,
    getLaunchInProgress: () => launchInProgress,
    ipcMain,
    launchOptions,
    registrations,
    results,
    revealOptions,
    scheduled,
  }
}

test('registra una sola volta il manifesto completo dei 7 canali IPC Workspace', () => {
  const fixture = workspaceFixture()
  const registration = registerWorkspaceIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(WORKSPACE_INVOKE_CHANNELS, [
    'workspace:open',
    'workspace:getActive',
    'workspace:instanceStatus',
    'workspace:openInNewInstance',
    'workspace:listRecent',
    'workspace:reveal',
    'workspace:openRecent',
  ])
  assert.deepEqual(registration.channels, WORKSPACE_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], WORKSPACE_INVOKE_CHANNELS)
  assert.equal(Object.isFrozen(WORKSPACE_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(registration), true)
})

test('ogni handler verifica il sender prima di dialog, stato, filesystem e servizi', async () => {
  const rejection = new Error('sender non attendibile')
  const argumentsByChannel = new Map([
    ['workspace:open', []],
    ['workspace:getActive', []],
    ['workspace:instanceStatus', ['/workspace/current']],
    ['workspace:openInNewInstance', ['/workspace/current']],
    ['workspace:listRecent', []],
    ['workspace:reveal', []],
    ['workspace:openRecent', ['/workspace/recent']],
  ])

  for (const [channel, args] of argumentsByChannel) {
    const fixture = workspaceFixture({ assertTrustedSender: (event) => {
      fixture.calls.push(['guard', event])
      throw rejection
    } })
    const event = { sender: { id: 7 } }
    const handler = createWorkspaceHandlers(fixture.dependencies).get(channel)
    const invoke = () => handler(event, ...args)
    if (channel === 'workspace:openInNewInstance') await assert.rejects(invoke, (error) => error === rejection)
    else assert.throws(invoke, (error) => error === rejection)
    assert.deepEqual(fixture.calls, [['guard', event]], channel)
  }
})

test('open delega al flusso dialog/openWorkspace e propaga risultato o annullamento', async () => {
  const fixture = workspaceFixture()
  const event = { sender: { id: 11 } }
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:open')

  assert.equal(handler(event), fixture.results.open)
  assert.deepEqual(fixture.calls, [['guard', event], ['choose-and-open']])

  const cancelledFixture = workspaceFixture({ chooseAndOpenWorkspace: async () => null })
  const cancelledHandler = createWorkspaceHandlers(cancelledFixture.dependencies).get('workspace:open')
  assert.equal(await cancelledHandler(event), null)
})

test('getActive restituisce null senza workspace o il DTO completo con recovery AI', () => {
  const event = { sender: { id: 13 } }
  const emptyFixture = workspaceFixture({ getActiveWorkspacePath: () => {
    emptyFixture.calls.push(['get-active-path'])
    return undefined
  } })
  const emptyHandler = createWorkspaceHandlers(emptyFixture.dependencies).get('workspace:getActive')
  assert.equal(emptyHandler(event), null)
  assert.deepEqual(emptyFixture.calls, [['guard', event], ['get-active-path']])

  const fixture = workspaceFixture()
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:getActive')
  assert.deepEqual(handler(event), {
    path: '/workspace/current',
    error: fixture.results.activeError,
    errorIncident: fixture.results.activeIncident,
  })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['get-active-path'],
    ['get-active-error'],
    ['get-active-incident'],
  ])
})

test('instanceStatus valida il path e conserva il DTO base del registry', () => {
  const event = { sender: { id: 17 } }
  for (const workspacePath of [null, 7, 'relative/path', `/${'x'.repeat(4_096)}`]) {
    const fixture = workspaceFixture()
    const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:instanceStatus')
    assert.deepEqual(handler(event, workspacePath), {
      ...fixture.results.status,
      canOpenNew: false,
      workspaceOpenElsewhere: false,
      reason: 'invalid-path',
    })
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['instance-status', undefined],
    ])
  }

  for (const workspacePath of [undefined, '/workspace/current']) {
    const fixture = workspaceFixture()
    const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:instanceStatus')
    assert.equal(handler(event, workspacePath), fixture.results.status)
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['instance-status', workspacePath],
    ])
  }
})

test('openInNewInstance rifiuta una seconda apertura mentre il launch flag è attivo', async () => {
  const fixture = workspaceFixture({ launchInProgress: true })
  const event = { sender: { id: 19 } }
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')

  assert.deepEqual(await handler(event, '/workspace/current'), {
    launched: false,
    reason: 'limit',
    message: 'Apertura di una nuova finestra già in corso.',
  })
  assert.deepEqual(fixture.calls, [['guard', event], ['get-launch-in-progress']])
})

test('openInNewInstance distingue path invalido e directory non disponibile prima del registry', async () => {
  const event = { sender: { id: 23 } }
  for (const workspacePath of [undefined, null, 'relative/path', `/${'x'.repeat(4_096)}`]) {
    const fixture = workspaceFixture()
    const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')
    assert.deepEqual(await handler(event, workspacePath), {
      launched: false,
      reason: 'invalid-path',
      message: 'La cartella selezionata non è disponibile.',
    })
    assert.deepEqual(fixture.calls, [['guard', event], ['get-launch-in-progress']])
  }

  const missingFixture = workspaceFixture({ isDirectory: (workspacePath) => {
    missingFixture.calls.push(['is-directory', workspacePath])
    return false
  } })
  const missingHandler = createWorkspaceHandlers(missingFixture.dependencies).get('workspace:openInNewInstance')
  assert.deepEqual(await missingHandler(event, '/workspace/missing'), {
    launched: false,
    reason: 'invalid-path',
    message: 'La cartella selezionata non è disponibile.',
  })
  assert.deepEqual(missingFixture.calls, [
    ['guard', event],
    ['get-launch-in-progress'],
    ['is-directory', '/workspace/missing'],
  ])
})

test('openInNewInstance rende distinti limite globale e workspace duplicato', async () => {
  const event = { sender: { id: 29 } }
  const cases = [
    [{ activeCount: 1, canOpenNew: false, maxInstances: 2, workspaceOpenElsewhere: true }, 'duplicate', 'Questo workspace è già aperto in un’altra finestra.'],
    [{ activeCount: 2, canOpenNew: false, maxInstances: 2, workspaceOpenElsewhere: false }, 'limit', 'Puoi usare al massimo due finestre contemporaneamente.'],
  ]

  for (const [status, reason, message] of cases) {
    const fixture = workspaceFixture({ instanceRegistry: { status: (workspacePath) => {
      fixture.calls.push(['instance-status', workspacePath])
      return status
    } } })
    const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')
    assert.deepEqual(await handler(event, '/workspace/current'), { launched: false, reason, message })
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['get-launch-in-progress'],
      ['is-directory', '/workspace/current'],
      ['instance-status', '/workspace/current'],
    ])
  }
})

test('openInNewInstance lancia con i dati applicativi e rilascia il flag dopo due secondi', async () => {
  const fixture = workspaceFixture()
  const event = { sender: { id: 31 } }
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')

  assert.equal(await handler(event, '/workspace/current'), fixture.results.launch)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['get-launch-in-progress'],
    ['is-directory', '/workspace/current'],
    ['instance-status', '/workspace/current'],
    ['set-launch-in-progress', true],
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
  assert.equal(fixture.getLaunchInProgress(), true)
  assert.equal(fixture.scheduled.length, 1)
  fixture.scheduled[0].callback()
  assert.equal(fixture.getLaunchInProgress(), false)
  assert.deepEqual(fixture.calls.at(-1), ['set-launch-in-progress', false])

  const processError = new Error('child terminated')
  fixture.launchOptions[0].onPostLaunchError(processError)
  assert.deepEqual(fixture.calls.slice(-3), [
    ['log', 'error', 'workspace_instance_process_error'],
    ['to-public-error', processError, { code: 'WORKSPACE_INSTANCE_PROCESS_FAILED', message: 'La nuova finestra non è rimasta disponibile.' }],
    ['show-error-box', 'Nuova finestra terminata', 'Messaggio WORKSPACE_INSTANCE_PROCESS_FAILED'],
  ])
})

test('openInNewInstance trasforma il failure iniziale e pianifica comunque il rilascio', async () => {
  const failure = new Error('spawn failed')
  const fixture = workspaceFixture({ launchWorkspaceInstance: async (options) => {
    fixture.launchOptions.push(options)
    fixture.calls.push(['launch-instance-failed'])
    throw failure
  } })
  const event = { sender: { id: 37 } }
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')

  assert.deepEqual(await handler(event, '/workspace/current'), {
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
  assert.equal(fixture.getLaunchInProgress(), true)
  fixture.scheduled[0].callback()
  assert.equal(fixture.getLaunchInProgress(), false)
})

test('recenti e reveal mantengono guardia, workspace e adapter shell', async () => {
  const fixture = workspaceFixture()
  const handlers = createWorkspaceHandlers(fixture.dependencies)
  const event = { sender: { id: 41 } }

  assert.equal(handlers.get('workspace:listRecent')(event), fixture.results.recents)
  assert.equal(handlers.get('workspace:reveal')(event), fixture.results.reveal)
  assert.equal(handlers.get('workspace:openRecent')(event, '/workspace/recent'), fixture.results.recentOpen)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['list-recent'],
    ['guard', event],
    ['require-workspace'],
    ['reveal-workspace', '/workspace/current'],
    ['guard', event],
    ['open-workspace', '/workspace/recent'],
  ])
  assert.equal(fixture.revealOptions.length, 1)
  assert.equal(await fixture.revealOptions[0].openPath('/workspace/current'), '')
  assert.deepEqual(fixture.calls.at(-1), ['open-path', '/workspace/current'])
})
