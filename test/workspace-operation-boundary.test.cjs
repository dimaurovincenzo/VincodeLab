const assert = require('node:assert/strict')
const test = require('node:test')

const { createWorkspaceOperationBoundary } = require('../electron/domains/workspace/workspace-operation-boundary.cjs')

function fixture({ activeWorkspacePath = '/workspace' } = {}) {
  const calls = []
  const operation = {
    finish: () => calls.push('finish'),
    ready: Promise.resolve(),
    signal: { aborted: false },
  }
  const boundary = createWorkspaceOperationBoundary({
    assertTrustedSender: (event) => calls.push(['trusted', event]),
    externalMutations: {
      run: (identity, perform) => { calls.push(['mutation', identity]); return perform() },
    },
    getActiveWorkspacePath: () => activeWorkspacePath,
    githubOperations: {
      startLatest: (identity) => { calls.push(['latest', identity]); return operation },
    },
  })
  return { boundary, calls, event: { sender: { id: 7 } }, operation }
}

test('richiede il workspace attivo e confina le mutazioni al sender', () => {
  const { boundary, calls, event } = fixture()
  assert.equal(boundary.runWorkspaceMutation(event, 'save', (workspacePath) => workspacePath), '/workspace')
  assert.deepEqual(calls, [
    ['trusted', event],
    ['mutation', { ownerId: 7, workspacePath: '/workspace', type: 'save' }],
  ])
  assert.throws(() => fixture({ activeWorkspacePath: null }).boundary.requireActiveWorkspace(), /Apri prima un workspace/)
})

test('normalizza soltanto opzioni cache bounded', () => {
  const { boundary } = fixture()
  assert.deepEqual(boundary.assertCacheReadOptions(), { force: false })
  assert.deepEqual(boundary.assertCacheReadOptions({ force: true }), { force: true })
  assert.throws(() => boundary.assertCacheReadOptions({ force: 'yes' }), /Opzioni cache non valide/)
})

test('la lettura GitHub latest attende il replacement e chiude sempre lo slot', async () => {
  const { boundary, calls, event, operation } = fixture()
  const result = await boundary.runLatestGithubRead(event, 'status', async (workspacePath, signal) => ({ workspacePath, signal }))
  assert.deepEqual(result, { workspacePath: '/workspace', signal: operation.signal })
  assert.deepEqual(calls, [
    ['latest', { senderId: 7, workspacePath: '/workspace', type: 'status' }],
    'finish',
  ])
})
