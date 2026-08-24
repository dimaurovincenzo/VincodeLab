const assert = require('node:assert/strict')
const test = require('node:test')

const { createWorkspaceRuntimeCleanup } = require('../electron/domains/workspace/workspace-runtime-cleanup.cjs')

test('drena in ordine operazioni, servizi remoti, shell e Pi config', async () => {
  const calls = []
  const resolved = async (name) => { calls.push(name) }
  const cleanup = createWorkspaceRuntimeCleanup({
    closeDatabaseWorkspaceSessions: (workspacePath) => resolved(`database:sessions:${workspacePath}`),
    closeRedisWorkspaceSessions: (workspacePath) => resolved(`redis:sessions:${workspacePath}`),
    closeShellSessions: (workspacePath) => resolved(`shell:${workspacePath}`),
    databaseOperations: { abortAndWaitMatching: () => resolved('database:abort') },
    externalMutations: { waitMatching: () => resolved('external') },
    getWindow: () => ({ isDestroyed: () => false, webContents: { id: 7 } }),
    githubOperations: { abortAndWaitMatching: () => resolved('github') },
    redisOperations: { abortAndWaitMatching: () => resolved('redis:abort') },
    remoteRuntime: { closeWorkspace: (workspacePath) => resolved(`remote:${workspacePath}`) },
    stopPiConfig: () => resolved('pi-config'),
    stopTerminal: (reason) => resolved(`pi:${reason}`),
    withCleanupDeadline: async (promise, timeout, operation) => {
      calls.push(`deadline:${operation}:${timeout}`)
      return promise
    },
  })

  await cleanup('/workspace', 'workspace-change')
  assert.ok(calls.indexOf('external') < calls.indexOf('pi:workspace-change'))
  assert.ok(calls.indexOf('github') < calls.indexOf('remote:/workspace'))
  assert.ok(calls.indexOf('remote:/workspace') < calls.indexOf('shell:/workspace'))
  assert.equal(calls.at(-1), 'pi-config')
})

test('senza workspace non chiude servizi confinati a una cartella', async () => {
  const calls = []
  const cleanup = createWorkspaceRuntimeCleanup({
    closeDatabaseWorkspaceSessions: () => calls.push('database:sessions'),
    closeRedisWorkspaceSessions: () => calls.push('redis:sessions'),
    closeShellSessions: () => calls.push('shell'),
    databaseOperations: { abortAndWaitMatching: async () => {} },
    externalMutations: { waitMatching: async () => {} },
    getWindow: () => null,
    githubOperations: { abortAndWaitMatching: async () => {} },
    redisOperations: { abortAndWaitMatching: async () => {} },
    remoteRuntime: { closeWorkspace: () => calls.push('remote') },
    stopPiConfig: async () => {},
    stopTerminal: async () => {},
    withCleanupDeadline: (promise) => promise,
  })
  await cleanup(null, 'shutdown')
  assert.deepEqual(calls, [])
})
