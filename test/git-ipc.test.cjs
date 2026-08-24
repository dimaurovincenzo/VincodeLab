const assert = require('node:assert/strict')
const test = require('node:test')

const {
  GIT_INVOKE_CHANNELS,
  createGitHandlers,
  registerGitIpc,
} = require('../electron/ipc/domains/git.ipc.cjs')

function dependencies(overrides = {}) {
  return {
    addGitHubRemote: () => undefined,
    assertCacheReadOptions: (options) => ({ force: options?.force === true }),
    assertTrustedSender() {},
    commit: () => undefined,
    createBranch: () => undefined,
    fetchRemote: () => undefined,
    getCachedGitStatus: () => undefined,
    getFileDiff: () => undefined,
    initializeGitRepository: () => undefined,
    listBranches: () => undefined,
    pullRebase: () => undefined,
    push: () => undefined,
    revertCommit: () => undefined,
    runLatestGithubRead: (_event, _type, load) => load('/workspace', new AbortController().signal),
    runWorkspaceMutation: (_event, _type, mutation) => mutation('/workspace'),
    stageFiles: () => undefined,
    switchBranch: () => undefined,
    unstageFiles: () => undefined,
    ...overrides,
  }
}

test('il manifesto Git registra soltanto i quattordici canali locali esistenti', () => {
  const registrations = new Map()
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }

  const registration = registerGitIpc({ ipcMain, ...dependencies() })

  assert.deepEqual(GIT_INVOKE_CHANNELS, [
    'github:gitStatus',
    'github:initRepository',
    'github:addRemote',
    'github:stage',
    'github:unstage',
    'github:commit',
    'github:push',
    'github:fetch',
    'github:pullRebase',
    'github:branches',
    'github:switchBranch',
    'github:createBranch',
    'github:fileDiff',
    'github:revert',
  ])
  assert.deepEqual([...registrations.keys()], GIT_INVOKE_CHANNELS)
  assert.deepEqual(registration.channels, GIT_INVOKE_CHANNELS)
  assert.equal(Object.isFrozen(GIT_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(registration), true)
  assert.equal(GIT_INVOKE_CHANNELS.some((channel) => channel === 'github:createRepository'), false)
})

test('le letture Git preservano guardie, cache options, latest-read e AbortSignal', () => {
  const calls = []
  const event = { sender: { id: 31 } }
  const signal = new AbortController().signal
  const status = { status: 'fresh' }
  const branches = ['main', 'release']
  const diff = { path: 'src/App.tsx' }
  const handlers = createGitHandlers(dependencies({
    assertTrustedSender: (receivedEvent) => calls.push(['guard', receivedEvent]),
    assertCacheReadOptions: (options) => {
      calls.push(['cache-options', options])
      return { force: true }
    },
    runLatestGithubRead: (receivedEvent, type, load) => {
      calls.push(['latest-read', receivedEvent, type])
      return load('/workspace', signal)
    },
    getCachedGitStatus: (workspacePath, options) => {
      calls.push(['status', workspacePath, options])
      return status
    },
    listBranches: (workspacePath, options) => {
      calls.push(['branches', workspacePath, options])
      return branches
    },
    getFileDiff: (workspacePath, filePath, options) => {
      calls.push(['diff', workspacePath, filePath, options])
      return diff
    },
  }))
  const options = { force: true }

  assert.equal(handlers.get('github:gitStatus')(event, options), status)
  assert.equal(handlers.get('github:branches')(event), branches)
  assert.equal(handlers.get('github:fileDiff')(event, 'src/App.tsx'), diff)
  assert.deepEqual(calls, [
    ['guard', event],
    ['cache-options', options],
    ['latest-read', event, 'git-status'],
    ['status', '/workspace', { force: true, signal }],
    ['guard', event],
    ['latest-read', event, 'branches'],
    ['branches', '/workspace', { signal }],
    ['guard', event],
    ['latest-read', event, 'file-diff'],
    ['diff', '/workspace', 'src/App.tsx', { signal }],
  ])
})

test('le undici mutazioni Git conservano registry, operation type, argomenti e risultati', () => {
  const registryCalls = []
  const serviceCalls = []
  const event = { sender: { id: 37 } }
  const results = Object.fromEntries([
    'init', 'remote', 'stage', 'unstage', 'commit', 'push', 'fetch', 'pull', 'switch', 'create', 'revert',
  ].map((name) => [name, { name }]))
  const record = (name, result) => (...args) => {
    serviceCalls.push([name, ...args])
    return result
  }
  const handlers = createGitHandlers(dependencies({
    initializeGitRepository: record('init', results.init),
    addGitHubRemote: record('remote', results.remote),
    stageFiles: record('stage', results.stage),
    unstageFiles: record('unstage', results.unstage),
    commit: record('commit', results.commit),
    push: record('push', results.push),
    fetchRemote: record('fetch', results.fetch),
    pullRebase: record('pull', results.pull),
    switchBranch: record('switch', results.switch),
    createBranch: record('create', results.create),
    revertCommit: record('revert', results.revert),
    runWorkspaceMutation(receivedEvent, type, mutation) {
      registryCalls.push([receivedEvent, type])
      return mutation('/workspace')
    },
  }))

  assert.equal(handlers.get('github:initRepository')(event), results.init)
  assert.equal(handlers.get('github:addRemote')(event, 'git@example.test:owner/repo.git'), results.remote)
  assert.equal(handlers.get('github:stage')(event, ['a.ts', 'b.ts']), results.stage)
  assert.equal(handlers.get('github:unstage')(event, ['a.ts']), results.unstage)
  assert.equal(handlers.get('github:commit')(event, 'refactor: modularizza git'), results.commit)
  assert.equal(handlers.get('github:push')(event), results.push)
  assert.equal(handlers.get('github:fetch')(event), results.fetch)
  assert.equal(handlers.get('github:pullRebase')(event), results.pull)
  assert.equal(handlers.get('github:switchBranch')(event, 'release'), results.switch)
  assert.equal(handlers.get('github:createBranch')(event, 'feature/ipc'), results.create)
  assert.equal(handlers.get('github:revert')(event, 'abc123'), results.revert)

  assert.deepEqual(registryCalls, [
    [event, 'github:init-repository'],
    [event, 'github:add-remote'],
    [event, 'github:stage'],
    [event, 'github:unstage'],
    [event, 'github:commit'],
    [event, 'github:push'],
    [event, 'github:fetch'],
    [event, 'github:pull-rebase'],
    [event, 'github:switch-branch'],
    [event, 'github:create-branch'],
    [event, 'github:revert'],
  ])
  assert.deepEqual(serviceCalls, [
    ['init', '/workspace'],
    ['remote', '/workspace', 'git@example.test:owner/repo.git'],
    ['stage', '/workspace', ['a.ts', 'b.ts']],
    ['unstage', '/workspace', ['a.ts']],
    ['commit', '/workspace', 'refactor: modularizza git'],
    ['push', '/workspace'],
    ['fetch', '/workspace'],
    ['pull', '/workspace'],
    ['switch', '/workspace', 'release'],
    ['create', '/workspace', 'feature/ipc'],
    ['revert', '/workspace', 'abc123'],
  ])
})

test('runWorkspaceMutation resta owner di guardia, workspace e serializzazione', () => {
  const calls = []
  const event = { sender: { id: 41 } }
  const handlers = createGitHandlers(dependencies({
    assertTrustedSender: () => calls.push('direct-guard'),
    runWorkspaceMutation(receivedEvent, type, mutation) {
      calls.push(['workspace-registry', receivedEvent, type, typeof mutation])
      return 'queued'
    },
    stageFiles: () => calls.push('stage-service'),
  }))

  assert.equal(handlers.get('github:stage')(event, ['a.ts']), 'queued')
  assert.deepEqual(calls, [['workspace-registry', event, 'github:stage', 'function']])
})

test('gli errori di guardia, validazione, latest-read, servizio e registry propagano invariati', async () => {
  const guardError = new Error('untrusted sender')
  let optionsCalled = false
  const guardedHandlers = createGitHandlers(dependencies({
    assertTrustedSender() { throw guardError },
    assertCacheReadOptions() { optionsCalled = true },
  }))
  assert.throws(
    () => guardedHandlers.get('github:gitStatus')({}, { force: true }),
    (error) => error === guardError,
  )
  assert.equal(optionsCalled, false)

  const optionsError = new Error('invalid cache options')
  const optionsHandlers = createGitHandlers(dependencies({
    assertCacheReadOptions() { throw optionsError },
  }))
  assert.throws(
    () => optionsHandlers.get('github:gitStatus')({}, { force: 'yes' }),
    (error) => error === optionsError,
  )

  const latestReadError = new Error('read cancelled')
  const latestReadHandlers = createGitHandlers(dependencies({
    runLatestGithubRead() { throw latestReadError },
  }))
  assert.throws(
    () => latestReadHandlers.get('github:branches')({}),
    (error) => error === latestReadError,
  )

  const serviceError = new Error('diff failed')
  const serviceHandlers = createGitHandlers(dependencies({
    getFileDiff: async () => { throw serviceError },
  }))
  await assert.rejects(
    serviceHandlers.get('github:fileDiff')({}, 'src/App.tsx'),
    (error) => error === serviceError,
  )

  const registryError = new Error('mutation already running')
  let mutationCalled = false
  const registryHandlers = createGitHandlers(dependencies({
    runWorkspaceMutation() { throw registryError },
    commit() { mutationCalled = true },
  }))
  assert.throws(
    () => registryHandlers.get('github:commit')({}, 'message'),
    (error) => error === registryError,
  )
  assert.equal(mutationCalled, false)

  const mutationError = new Error('commit failed')
  const mutationHandlers = createGitHandlers(dependencies({
    runWorkspaceMutation: (_event, _type, mutation) => mutation('/workspace'),
    commit: async () => { throw mutationError },
  }))
  await assert.rejects(
    mutationHandlers.get('github:commit')({}, 'message'),
    (error) => error === mutationError,
  )
})
