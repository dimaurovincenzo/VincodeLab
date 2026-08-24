const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createRemoteOperationLifecycle } = require('../electron/domains/remote-files/remote-operation-lifecycle.cjs')

function deferred() {
  let reject
  let resolve
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function createFixture(overrides = {}) {
  const events = []
  const lifecycle = createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => events.push('abort-transfers:all'),
    abortWorkspaceTransfers: (workspacePath) => events.push(`abort-transfers:${workspacePath}`),
    clearAllRegistries: () => events.push('clear:all'),
    clearWorkspaceRegistries: (workspacePath) => events.push(`clear:${workspacePath}`),
    openWorkspaceDependency: (workspacePath) => events.push(`open-dependency:${workspacePath}`),
    resolveCloseAllDependency: () => () => events.push('close-dependency:all'),
    resolveCloseWorkspaceDependency: () => (workspacePath) => events.push(`close-dependency:${workspacePath}`),
    ...overrides,
  })
  return { events, lifecycle }
}

test('avvia le operazioni in modo differito, conta ownership e conserva risultato o errore', async () => {
  const { lifecycle } = createFixture()
  let invoked = false
  const result = lifecycle.withOperation('/tmp/workspace-a', async (signal) => {
    invoked = true
    assert.equal(signal.aborted, false)
    return 'ok'
  })

  assert.equal(invoked, false)
  assert.equal(lifecycle.getOperationCount(), 1)
  assert.equal(await result, 'ok')
  assert.equal(lifecycle.getOperationCount(), 0)

  const expected = new Error('failure originale')
  await assert.rejects(
    lifecycle.withOperation('/tmp/workspace-a', async () => { throw expected }),
    (error) => error === expected,
  )
  assert.equal(lifecycle.getOperationCount(), 0)
})

test('closeWorkspace è exactly-once e preserva ordine abort, close dipendenza e clear', async () => {
  const events = []
  let lifecycle
  lifecycle = createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => events.push('abort-transfers:all'),
    abortWorkspaceTransfers: () => events.push('abort-transfers:workspace'),
    clearAllRegistries: () => events.push('clear:all'),
    clearWorkspaceRegistries: () => events.push(`clear:workspace:${lifecycle.getOperationCount()}`),
    resolveCloseAllDependency: () => () => events.push('close-dependency:all'),
    resolveCloseWorkspaceDependency: () => () => events.push('close-dependency:workspace'),
  })
  const operationResult = lifecycle.withOperation('/tmp/workspace-a', (signal) => new Promise((_resolve, reject) => {
    events.push('operation:start')
    signal.addEventListener('abort', () => {
      events.push('operation:abort')
      reject(new Error('operazione interrotta'))
    }, { once: true })
  })).catch((error) => error)
  await Promise.resolve()

  const firstClose = lifecycle.closeWorkspace('/tmp/workspace-a')
  const secondClose = lifecycle.closeWorkspace('/tmp/workspace-a')

  assert.equal(firstClose, secondClose)
  await firstClose
  assert.equal((await operationResult).message, 'operazione interrotta')
  assert.equal(lifecycle.getOperationCount(), 0)
  assert.ok(events.indexOf('operation:abort') < events.indexOf('close-dependency:workspace'))
  assert.ok(events.indexOf('abort-transfers:workspace') < events.indexOf('close-dependency:workspace'))
  assert.ok(events.indexOf('close-dependency:workspace') < events.indexOf('clear:workspace:0'))

  const eventsAfterClose = events.length
  await lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(events.length, eventsAfterClose)
  await assert.rejects(
    lifecycle.withOperation('/tmp/workspace-a', async () => 'stale'),
    { name: 'AbortError', message: 'Operazione remota annullata.' },
  )
})

test('un timeout conserva risorse e chiusura, poi consente un retry dopo il drain', async () => {
  const pending = deferred()
  let closeDependencyCalls = 0
  let clearCalls = 0
  const { lifecycle } = createFixture({
    lifecycleTimeoutMs: 20,
    clearWorkspaceRegistries: () => { clearCalls += 1 },
    resolveCloseWorkspaceDependency: () => () => { closeDependencyCalls += 1 },
  })
  const operationResult = lifecycle.withOperation('/tmp/workspace-a', async () => pending.promise).catch((error) => error)
  await Promise.resolve()

  await assert.rejects(
    lifecycle.closeWorkspace('/tmp/workspace-a'),
    (error) => error?.code === 'REMOTE_LIFECYCLE_TIMEOUT'
      && error.message === 'Il cleanup dei file remoti non è terminato entro il tempo previsto.',
  )
  assert.equal(closeDependencyCalls, 1)
  assert.equal(clearCalls, 0)
  assert.equal(lifecycle.getOperationCount(), 1)
  await assert.rejects(lifecycle.withOperation('/tmp/workspace-a', async () => 'blocked'), /Operazione remota annullata\./)

  pending.resolve('risultato stale')
  const staleError = await operationResult
  assert.equal(staleError.name, 'AbortError')
  assert.equal(staleError.message, 'Operazione remota annullata.')
  assert.equal(lifecycle.getOperationCount(), 0)

  await lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(closeDependencyCalls, 2)
  assert.equal(clearCalls, 1)
  await lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(closeDependencyCalls, 2)
})

test('openWorkspace differisce la riapertura e la esegue una sola volta dopo close riuscito', async () => {
  const dependencyClose = deferred()
  let closeCalls = 0
  let openCalls = 0
  const { lifecycle } = createFixture({
    resolveCloseWorkspaceDependency: () => () => {
      closeCalls += 1
      return dependencyClose.promise
    },
    openWorkspaceDependency: () => { openCalls += 1 },
  })

  const closing = lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), true)
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), true)
  assert.equal(openCalls, 0)
  await assert.rejects(lifecycle.withOperation('/tmp/workspace-a', async () => 'blocked'), /Operazione remota annullata\./)

  dependencyClose.resolve()
  await closing

  assert.equal(closeCalls, 1)
  assert.equal(openCalls, 1)
  assert.equal(await lifecycle.withOperation('/tmp/workspace-a', async () => 'riaperto'), 'riaperto')
})

test('una closeWorkspace fallita non pulisce e una riapertura successiva recupera il workspace', async () => {
  const expected = new Error('close SFTP non confermata')
  let closeCalls = 0
  let clearCalls = 0
  let openCalls = 0
  const { lifecycle } = createFixture({
    clearWorkspaceRegistries: () => { clearCalls += 1 },
    resolveCloseWorkspaceDependency: () => () => {
      closeCalls += 1
      throw expected
    },
    openWorkspaceDependency: () => { openCalls += 1 },
  })

  await assert.rejects(lifecycle.closeWorkspace('/tmp/workspace-a'), (error) => error === expected)
  assert.equal(closeCalls, 1)
  assert.equal(clearCalls, 0)
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), true)
  assert.equal(openCalls, 1)
  assert.equal(await lifecycle.withOperation('/tmp/workspace-a', async () => 'recuperato'), 'recuperato')
})

test('closeAll mantiene il blocco globale, ritenta i failure e diventa idempotente al successo', async () => {
  const expected = new Error('close globale non confermata')
  const events = []
  let closeCalls = 0
  let clearCalls = 0
  const lifecycle = createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => events.push('abort-transfers'),
    abortWorkspaceTransfers: () => events.push('abort-workspace-transfers'),
    clearAllRegistries: () => {
      clearCalls += 1
      events.push('clear')
    },
    clearWorkspaceRegistries: () => events.push('clear-workspace'),
    resolveCloseAllDependency: () => () => {
      closeCalls += 1
      events.push(`close:${closeCalls}`)
      if (closeCalls === 1) throw expected
    },
  })

  const firstClose = lifecycle.closeAll()
  assert.equal(lifecycle.closeAll(), firstClose)
  await assert.rejects(firstClose, (error) => error === expected)
  assert.equal(clearCalls, 0)
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), false)
  await assert.rejects(lifecycle.withOperation('/tmp/workspace-a', async () => 'blocked'), /Operazione remota annullata\./)

  const retryClose = lifecycle.closeAll()
  await retryClose
  assert.equal(lifecycle.closeAll(), retryClose)
  assert.equal(closeCalls, 2)
  assert.equal(clearCalls, 1)
  assert.deepEqual(events, ['abort-transfers', 'close:1', 'abort-transfers', 'close:2', 'clear'])
})

test('funziona senza callback SFTP opzionali mantenendo il cleanup asincrono', async () => {
  const events = []
  const lifecycle = createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => events.push('abort:all'),
    abortWorkspaceTransfers: () => events.push('abort:workspace'),
    clearAllRegistries: () => events.push('clear:all'),
    clearWorkspaceRegistries: () => events.push('clear:workspace'),
  })

  const closing = lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.deepEqual(events, ['abort:workspace'])
  await closing
  assert.deepEqual(events, ['abort:workspace', 'clear:workspace'])
})

test('risolve closeWorkspace e openWorkspace dinamicamente dopo la costruzione', async () => {
  const dependency = {}
  const calls = []
  const lifecycle = createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => undefined,
    abortWorkspaceTransfers: () => undefined,
    clearAllRegistries: () => undefined,
    clearWorkspaceRegistries: () => undefined,
    openWorkspaceDependency: (workspacePath) => dependency.openWorkspace?.(workspacePath),
    resolveCloseWorkspaceDependency: () => typeof dependency.closeWorkspace === 'function'
      ? (workspacePath) => dependency.closeWorkspace(workspacePath)
      : undefined,
  })
  dependency.closeWorkspace = (workspacePath) => calls.push(`close:${workspacePath}`)
  dependency.openWorkspace = (workspacePath) => calls.push(`open:${workspacePath}`)

  await lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), true)
  assert.deepEqual(calls, ['close:/tmp/workspace-a', 'open:/tmp/workspace-a'])

  delete dependency.closeWorkspace
  delete dependency.openWorkspace
  await lifecycle.closeWorkspace('/tmp/workspace-a')
  assert.equal(lifecycle.openWorkspace('/tmp/workspace-a'), true)
  assert.deepEqual(calls, ['close:/tmp/workspace-a', 'open:/tmp/workspace-a'])
})

test('risolve closeAll dinamicamente sia quando viene aggiunta sia quando viene rimossa', async () => {
  const createLifecycle = (dependency) => createRemoteOperationLifecycle({
    lifecycleTimeoutMs: 100,
    abortAllTransfers: () => undefined,
    abortWorkspaceTransfers: () => undefined,
    clearAllRegistries: () => undefined,
    clearWorkspaceRegistries: () => undefined,
    resolveCloseAllDependency: () => typeof dependency.closeAll === 'function'
      ? () => dependency.closeAll()
      : undefined,
  })
  let addedCalls = 0
  const addedDependency = {}
  const addedLifecycle = createLifecycle(addedDependency)
  addedDependency.closeAll = () => { addedCalls += 1 }

  await addedLifecycle.closeAll()
  assert.equal(addedCalls, 1)

  let removedCalls = 0
  const removedDependency = { closeAll: () => { removedCalls += 1 } }
  const removedLifecycle = createLifecycle(removedDependency)
  delete removedDependency.closeAll

  await removedLifecycle.closeAll()
  assert.equal(removedCalls, 0)
})

test('mantiene il lifecycle come unico owner dello stato delle operazioni remote', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-file-service.cjs'), 'utf8')
  const lifecycleSource = fs.readFileSync(path.join(__dirname, '..', 'electron/domains/remote-files/remote-operation-lifecycle.cjs'), 'utf8')

  assert.match(serviceSource, /createRemoteOperationLifecycle\(\{/)
  assert.doesNotMatch(serviceSource, /\bactiveOperations\b|\bclosedWorkspaces\b|\bcleanedWorkspaces\b|\bworkspaceClosePromises\b|\breopenWorkspaces\b|\bcloseAllPromise\b|\bclosingAll\b|\bfunction waitForLifecycle\b|\bfunction withRemoteOperation\b/)
  for (const owner of ['activeOperations', 'closedWorkspaces', 'cleanedWorkspaces', 'workspaceClosePromises', 'reopenWorkspaces', 'closeAllPromise', 'closingAll']) {
    assert.match(lifecycleSource, new RegExp(`\\b${owner}\\b`))
  }
  assert.match(lifecycleSource, /\bfunction waitForLifecycle\b/)
  assert.match(lifecycleSource, /\bfunction withOperation\b/)
  assert.match(lifecycleSource, /function clearWorkspaceResources\(workspacePath\)[\s\S]*activeOperations\.delete\(operation\)[\s\S]*clearWorkspaceRegistries\(workspacePath\)/)
  assert.match(serviceSource, /resolveCloseAllDependency: \(\) => typeof sftp\.closeAll === 'function'/)
  assert.match(serviceSource, /resolveCloseWorkspaceDependency: \(\) => typeof sftp\.closeWorkspace === 'function'/)
  assert.match(serviceSource, /openWorkspaceDependency: \(workspacePath\) => sftp\.openWorkspace\?\.\(workspacePath\)/)
})
