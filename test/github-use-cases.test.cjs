const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const { createGithubUseCases } = require('../electron/domains/github/github-use-cases.cjs')

const publicMethods = [
  'addGitHubRemote',
  'addWorkspaceIssueToProject',
  'archiveWorkspaceProjectItem',
  'closeWorkspaceProject',
  'commit',
  'createBranch',
  'createGitHubRepository',
  'createIssue',
  'createWorkspaceProject',
  'createWorkspaceProjectDraft',
  'editWorkspaceProject',
  'fetchRemote',
  'getCachedGitHubData',
  'getCachedGitStatus',
  'getCachedProjectBoard',
  'getFileDiff',
  'getGitHubData',
  'getGitStatus',
  'getLinkedProjectBoard',
  'getWorkspaceProjectItemFields',
  'githubAccessDiagnostic',
  'githubProjectsDiagnostic',
  'githubUnavailableData',
  'initializeGitRepository',
  'isGitRepository',
  'listBranches',
  'pullRebase',
  'push',
  'revertCommit',
  'stageFiles',
  'switchBranch',
  'unstageFiles',
  'updateIssue',
  'updateWorkspaceProjectItem',
]

function fixture() {
  const invalidated = []
  const projectCalls = []
  const noop = async () => ({})
  const cache = {
    CACHE_TTL: { gitStatus: 1, gitGraph: 1, githubData: 1, projectBoard: 1 },
    getCachedResource: noop,
    invalidateGitCache: () => undefined,
    invalidateGitHubDataCache: (workspacePath) => invalidated.push(workspacePath),
    invalidateProjectMutationCache: () => undefined,
    projectBoardCacheKey: (projectNumber) => `project:${projectNumber}`,
  }
  const projects = {
    addIssueToProject: noop,
    archiveProjectItem: noop,
    closeLinkedProject: noop,
    createLinkedProject: async (_run, workspacePath, repository, title) => {
      projectCalls.push({ repository, title, workspacePath })
      return { number: 7, title }
    },
    createProjectDraft: noop,
    editLinkedProject: noop,
    getProjectBoard: noop,
    getProjectItemFields: noop,
    listLinkedProjectsPage: async () => ({ projects: [], hasMore: false }),
    updateProjectItem: noop,
  }
  const runner = {
    COMMAND_OPTIONS: { maxBuffer: 1024 },
    run: async (command, args) => {
      if (command === 'gh' && args[0] === 'repo' && args[1] === 'view') {
        return JSON.stringify({ nameWithOwner: 'acme/demo', url: 'https://github.com/acme/demo', owner: { login: 'acme' } })
      }
      return ''
    },
    runBoundedDiff: noop,
    runStreaming: async () => ({ output: '', truncated: false }),
  }
  return { cache, invalidated, projectCalls, projects, runner }
}

test('la factory GitHub conserva la superficie pubblica senza esporre i collaboratori interni', () => {
  const dependencies = fixture()
  const useCases = createGithubUseCases(dependencies)

  assert.deepEqual(Object.keys(useCases).sort(), [...publicMethods].sort())
  assert.equal(Object.values(useCases).every((value) => typeof value === 'function'), true)
  assert.equal('getRepository' in useCases, false)
  assert.equal('runWithSignal' in useCases, false)
})

test('i dati GitHub usano un’identità cache stabile del dominio senza dipendere dal registro IPC', () => {
  const dependencies = fixture()
  const cacheCalls = []
  const cachedResult = Object.freeze({ data: { issues: [] } })
  dependencies.cache.CACHE_TTL.githubData = 60_000
  dependencies.cache.getCachedResource = (workspacePath, resourceKey, ttlMs, load, options) => {
    cacheCalls.push({ load, options, resourceKey, ttlMs, workspacePath })
    return cachedResult
  }
  const useCases = createGithubUseCases(dependencies)
  const firstOptions = Object.freeze({ force: true, now: 1_000 })
  const secondOptions = Object.freeze({ now: 2_000 })

  assert.equal(useCases.getCachedGitHubData('/workspace/a', firstOptions), cachedResult)
  assert.equal(useCases.getCachedGitHubData('/workspace/b', secondOptions), cachedResult)
  assert.deepEqual(cacheCalls.map(({ options, resourceKey, ttlMs, workspacePath }) => ({ options, resourceKey, ttlMs, workspacePath })), [
    { options: firstOptions, resourceKey: 'github-data-snapshot', ttlMs: 60_000, workspacePath: '/workspace/a' },
    { options: secondOptions, resourceKey: 'github-data-snapshot', ttlMs: 60_000, workspacePath: '/workspace/b' },
  ])
  assert.equal(cacheCalls.every(({ load }) => typeof load === 'function'), true)

  const issueUseCasesPath = require.resolve('../electron/domains/github/github-issue-use-cases.cjs')
  const issueUseCasesModule = require.cache[issueUseCasesPath]
  assert.ok(issueUseCasesModule)
  assert.equal(issueUseCasesModule.children.some(({ filename }) => filename.endsWith('/electron/ipc/channels.cjs')), false)
  assert.doesNotMatch(fs.readFileSync(issueUseCasesPath, 'utf8'), /ipc\/channels|IPC_CHANNELS/u)
  assert.deepEqual(Object.keys(issueUseCasesModule.exports), ['createGitHubIssueUseCases'])
})

test('la composizione mantiene operativi Git locale, diagnostica GitHub e mutazioni Project', async () => {
  const dependencies = fixture()
  const useCases = createGithubUseCases(dependencies)

  assert.equal(await useCases.isGitRepository('/workspace', { runCommand: async () => 'true' }), true)
  assert.equal(useCases.githubUnavailableData({ code: 'GITHUB_CLI_NOT_FOUND' }).githubDiagnostic, 'GitHub CLI non è disponibile. Installala o configurala e riprova.')
  assert.deepEqual(await useCases.createWorkspaceProject('/workspace', 'Roadmap'), { number: 7, title: 'Roadmap' })
  assert.deepEqual(dependencies.projectCalls, [{ repository: { nameWithOwner: 'acme/demo', url: 'https://github.com/acme/demo', owner: 'acme' }, title: 'Roadmap', workspacePath: '/workspace' }])
  assert.deepEqual(dependencies.invalidated, ['/workspace'])
})
