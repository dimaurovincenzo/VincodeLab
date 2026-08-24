const assert = require('node:assert/strict')
const test = require('node:test')

const {
  UPDATES_INVOKE_CHANNELS,
  createUpdatesHandlers,
  registerUpdatesIpc,
} = require('../electron/ipc/domains/updates.ipc.cjs')

function dependencies(overrides = {}) {
  return {
    activatePendingUpdates: () => 'activated',
    assertTrustedSender() {},
    checkUpdates: () => 'checked',
    downloadAllUpdates: () => 'downloaded-all',
    listManagedUpdates: () => 'listed',
    rollbackManagedUpdate: () => 'rolled-back',
    runExternalMutation: (_event, _operation, _workspacePath, mutation) => mutation(),
    setManagedUpdatePolicy: () => 'policy-set',
    stageManagedUpdate: () => 'downloaded',
    ...overrides,
  }
}

test('il manifesto Updates registra una sola volta tutti e sette i canali', () => {
  const registrations = new Map()
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }

  const registration = registerUpdatesIpc({ ipcMain, ...dependencies() })

  assert.deepEqual(UPDATES_INVOKE_CHANNELS, [
    'updates:list',
    'updates:check',
    'updates:download',
    'updates:downloadAll',
    'updates:setPolicy',
    'updates:rollback',
    'updates:activatePending',
  ])
  assert.deepEqual([...registrations.keys()], UPDATES_INVOKE_CHANNELS)
  assert.deepEqual(registration.channels, UPDATES_INVOKE_CHANNELS)
  assert.equal(Object.isFrozen(UPDATES_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(registration), true)
  for (const handler of registrations.values()) assert.equal(typeof handler, 'function')
})

test('list check e setPolicy preservano guardie, risultati e argomenti', () => {
  const calls = []
  const event = { sender: { id: 17 } }
  const handlers = createUpdatesHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    listManagedUpdates: (...args) => {
      calls.push(['list', ...args])
      return { items: [] }
    },
    checkUpdates: (...args) => {
      calls.push(['check', ...args])
      return { checked: args[0] }
    },
    setManagedUpdatePolicy: (...args) => {
      calls.push(['policy', ...args])
      return { id: args[0], policy: args[1] }
    },
  }))

  assert.deepEqual(handlers.get('updates:list')(event), { items: [] })
  assert.deepEqual(handlers.get('updates:check')(event, 'runtime-pi'), { checked: 'runtime-pi' })
  assert.deepEqual(handlers.get('updates:check')(event), { checked: null })
  assert.deepEqual(handlers.get('updates:setPolicy')(event, 'runtime-pi', 'manual'), {
    id: 'runtime-pi',
    policy: 'manual',
  })
  assert.deepEqual(calls, [
    ['guard', event],
    ['list'],
    ['guard', event],
    ['check', 'runtime-pi', { force: true }],
    ['guard', event],
    ['check', null, { force: true }],
    ['guard', event],
    ['policy', 'runtime-pi', 'manual'],
  ])
})

test('i quattro aggiornamenti mutativi conservano ownership, workspace nullo e callback', () => {
  const calls = []
  const event = { sender: { id: 21 } }
  const handlers = createUpdatesHandlers(dependencies({
    runExternalMutation(receivedEvent, operation, workspacePath, mutation) {
      calls.push(['mutation', receivedEvent, operation, workspacePath])
      return mutation()
    },
    stageManagedUpdate: (id) => {
      calls.push(['stage', id])
      return `staged:${id}`
    },
    downloadAllUpdates: () => {
      calls.push(['download-all'])
      return 'all-staged'
    },
    rollbackManagedUpdate: (id) => {
      calls.push(['rollback', id])
      return `rollback:${id}`
    },
    activatePendingUpdates: () => {
      calls.push(['activate'])
      return 'pending-activated'
    },
  }))

  assert.equal(handlers.get('updates:download')(event, 'runtime-pi'), 'staged:runtime-pi')
  assert.equal(handlers.get('updates:downloadAll')(event), 'all-staged')
  assert.equal(handlers.get('updates:rollback')(event, 'runtime-pi'), 'rollback:runtime-pi')
  assert.equal(handlers.get('updates:activatePending')(event), 'pending-activated')
  assert.deepEqual(calls, [
    ['mutation', event, 'updates:download', null],
    ['stage', 'runtime-pi'],
    ['mutation', event, 'updates:download-all', null],
    ['download-all'],
    ['mutation', event, 'updates:rollback', null],
    ['rollback', 'runtime-pi'],
    ['mutation', event, 'updates:activate', null],
    ['activate'],
  ])
})

test('runExternalMutation resta owner delle guardie dei canali mutativi', () => {
  const calls = []
  const event = { sender: { id: 25 } }
  const handlers = createUpdatesHandlers(dependencies({
    assertTrustedSender: () => calls.push('direct-guard'),
    runExternalMutation(receivedEvent, operation, workspacePath, mutation) {
      calls.push(['external-guard', receivedEvent, operation, workspacePath])
      assert.equal(typeof mutation, 'function')
      return 'guarded'
    },
    stageManagedUpdate: () => calls.push('stage'),
  }))

  assert.equal(handlers.get('updates:download')(event, 'runtime-pi'), 'guarded')
  assert.deepEqual(calls, [['external-guard', event, 'updates:download', null]])
})

test('gli errori sincroni e asincroni attraversano il registrar invariati', async () => {
  const guardError = new Error('untrusted sender')
  let listCalled = false
  const guardedHandlers = createUpdatesHandlers(dependencies({
    assertTrustedSender() { throw guardError },
    listManagedUpdates() { listCalled = true },
  }))
  assert.throws(() => guardedHandlers.get('updates:list')({}), (error) => error === guardError)
  assert.equal(listCalled, false)

  const serviceError = new Error('check failed')
  const directHandlers = createUpdatesHandlers(dependencies({
    checkUpdates() { throw serviceError },
  }))
  assert.throws(
    () => directHandlers.get('updates:check')({}, 'runtime-pi'),
    (error) => error === serviceError,
  )

  const mutationError = new Error('mutation rejected')
  const mutatingHandlers = createUpdatesHandlers(dependencies({
    runExternalMutation: (_event, _operation, _workspacePath, mutation) => mutation(),
    stageManagedUpdate: async () => { throw mutationError },
  }))
  await assert.rejects(
    mutatingHandlers.get('updates:download')({}, 'runtime-pi'),
    (error) => error === mutationError,
  )

  const boundaryError = new Error('mutation boundary failed')
  let mutationCalled = false
  const boundaryHandlers = createUpdatesHandlers(dependencies({
    runExternalMutation() { throw boundaryError },
    stageManagedUpdate() { mutationCalled = true },
  }))
  assert.throws(
    () => boundaryHandlers.get('updates:download')({}, 'runtime-pi'),
    (error) => error === boundaryError,
  )
  assert.equal(mutationCalled, false)
})
