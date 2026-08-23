const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createGithubOperationRegistry } = require('../electron/github-operation-registry.cjs')

test('latest wins annulla il refresh precedente e attende il suo cleanup', async () => {
  const registry = createGithubOperationRegistry()
  const first = registry.startLatest({ senderId: 7, workspacePath: '/workspace-a', type: 'git-status' })
  const second = registry.startLatest({ senderId: 7, workspacePath: '/workspace-a', type: 'git-status' })
  let secondReady = false
  void second.ready.then(() => { secondReady = true })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
  assert.equal(secondReady, false)
  assert.deepEqual(registry.diagnostics(), { activeOperations: 1, byType: { 'git-status': 1 } })

  first.finish()
  await second.ready
  assert.equal(secondReady, true)
  second.finish()
  assert.deepEqual(registry.diagnostics(), { activeOperations: 0, byType: {} })
})

test('latest wins resta isolato per sender workspace e tipo', () => {
  const registry = createGithubOperationRegistry()
  const first = registry.startLatest({ senderId: 7, workspacePath: '/workspace-a', type: 'data' })
  const otherSender = registry.startLatest({ senderId: 8, workspacePath: '/workspace-a', type: 'data' })
  const otherWorkspace = registry.startLatest({ senderId: 7, workspacePath: '/workspace-b', type: 'data' })
  const otherType = registry.startLatest({ senderId: 7, workspacePath: '/workspace-a', type: 'branches' })

  assert.equal(first.signal.aborted, false)
  assert.equal(otherSender.signal.aborted, false)
  assert.equal(otherWorkspace.signal.aborted, false)
  assert.equal(otherType.signal.aborted, false)
  assert.equal(registry.abortMatching((operation) => operation.workspacePath === '/workspace-a'), 3)
  assert.equal(first.signal.aborted, true)
  assert.equal(otherSender.signal.aborted, true)
  assert.equal(otherWorkspace.signal.aborted, false)
  assert.equal(otherType.signal.aborted, true)

  first.finish()
  otherSender.finish()
  otherWorkspace.finish()
  otherType.finish()
})

test('abortAndWaitMatching completa soltanto dopo il rilascio delle operazioni', async () => {
  const registry = createGithubOperationRegistry()
  const operation = registry.startLatest({ senderId: 7, workspacePath: '/workspace-a', type: 'project-board' })
  let completed = false
  const cleanup = registry.abortAndWaitMatching().then((result) => {
    completed = true
    return result
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(operation.signal.aborted, true)
  assert.equal(completed, false)
  operation.finish()
  assert.deepEqual(await cleanup, { cancelled: 1 })
  assert.equal(completed, true)
})

test('rifiuta contesti non validi', () => {
  const registry = createGithubOperationRegistry()
  assert.throws(() => registry.startLatest({ senderId: 0, workspacePath: '/workspace', type: 'data' }), /non valido/)
  assert.throws(() => registry.startLatest({ senderId: 7, workspacePath: '', type: 'data' }), /non valido/)
  assert.throws(() => registry.startLatest({ senderId: 7, workspacePath: '/workspace', type: 'Data!' }), /non valido/)
})

test('il main applica latest wins soltanto alle letture e le cancella nei lifecycle boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  for (const [channel, type] of [
    ['github:gitStatus', 'git-status'],
    ['github:branches', 'branches'],
    ['github:fileDiff', 'file-diff'],
    ['github:data', 'data'],
    ['github:projectBoard', 'project-board'],
    ['github:projectItemFields', 'project-fields'],
  ]) {
    const handler = source.slice(source.indexOf(`ipcMain.handle('${channel}'`), source.indexOf("ipcMain.handle('", source.indexOf(`ipcMain.handle('${channel}'`) + 1))
    assert.match(handler, new RegExp(`runLatestGithubRead\\(event, '${type}'`))
  }

  for (const channel of ['github:commit', 'github:push', 'github:fetch', 'github:pullRebase', 'github:createIssue', 'github:updateIssue', 'github:updateProjectItem']) {
    const handler = source.slice(source.indexOf(`ipcMain.handle('${channel}'`), source.indexOf("ipcMain.handle('", source.indexOf(`ipcMain.handle('${channel}'`) + 1))
    assert.doesNotMatch(handler, /runLatestGithubRead/)
  }

  assert.match(source, /async function cleanupWorkspaceRuntime\(workspacePath, reason\)[\s\S]*?await stopTerminal\(reason\)[\s\S]*?githubOperations\.abortAndWaitMatching\(\(operation\) => !workspacePath \|\| operation\.workspacePath === workspacePath\)/)
  assert.match(source, /previousWorkspacePath !== normalizedWorkspacePath[\s\S]{0,180}await cleanupWorkspaceRuntime\(previousWorkspacePath, 'workspace-change'\)/)
  assert.match(source, /cleanup: \(\{ workspacePath \}\) => cleanupWorkspaceRuntime\(workspacePath, 'window-close'\)/)
  assert.match(source, /window\.on\('closed',[\s\S]{0,500}cleanupWorkspaceRuntime\(workspacePath, 'window-destroyed'\)/)
  assert.match(source, /async function shutdownApplication[\s\S]*?await stopTerminal\('shutdown'\)[\s\S]*?withCleanupDeadline\(githubOperations\.abortAndWaitMatching\(\), 4_000, 'github-operations'\)/)
})
