const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const defaultCacheDirectory = process.env.VINCODELAB_DATA_DIR === undefined
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-github-cache-'))
  : null
if (defaultCacheDirectory) process.env.VINCODELAB_DATA_DIR = defaultCacheDirectory
test.after(() => {
  closeDatabase()
  if (defaultCacheDirectory) {
    delete process.env.VINCODELAB_DATA_DIR
    fs.rmSync(defaultCacheDirectory, { recursive: true, force: true })
  }
})

const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
const { readCache, writeCache } = require('../electron/infrastructure/persistence/workspace-cache.repository.cjs')
const { getCachedResource, invalidateGitCache, invalidateGitHubDataCache, invalidateProjectBoardCache } = require('../electron/infrastructure/github/github-cache.adapter.cjs')
const {
  MAX_GIT_GRAPH_COMMITS,
  MAX_GIT_STATUS_FILES,
  MAX_GITHUB_ISSUES,
  assertBranchName,
  assertFilePaths,
  assertGitHubRemoteUrl,
  assertGitHubRepositoryName,
  chunkGitFilePaths,
  parseBranches,
  parseGraph,
  parseGraphPage,
  parseHistory,
  parseIssuesPage,
  parseStatus,
  parseStatusPage,
} = require('../electron/domains/github/github-model.cjs')
const { createGithubService } = require('./helpers/github-service.cjs')

const {
  addGitHubRemote,
  commit,
  getCachedGitStatus,
  getCachedProjectBoard,
  getFileDiff,
  getGitHubData,
  getGitStatus,
  getLinkedProjectBoard,
  githubAccessDiagnostic,
  githubProjectsDiagnostic,
  githubUnavailableData,
  initializeGitRepository,
  listBranches,
  push,
  stageFiles,
  unstageFiles,
} = createGithubService()

function withTemporaryCache(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-service-cache-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('restituisce cache valida e il refresh forzato ricarica la risorsa', async (t) => {
  withTemporaryCache(t)
  writeCache('/tmp/workspace', 'github:data', { issues: [{ number: 7 }] }, 60_000, 1_000)
  let loads = 0

  const cached = await getCachedResource('/tmp/workspace', 'github:data', 60_000, async () => {
    loads += 1
    return { issues: [] }
  }, { now: 1_001 })
  const refreshed = await getCachedResource('/tmp/workspace', 'github:data', 60_000, async () => {
    loads += 1
    return { issues: [{ number: 8 }] }
  }, { force: true, now: 1_001 })

  assert.deepEqual(cached.data, { issues: [{ number: 7 }] })
  assert.equal(loads, 1)
  assert.deepEqual(refreshed.data, { issues: [{ number: 8 }] })
  assert.equal(refreshed.cache.stale, false)
})

test('mappa l’identità semantica GitHub sul formato storage storico senza creare nuove entry', async (t) => {
  withTemporaryCache(t)
  writeCache('/tmp/workspace-legacy', 'github:data', { issues: [{ number: 7 }] }, 60_000, 1_000)
  let loads = 0

  const cached = await getCachedResource('/tmp/workspace-legacy', 'github-data-snapshot', 60_000, async () => {
    loads += 1
    return { issues: [{ number: 8 }] }
  }, { force: true, now: 1_001 })

  assert.equal(loads, 1)
  assert.deepEqual(cached.data, { issues: [{ number: 8 }] })
  assert.deepEqual(readCache('/tmp/workspace-legacy', 'github:data', 1_002).data, { issues: [{ number: 8 }] })
  assert.equal(readCache('/tmp/workspace-legacy', 'github-data-snapshot', 1_002), null)
  invalidateGitHubDataCache('/tmp/workspace-legacy')
  assert.equal(readCache('/tmp/workspace-legacy', 'github:data', 1_002), null)
  assert.equal(readCache('/tmp/workspace-legacy', 'github-data-snapshot', 1_002), null)
})

test('mantiene cache scaduta se il refresh remoto non è disponibile', async (t) => {
  withTemporaryCache(t)
  writeCache('/tmp/workspace', 'github:data', { issues: [{ number: 7 }] }, 60_000, 1_000)

  const result = await getCachedResource('/tmp/workspace', 'github:data', 60_000, async () => {
    throw new Error('GitHub non disponibile')
  }, { force: true, now: 61_001 })

  assert.deepEqual(result.data, { issues: [{ number: 7 }] })
  assert.equal(result.cache.stale, true)
  assert.equal(result.cache.refreshError, true)
})

test('riusa un singolo caricamento per refresh cache concorrenti identici', async (t) => {
  withTemporaryCache(t)
  let loads = 0
  const releaseLoads = []
  const load = () => {
    loads += 1
    return new Promise((resolve) => { releaseLoads.push(() => resolve({ issues: [{ number: 9 }] })) })
  }

  const first = getCachedResource('/tmp/workspace', 'github:data', 60_000, load, { force: true, now: 1_000 })
  const second = getCachedResource('/tmp/workspace', 'github:data', 60_000, load, { force: true, now: 1_000 })
  for (const releaseLoad of releaseLoads) releaseLoad()
  const [firstResult, secondResult] = await Promise.all([first, second])

  assert.equal(loads, 1)
  assert.deepEqual(secondResult, firstResult)
})

test('una invalidazione durante il refresh non può ripubblicare cache obsoleta', async (t) => {
  withTemporaryCache(t)
  let resolveOld
  let loads = 0
  const load = () => {
    loads += 1
    if (loads === 1) return new Promise((resolve) => { resolveOld = resolve })
    return Promise.resolve({ issues: [{ number: 2 }] })
  }

  const pending = getCachedResource('/tmp/workspace-generation', 'github-data-snapshot', 60_000, load, { force: true, now: 1_000 })
  await new Promise((resolve) => setImmediate(resolve))
  invalidateGitHubDataCache('/tmp/workspace-generation')
  resolveOld({ issues: [{ number: 1 }] })

  const result = await pending
  assert.equal(loads, 2)
  assert.deepEqual(result.data, { issues: [{ number: 2 }] })
  assert.deepEqual(readCache('/tmp/workspace-generation', 'github:data', 1_001).data, { issues: [{ number: 2 }] })
  assert.equal(readCache('/tmp/workspace-generation', 'github-data-snapshot', 1_001), null)
})

test('un refresh successivo all invalidazione non riusa il caricamento precedente', async (t) => {
  withTemporaryCache(t)
  let resolveOld
  let oldLoadCalls = 0
  const oldLoad = () => {
    oldLoadCalls += 1
    if (oldLoadCalls === 1) return new Promise((resolve) => { resolveOld = resolve })
    return Promise.resolve({ issues: [{ number: 3 }] })
  }
  const first = getCachedResource('/tmp/workspace-generation-concurrent', 'github-data-snapshot', 60_000, oldLoad, { force: true, now: 1_000 })
  await new Promise((resolve) => setImmediate(resolve))
  invalidateGitHubDataCache('/tmp/workspace-generation-concurrent')
  const second = getCachedResource('/tmp/workspace-generation-concurrent', 'github-data-snapshot', 60_000, async () => ({ issues: [{ number: 3 }] }), { force: true, now: 1_001 })

  assert.deepEqual((await second).data, { issues: [{ number: 3 }] })
  resolveOld({ issues: [{ number: 1 }] })
  assert.deepEqual((await first).data, { issues: [{ number: 3 }] })
})

test('mantiene il grafo Git più a lungo dello stato dei file', async (t) => {
  withTemporaryCache(t)
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-cache-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  fs.writeFileSync(path.join(workspace, 'README.md'), '# VincodeLab\n')
  execFileSync('git', ['add', 'README.md'], { cwd: workspace })
  execFileSync('git', ['-c', 'user.email=vincodelab@example.test', '-c', 'user.name=VincodeLab Test', 'commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })

  await getCachedGitStatus(workspace, { now: 1_000 })

  assert.equal(readCache(workspace, 'git:status', 1_001).cache.expiresAt, 11_000)
  assert.equal(readCache(workspace, 'git:graph', 1_001).cache.expiresAt, 301_000)
})

test('invalida esclusivamente le cache dipendenti dalla mutazione eseguita', (t) => {
  withTemporaryCache(t)
  writeCache('/tmp/workspace', 'git:status', { branch: 'main' }, 60_000, 1_000)
  writeCache('/tmp/workspace', 'git:graph', [], 60_000, 1_000)
  writeCache('/tmp/workspace', 'github:data', { issues: [] }, 60_000, 1_000)
  writeCache('/tmp/workspace', 'github:project-board:5', { items: [] }, 60_000, 1_000)
  writeCache('/tmp/workspace', 'github:project-board:6', { items: [] }, 60_000, 1_000)

  invalidateGitCache('/tmp/workspace')
  invalidateProjectBoardCache('/tmp/workspace', 5)

  assert.equal(readCache('/tmp/workspace', 'git:status', 1_001), null)
  assert.equal(readCache('/tmp/workspace', 'git:graph', 1_001), null)
  assert.equal(readCache('/tmp/workspace', 'github:project-board:5', 1_001), null)
  assert.deepEqual(readCache('/tmp/workspace', 'github:project-board:6', 1_001).data, { items: [] })
  assert.deepEqual(readCache('/tmp/workspace', 'github:data', 1_001).data, { issues: [] })

  invalidateGitHubDataCache('/tmp/workspace')
  assert.equal(readCache('/tmp/workspace', 'github:data', 1_001), null)
  assert.equal(readCache('/tmp/workspace', 'github-data-snapshot', 1_001), null)
  assert.deepEqual(readCache('/tmp/workspace', 'github:project-board:6', 1_001).data, { items: [] })
})

test('conserva la board Project in cache quando il refresh forzato non raggiunge GitHub', async (t) => {
  withTemporaryCache(t)
  const board = { project: { id: 'PVT_1', number: 5, title: 'Attività', shortDescription: '', closed: false, url: 'https://github.com/orgs/example/projects/5' }, fields: [], items: [] }
  writeCache('/tmp/workspace-non-disponibile', 'github:project-board:5', board, 60_000, 1_000)

  const result = await getCachedProjectBoard('/tmp/workspace-non-disponibile', 5, { force: true, now: 61_001 })

  assert.deepEqual(result.data, board)
  assert.equal(result.cache.stale, true)
  assert.equal(result.cache.refreshError, true)
})

test('parses ordinary porcelain-v1 zero-delimited Git status entries', () => {
  assert.deepEqual(parseStatus(' M src/App.tsx\0A  README.md\0?? notes.txt\0'), [
    { path: 'src/App.tsx', index: ' ', workingTree: 'M' },
    { path: 'README.md', index: 'A', workingTree: ' ' },
    { path: 'notes.txt', index: '?', workingTree: '?' },
  ])
})

test('parses renamed files without losing either path', () => {
  assert.deepEqual(parseStatus('R  new-name.ts\0old-name.ts\0'), [
    { path: 'new-name.ts', previousPath: 'old-name.ts', index: 'R', workingTree: ' ' },
  ])
})

test('tronca esplicitamente uno stato Git sintetico oltre il budget di file', () => {
  const output = Array.from({ length: MAX_GIT_STATUS_FILES + 250 }, (_, index) => `?? generated/file-${String(index).padStart(5, '0')}.txt\0`).join('')

  const page = parseStatusPage(output)

  assert.equal(page.files.length, MAX_GIT_STATUS_FILES)
  assert.equal(page.hasMore, true)
  assert.equal(page.truncated, true)
})

test('tronca esplicitamente un grafo sintetico oltre il budget di commit', () => {
  const output = Array.from({ length: MAX_GIT_GRAPH_COMMITS + 1 }, (_, index) => `${index}|${index + 1}|main|Commit ${index}`).join('\n')

  const page = parseGraphPage(output)

  assert.equal(page.graph.length, MAX_GIT_GRAPH_COMMITS)
  assert.equal(page.hasMore, true)
  assert.equal(page.truncated, true)
})

test('limita per numero e byte il DTO delle issue GitHub', () => {
  const issues = Array.from({ length: MAX_GITHUB_ISSUES + 50 }, (_, index) => ({
    number: index + 1,
    title: `Issue ${index + 1}`,
    body: 'x'.repeat(2_000),
    state: 'OPEN',
    author: null,
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
    url: `https://github.test/issues/${index + 1}`,
    labels: [],
  }))

  const page = parseIssuesPage(JSON.stringify(issues))

  assert.ok(page.issues.length <= MAX_GITHUB_ISSUES)
  assert.ok(page.resultBytes <= 1_250_000)
  assert.equal(page.hasMore, true)
  assert.equal(page.truncated, true)
})

test('marks secret-looking Git changes as protected and refuses staging them', () => {
  assert.equal(parseStatus('?? .env\0')[0].sensitive, true)
  assert.equal(parseStatus('?? .env.example\0')[0].sensitive, undefined)
  assert.equal(parseStatus('?? deploy/private-key.pem\0')[0].sensitive, true)
  assert.throws(() => assertFilePaths(['.env']), /riservato/)
  assert.deepEqual(assertFilePaths(['.env'], { allowSensitive: true }), ['.env'])
})

test('suddivide 1.000 path Git in comandi bounded senza perderne o riordinarne uno', () => {
  const paths = Array.from({ length: 1_000 }, (_, index) => `generated/${String(index).padStart(4, '0')}-${'x'.repeat(200)}.txt`)

  const chunks = chunkGitFilePaths(paths)

  assert.deepEqual(chunks.flat(), paths)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= 128))
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk.join('\0'), 'utf8') + 1 <= 64 * 1024))
})

test('invalida la cache quando un batch di staging successivo fallisce dopo una modifica parziale', async (t) => {
  withTemporaryCache(t)
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-stage-partial-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  const paths = Array.from({ length: 128 }, (_, index) => `file-${String(index).padStart(3, '0')}.txt`)
  for (const filePath of paths) fs.writeFileSync(path.join(workspace, filePath), `${filePath}\n`)
  writeCache(workspace, 'git:status', { files: [] }, 60_000, 1_000)
  writeCache(workspace, 'git:graph', { graph: [] }, 60_000, 1_000)

  await assert.rejects(() => stageFiles(workspace, [...paths, 'missing.txt']))

  assert.equal(readCache(workspace, 'git:status', 1_001), null)
  assert.equal(readCache(workspace, 'git:graph', 1_001), null)
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: workspace, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  assert.deepEqual(staged, paths)
})

test('invalida la cache quando un batch di unstage successivo fallisce dopo una modifica parziale', async (t) => {
  withTemporaryCache(t)
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-unstage-partial-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  const paths = Array.from({ length: 128 }, (_, index) => `file-${String(index).padStart(3, '0')}.txt`)
  for (const filePath of paths) fs.writeFileSync(path.join(workspace, filePath), `${filePath}\n`)
  execFileSync('git', ['add', '.'], { cwd: workspace })
  execFileSync('git', ['commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })
  for (const filePath of paths) fs.appendFileSync(path.join(workspace, filePath), 'modifica\n')
  execFileSync('git', ['add', '.'], { cwd: workspace })
  writeCache(workspace, 'git:status', { files: paths }, 60_000, 1_000)
  writeCache(workspace, 'git:graph', { graph: [] }, 60_000, 1_000)

  await assert.rejects(() => unstageFiles(workspace, [...paths, 'missing.txt']))

  assert.equal(readCache(workspace, 'git:status', 1_001), null)
  assert.equal(readCache(workspace, 'git:graph', 1_001), null)
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: workspace, encoding: 'utf8' }).trim(), '')
})

test('refuses a commit when a protected file was staged outside the app', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  fs.writeFileSync(path.join(workspace, '.env'), 'TOKEN=non-pubblicare\n')
  // Simula un file già forzato nello staging da un altro strumento, anche con global ignore attivo.
  execFileSync('git', ['add', '--force', '.env'], { cwd: workspace })
  await assert.rejects(() => commit(workspace, 'Tentativo non valido'), /file riservati/)
})

test('returns a valid empty history for a newly initialized repository', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })

  const status = await getGitStatus(workspace)
  assert.equal(status.isRepository, true)
  assert.deepEqual(status.commits, [])
})

test('elenca ogni file non tracciato anche nelle cartelle', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  fs.mkdirSync(path.join(workspace, 'test'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'test', 'editor-ux.test.cjs'), 'test file\n')

  const status = await getGitStatus(workspace)
  assert.deepEqual(status.files, [{ path: 'test/editor-ux.test.cjs', index: '?', workingTree: '?' }])
})

test('un repository sintetico grande restituisce una pagina bounded invece di fallire sul buffer', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-large-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  const generated = path.join(workspace, 'generated')
  fs.mkdirSync(generated)
  for (let index = 0; index < MAX_GIT_STATUS_FILES + 100; index += 1) {
    fs.writeFileSync(path.join(generated, `file-${String(index).padStart(5, '0')}.txt`), 'x')
  }

  const [status, concurrentStatus] = await Promise.all([getGitStatus(workspace), getGitStatus(workspace)])

  assert.equal(status.files.length, MAX_GIT_STATUS_FILES)
  assert.equal(status.filesHasMore, true)
  assert.equal(status.filesTruncated, true)
  assert.deepEqual(concurrentStatus.files, status.files)
  assert.equal(concurrentStatus.hasMore, true)
})

test('conserva lo spazio strutturale del primo file modificato restituito da Git', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  fs.mkdirSync(path.join(workspace, 'electron'))
  fs.writeFileSync(path.join(workspace, 'electron', 'application-menu.cjs'), 'module.exports = {}\n')
  execFileSync('git', ['add', '.'], { cwd: workspace })
  execFileSync('git', ['commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })
  fs.appendFileSync(path.join(workspace, 'electron', 'application-menu.cjs'), '// modifica locale\n')

  const status = await getGitStatus(workspace)
  assert.deepEqual(status.files, [{ path: 'electron/application-menu.cjs', index: ' ', workingTree: 'M' }])
})

test('initializes Git in a workspace without modifying project files', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'Contenuto progetto\n')

  const status = await initializeGitRepository(workspace)
  assert.equal(status.isRepository, true)
  assert.equal(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8'), 'Contenuto progetto\n')
  assert.equal(fs.existsSync(path.join(workspace, '.git')), true)
})

test('validates and configures a GitHub origin remote', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  await initializeGitRepository(workspace)

  assert.equal(assertGitHubRemoteUrl('https://github.com/example/repository'), 'https://github.com/example/repository.git')
  assert.equal(assertGitHubRemoteUrl('git@github.com:example/repository.git'), 'git@github.com:example/repository.git')
  assert.throws(() => assertGitHubRemoteUrl('https://example.test/repository'), /URL GitHub HTTPS o SSH valido/)

  const status = await addGitHubRemote(workspace, 'https://github.com/example/repository')
  assert.equal(status.remote, 'origin')
})

test('validates a GitHub repository name without allowing shell-like input', () => {
  assert.equal(assertGitHubRepositoryName('workspace-app'), 'workspace-app')
  assert.equal(assertGitHubRepositoryName('organization/workspace-app'), 'organization/workspace-app')
  assert.throws(() => assertGitHubRepositoryName('workspace app; rm -rf /'), /nome repository può contenere/)
  assert.throws(() => assertGitHubRepositoryName('workspace.git'), /nome repository può contenere/)
})

test('lists the current branch even before the first commit creates a ref', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-branches-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })

  const currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd: workspace, encoding: 'utf8' }).trim()
  assert.deepEqual(await listBranches(workspace), {
    branches: [{ name: currentBranch, current: true }],
    hasMore: false,
    truncated: false,
  })
})

test('include sempre il branch corrente nel limite usando un repository reale con molte ref', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-branches-large-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Branch test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: workspace })
  execFileSync('git', ['commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['branch', '-m', 'zzz-current'], { cwd: workspace })
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim()
  const refs = Array.from({ length: 1_001 }, (_, index) => `create refs/heads/aaa-${String(index).padStart(4, '0')} ${sha}\n`).join('')
  execFileSync('git', ['update-ref', '--stdin'], { cwd: workspace, input: refs })

  const page = await listBranches(workspace)

  assert.equal(page.branches.length, 1_000)
  assert.deepEqual(page.branches.filter((branch) => branch.current), [{ name: 'zzz-current', current: true }])
  assert.equal(page.hasMore, true)
  assert.equal(page.truncated, true)
})

test('reports a configured remote and local commits ready for the first push', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  fs.writeFileSync(path.join(workspace, 'README.md'), '# VincodeLab\n')
  execFileSync('git', ['add', 'README.md'], { cwd: workspace })
  execFileSync('git', ['commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/vincodelab.git'], { cwd: workspace })

  const status = await getGitStatus(workspace)
  assert.equal(status.remote, 'origin')
  assert.equal(status.upstream, null)
  assert.equal(status.ahead, 1)
})

test('publishes the first branch and configures its upstream', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-git-'))
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-'))
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
    fs.rmSync(remote, { recursive: true, force: true })
  })
  execFileSync('git', ['init', '--bare'], { cwd: remote, stdio: 'ignore' })
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'vincodelab@example.test'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'VincodeLab Test'], { cwd: workspace })
  fs.writeFileSync(path.join(workspace, 'README.md'), '# VincodeLab\n')
  execFileSync('git', ['add', 'README.md'], { cwd: workspace })
  execFileSync('git', ['commit', '-m', 'Commit iniziale'], { cwd: workspace, stdio: 'ignore' })
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: workspace })

  const status = await push(workspace)
  assert.match(status.upstream, /^origin\//)
  assert.equal(status.ahead, 0)
})

test('shows a readable diff for a new untracked file', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-diff-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  fs.writeFileSync(path.join(workspace, 'notes.txt'), 'Nuova attività\n')

  const diff = await getFileDiff(workspace, 'notes.txt')
  assert.match(diff, /new file mode/)
  assert.match(diff, /\+Nuova attività/)
})

test('tronca un diff molto grande con un indicatore esplicito senza superare il budget', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-diff-large-'))
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }))
  execFileSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  fs.writeFileSync(path.join(workspace, 'large.txt'), `${'riga molto lunga '.repeat(80)}\n`.repeat(2_000))

  const diff = await getFileDiff(workspace, 'large.txt')

  assert.match(diff, /Diff troncato/)
  assert.ok(Buffer.byteLength(diff, 'utf8') < 1_100_000)
})

test('parses graph rows while retaining refs and parentage', () => {
  assert.deepEqual(parseGraph('a1|p1 p2|HEAD -> main|Merge branch\nb2||origin/main|Initial'), [
    { sha: 'a1', parents: ['p1', 'p2'], refs: ['HEAD -> main'], subject: 'Merge branch' },
    { sha: 'b2', parents: [], refs: ['origin/main'], subject: 'Initial' },
  ])
})

test('rimuove il newline di separazione davanti agli SHA della cronologia reale', () => {
  const history = parseHistory(`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1fPrimo\x1fMario\x1f2026-08-20T00:00:00Z\x1e\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\x1fSecondo\x1fAnna\x1f2026-08-21T00:00:00Z\x1e\n`)

  assert.deepEqual(history.map((commitEntry) => commitEntry.sha), [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ])
})

test('parses local branches and rejects unsafe branch names', () => {
  assert.deepEqual(parseBranches('* main\0\n  feature/github-dashboard\0\n'), [
    { name: 'main', current: true },
    { name: 'feature/github-dashboard', current: false },
  ])
  assert.equal(assertBranchName('feature/github-dashboard'), 'feature/github-dashboard')
  assert.throws(() => assertBranchName('main; rm -rf /'), /Branch non valido/)
  assert.throws(() => assertBranchName('../main'), /Branch non valido/)
})

test('returns a renderable GitHub-unavailable state for local-only repositories', () => {
  assert.deepEqual(githubUnavailableData('no git remotes found'), {
    repository: null,
    issues: [],
    issuesHasMore: false,
    issuesTruncated: false,
    projects: [],
    projectsHasMore: false,
    projectsTruncated: false,
    hasMore: false,
    truncated: false,
    githubDiagnostic: 'Collega o crea un repository GitHub dalla scheda Modifiche per usare issue e progetti.',
    projectsDiagnostic: null,
  })
})

test('reports GitHub authentication failures without exposing raw CLI errors', () => {
  assert.equal(githubAccessDiagnostic('not logged into any GitHub hosts'), 'Accedi a GitHub CLI per gestire issue e Projects di questo workspace.')
  const authError = new Error('raw /Users/demo/auth.json?token=ghp_supersegreto')
  authError.code = 'GITHUB_AUTH_REQUIRED'
  const unavailable = githubUnavailableData(authError)
  assert.equal(unavailable.githubDiagnostic, 'Accedi a GitHub CLI per gestire issue e Projects di questo workspace.')
  assert.doesNotMatch(JSON.stringify(unavailable), /Users|auth\.json|token|ghp_|\?/i)
})

test('mantiene la diagnostica auth redigendo stderr path token e query', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-github-private-error-'))
  const fakeGh = path.join(root, 'gh')
  const workspace = path.join(root, 'workspace')
  const previousGhPath = process.env.VINCODELAB_GH_PATH
  const previousMode = process.env.VINCODELAB_TEST_GH_ERROR_MODE
  fs.mkdirSync(workspace)
  fs.writeFileSync(fakeGh, `#!/bin/sh
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' '{"nameWithOwner":"acme/workspace","url":"https://github.com/acme/workspace","owner":{"login":"acme"}}'
elif [ "$1 $2" = "issue list" ]; then
  if [ "$VINCODELAB_TEST_GH_ERROR_MODE" = "auth" ]; then
    printf '%s\\n' 'not logged into any GitHub hosts; /Users/demo/Segreti/auth.json?token=ghp_supersegreto' >&2
    exit 1
  fi
  printf '%s\\n' '[]'
elif [ "$1 $2" = "api graphql" ]; then
  printf '%s\\n' 'token requires scope project; /Users/demo/Segreti/project.json?token=ghp_supersegreto' >&2
  exit 1
else
  exit 90
fi
`, { mode: 0o755 })
  process.env.VINCODELAB_GH_PATH = fakeGh
  t.after(() => {
    if (previousGhPath === undefined) delete process.env.VINCODELAB_GH_PATH
    else process.env.VINCODELAB_GH_PATH = previousGhPath
    if (previousMode === undefined) delete process.env.VINCODELAB_TEST_GH_ERROR_MODE
    else process.env.VINCODELAB_TEST_GH_ERROR_MODE = previousMode
    fs.rmSync(root, { recursive: true, force: true })
  })

  process.env.VINCODELAB_TEST_GH_ERROR_MODE = 'project'
  const projectsFailure = await getGitHubData(workspace)
  assert.equal(projectsFailure.githubDiagnostic, null)
  assert.equal(projectsFailure.projectsDiagnostic, 'Autorizzazione GitHub Projects mancante. [GITHUB_PROJECT_SCOPE_REQUIRED]')
  assert.doesNotMatch(JSON.stringify(projectsFailure), /Users|Segreti|auth\.json|project\.json|token|ghp_|\?/i)
  await assert.rejects(
    () => getLinkedProjectBoard(workspace, 7),
    (error) => /^Autorizzazione GitHub Projects mancante\. \[GITHUB_PROJECT_SCOPE_REQUIRED\] \[ERR-[A-F0-9]{6}\]$/.test(error.message)
      && !/Users|Segreti|project\.json|token|ghp_|\?/i.test(error.message),
  )

  process.env.VINCODELAB_TEST_GH_ERROR_MODE = 'auth'
  const authFailure = await getGitHubData(workspace)
  assert.equal(authFailure.githubDiagnostic, 'Accedi a GitHub CLI per gestire issue e Projects di questo workspace.')
  assert.equal(authFailure.projectsDiagnostic, null)
  assert.doesNotMatch(JSON.stringify(authFailure), /Users|Segreti|auth\.json|project\.json|token|ghp_|\?/i)

  assert.equal(githubProjectsDiagnostic(new Error('raw /Users/demo/file?token=secret')), 'Impossibile leggere i GitHub Projects. [GITHUB_PROJECTS_UNAVAILABLE]')
  assert.throws(
    () => parseIssuesPage('{"private":"/Users/demo/issues.json?token=ghp_supersegreto"'),
    (error) => error.message === 'Risposta GitHub non valida. [GITHUB_RESPONSE_INVALID]',
  )
})

test('richiede una riga sentinella e limita i campi voluminosi delle issue', () => {
  const source = [
    fs.readFileSync(path.join(__dirname, '../electron/domains/github/github-model.cjs'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../electron/domains/github/github-issue-use-cases.cjs'), 'utf8'),
  ].join('\n')
  assert.match(source, /const MAX_GITHUB_ISSUES = 500/)
  assert.match(source, /'--limit', String\(MAX_GITHUB_ISSUES \+ 1\)/)
  assert.match(source, /'--jq', ISSUE_LIST_JQ/)
})

test('applica le proiezioni bounded Project nel processo GitHub CLI reale', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-project-runner-'))
  const fakeGh = path.join(root, 'gh')
  const workspace = path.join(root, 'workspace')
  const logPath = path.join(root, 'gh.log')
  const servicePath = path.join(__dirname, 'helpers/github-service.cjs')
  fs.mkdirSync(workspace)
  fs.writeFileSync(fakeGh, `#!/bin/sh
has_jq=0
for argument in "$@"; do
  if [ "$argument" = "--jq" ]; then has_jq=1; fi
done
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' '{"nameWithOwner":"acme/workspace","url":"https://github.com/acme/workspace","owner":{"login":"acme"}}'
elif [ "$1 $2" = "api graphql" ]; then
  case "$*" in
    *"projectId=PVT_budget"*) printf '%s\\n' '{"data":{"node":{"id":"PVT_budget","items":{"totalCount":1}}}}' ;;
    *) printf '%s\\n' '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_budget","number":7,"title":"Budget board","shortDescription":"","closed":false,"url":"https://github.com/orgs/acme/projects/7"}]}}}}' ;;
  esac
elif [ "$1 $2" = "project field-list" ]; then
  if [ "$has_jq" -ne 1 ]; then printf '%s\\n' 'proiezione field-list assente' >&2; exit 88; fi
  printf '%s\\n' 'field-list:jq' >> "$VINCODELAB_TEST_LOG"
  printf '%s\\n' '{"fields":[{"id":"PVTF_status","name":"Status","dataType":"SINGLE_SELECT","options":[]}]}'
elif [ "$1 $2" = "project item-list" ]; then
  if [ "$has_jq" -ne 1 ]; then printf '%s\\n' 'proiezione item-list assente' >&2; exit 89; fi
  printf '%s\\n' 'item-list:jq' >> "$VINCODELAB_TEST_LOG"
  printf '%s\\n' '{"items":[{"id":"PVTI_budget","type":"DraftIssue","status":"Todo","content":{"title":"Bounded item"}}]}'
else
  exit 90
fi
`, { mode: 0o755 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const script = `const { createGithubService } = require(${JSON.stringify(servicePath)}); const { getLinkedProjectBoard } = createGithubService(); getLinkedProjectBoard(${JSON.stringify(workspace)}, 7).then((board) => process.stdout.write(JSON.stringify(board)))`
  const output = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      VINCODELAB_DATA_DIR: path.join(root, 'data'),
      VINCODELAB_GH_PATH: fakeGh,
      VINCODELAB_TEST_LOG: logPath,
    },
  })
  const board = JSON.parse(output)

  assert.equal(board.items[0].title, 'Bounded item')
  assert.ok(board.itemsResultBytes < 2_048)
  assert.equal(fs.readFileSync(logPath, 'utf8'), 'field-list:jq\nitem-list:jq\n')
})
