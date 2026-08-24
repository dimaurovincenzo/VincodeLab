const assert = require('node:assert/strict')
const test = require('node:test')

const {
  WORKSPACE_INVOKE_CHANNELS,
  createWorkspaceHandlers,
  registerWorkspaceIpc,
} = require('../electron/ipc/domains/workspace.ipc.cjs')

function workspaceFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const revealOptions = []
  const results = {
    activeError: 'Pi non disponibile',
    activeIncident: { code: 'PI_NOT_INSTALLED', correlationId: 'ERR-PI' },
    instanceOpen: { launched: true },
    open: { path: '/workspace/chosen' },
    recentOpen: { path: '/workspace/recent' },
    recents: [{ name: 'Recent', path: '/workspace/recent' }],
    reveal: { revealed: true },
    status: { activeCount: 1, canOpenNew: true, maxInstances: 2, workspaceOpenElsewhere: false },
  }
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    chooseAndOpenWorkspace: () => { calls.push(['choose-and-open']); return results.open },
    getActiveWorkspaceError: () => { calls.push(['get-active-error']); return results.activeError },
    getActiveWorkspaceIncident: () => { calls.push(['get-active-incident']); return results.activeIncident },
    getActiveWorkspacePath: () => { calls.push(['get-active-path']); return '/workspace/current' },
    getWorkspaceInstanceStatus: (workspacePath) => { calls.push(['get-instance-status', workspacePath]); return results.status },
    listRecentWorkspaces: () => { calls.push(['list-recent']); return results.recents },
    openPath: (workspacePath) => { calls.push(['open-path', workspacePath]); return Promise.resolve('') },
    openWorkspace: (workspacePath) => { calls.push(['open-workspace', workspacePath]); return results.recentOpen },
    openWorkspaceInNewInstance: (workspacePath) => { calls.push(['open-in-new-instance', workspacePath]); return results.instanceOpen },
    requireActiveWorkspace: () => { calls.push(['require-workspace']); return '/workspace/current' },
    revealWorkspace: (workspacePath, options) => {
      calls.push(['reveal-workspace', workspacePath])
      revealOptions.push(options)
      return results.reveal
    },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return {
    calls,
    dependencies,
    ipcMain,
    registrations,
    results,
    revealOptions,
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

test('ogni handler verifica il sender prima di dialog, stato e servizi', async () => {
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

test('instanceStatus delega il path al caso d’uso dopo la guardia', () => {
  const event = { sender: { id: 17 } }
  const fixture = workspaceFixture()
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:instanceStatus')

  assert.equal(handler(event, '/workspace/current'), fixture.results.status)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['get-instance-status', '/workspace/current'],
  ])
})

test('openInNewInstance mantiene il contratto asincrono e delega al caso d’uso', async () => {
  const event = { sender: { id: 19 } }
  const fixture = workspaceFixture()
  const handler = createWorkspaceHandlers(fixture.dependencies).get('workspace:openInNewInstance')
  const operation = handler(event, '/workspace/current')

  assert.equal(operation instanceof Promise, true)
  assert.equal(await operation, fixture.results.instanceOpen)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['open-in-new-instance', '/workspace/current'],
  ])
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
