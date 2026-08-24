const assert = require('node:assert/strict')
const test = require('node:test')

const {
  GITHUB_INVOKE_CHANNELS,
  createGithubHandlers,
  registerGithubIpc,
} = require('../electron/ipc/domains/github.ipc.cjs')

const SERVICE_DEPENDENCIES = [
  'addWorkspaceIssueToProject',
  'archiveWorkspaceProjectItem',
  'closeWorkspaceProject',
  'createGitHubRepository',
  'createIssue',
  'createWorkspaceProject',
  'createWorkspaceProjectDraft',
  'editWorkspaceProject',
  'getCachedGitHubData',
  'getCachedProjectBoard',
  'getWorkspaceProjectItemFields',
  'updateIssue',
  'updateWorkspaceProjectItem',
]

function githubFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const signal = new AbortController().signal
  const workspacePath = '/workspace/current'
  const dependencies = {
    assertCacheReadOptions: (options) => {
      calls.push(['cache-options', options])
      return { force: options?.force === true }
    },
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
  }
  for (const name of SERVICE_DEPENDENCIES) {
    dependencies[name] = (...args) => {
      calls.push(['service', name, ...args])
      return { name }
    }
  }
  dependencies.runLatestGithubRead = async (event, type, load) => {
    calls.push(['latest', event, type])
    return load(workspacePath, signal)
  }
  dependencies.runWorkspaceMutation = (event, type, operation) => {
    dependencies.assertTrustedSender(event)
    calls.push(['mutation', event, type])
    return Promise.resolve().then(() => operation(workspacePath))
  }
  Object.assign(dependencies, overrides)

  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, signal, workspacePath }
}

test('registra una sola volta il manifesto completo GitHub', () => {
  const fixture = githubFixture()
  const registration = registerGithubIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.equal(GITHUB_INVOKE_CHANNELS.length, 13)
  assert.deepEqual(registration.channels, GITHUB_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], GITHUB_INVOKE_CHANNELS)
  assert.equal(new Set(GITHUB_INVOKE_CHANNELS).size, GITHUB_INVOKE_CHANNELS.length)
})

test('le tre letture conservano guardia, latest-wins, cache options e AbortSignal', async () => {
  const fixture = githubFixture()
  const handlers = createGithubHandlers(fixture.dependencies)
  const event = { sender: { id: 42 } }
  const forced = { force: true }
  const cases = [
    {
      args: [undefined],
      cache: undefined,
      channel: 'github:data',
      service: 'getCachedGitHubData',
      serviceArgs: [fixture.workspacePath, { force: false, signal: fixture.signal }],
      type: 'data',
    },
    {
      args: [17, forced],
      cache: forced,
      channel: 'github:projectBoard',
      service: 'getCachedProjectBoard',
      serviceArgs: [fixture.workspacePath, 17, { force: true, signal: fixture.signal }],
      type: 'project-board',
    },
    {
      args: [17, 'item-1'],
      channel: 'github:projectItemFields',
      service: 'getWorkspaceProjectItemFields',
      serviceArgs: [fixture.workspacePath, 17, 'item-1', { signal: fixture.signal }],
      type: 'project-fields',
    },
  ]

  for (const entry of cases) {
    fixture.calls.length = 0
    const result = await handlers.get(entry.channel)(event, ...entry.args)
    const expectedCalls = [['guard', event]]
    if (Object.hasOwn(entry, 'cache')) expectedCalls.push(['cache-options', entry.cache])
    expectedCalls.push(
      ['latest', event, entry.type],
      ['service', entry.service, ...entry.serviceArgs],
    )
    assert.deepEqual(fixture.calls, expectedCalls, entry.channel)
    assert.deepEqual(result, { name: entry.service }, entry.channel)
  }
})

test('le dieci mutazioni conservano tipo, argomenti e workspace del registry', async () => {
  const fixture = githubFixture()
  const handlers = createGithubHandlers(fixture.dependencies)
  const event = { sender: { id: 7 } }
  const update = { kind: 'singleSelect', optionId: 'option-1' }
  const cases = [
    ['github:createRepository', ['repo', 'private'], 'github:create-repository', 'createGitHubRepository', ['repo', 'private']],
    ['github:createIssue', ['Titolo', 'Corpo'], 'github:create-issue', 'createIssue', ['Titolo', 'Corpo']],
    ['github:updateIssue', [5, 'Titolo', 'Corpo', 'CLOSED'], 'github:update-issue', 'updateIssue', [5, 'Titolo', 'Corpo', 'CLOSED']],
    ['github:createProject', ['Roadmap'], 'github:create-project', 'createWorkspaceProject', ['Roadmap']],
    ['github:editProject', [3, 'Roadmap', 'Descrizione'], 'github:edit-project', 'editWorkspaceProject', [3, 'Roadmap', 'Descrizione']],
    ['github:closeProject', [3, true], 'github:close-project', 'closeWorkspaceProject', [3, true]],
    ['github:addIssueToProject', [3, 'https://github.test/issues/5'], 'github:add-issue-to-project', 'addWorkspaceIssueToProject', [3, 'https://github.test/issues/5']],
    ['github:updateProjectItem', [3, 'item-1', 'field-1', update], 'github:update-project-item', 'updateWorkspaceProjectItem', [3, 'item-1', 'field-1', update]],
    ['github:createProjectDraft', [3, 'Bozza', 'Corpo'], 'github:create-project-draft', 'createWorkspaceProjectDraft', [3, 'Bozza', 'Corpo']],
    ['github:archiveProjectItem', [3, 'item-1', false], 'github:archive-project-item', 'archiveWorkspaceProjectItem', [3, 'item-1', false]],
  ]

  assert.equal(cases.length, 10)
  for (const [channel, args, type, service, serviceArgs] of cases) {
    fixture.calls.length = 0
    const result = await handlers.get(channel)(event, ...args)
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['mutation', event, type],
      ['service', service, fixture.workspacePath, ...serviceArgs],
    ], channel)
    assert.deepEqual(result, { name: service }, channel)
  }
})

test('un errore cache ferma la lettura dopo la guardia e attraversa invariato la boundary', () => {
  const expected = new Error('cache options failed')
  const fixture = githubFixture({ assertCacheReadOptions: () => { throw expected } })
  const handler = createGithubHandlers(fixture.dependencies).get('github:data')
  const event = { sender: { id: 1 } }

  assert.throws(() => handler(event, { force: 'yes' }), (error) => error === expected)
  assert.deepEqual(fixture.calls, [['guard', event]])
})

test('propaga senza trasformazioni errori latest-wins, servizi e mutation registry', async () => {
  const latestError = new Error('latest failed')
  const serviceError = new Error('create issue failed')
  const mutationError = new Error('mutation failed')

  const latestFixture = githubFixture({ runLatestGithubRead: async () => { throw latestError } })
  const latestHandler = createGithubHandlers(latestFixture.dependencies).get('github:projectItemFields')
  await assert.rejects(latestHandler({ sender: { id: 2 } }), (error) => error === latestError)

  const serviceFixture = githubFixture({ createIssue: async () => { throw serviceError } })
  const createIssueHandler = createGithubHandlers(serviceFixture.dependencies).get('github:createIssue')
  await assert.rejects(createIssueHandler({ sender: { id: 3 } }, 'Titolo', 'Corpo'), (error) => error === serviceError)

  const mutationFixture = githubFixture({ runWorkspaceMutation: () => { throw mutationError } })
  const mutationHandler = createGithubHandlers(mutationFixture.dependencies).get('github:createProject')
  assert.throws(() => mutationHandler({ sender: { id: 4 } }, 'Roadmap'), (error) => error === mutationError)
})
