const assert = require('node:assert/strict')
const test = require('node:test')

const { createDatabaseSessionRuntime } = require('../electron/domains/database/database-session-runtime.cjs')
const { disposeRemoteSession, forceCloseRemoteSession } = require('../electron/domains/database/remote-session-lifecycle.cjs')

function fakeDriverPort(overrides = {}) {
  const unused = () => { throw new Error('Driver non atteso nel test.') }
  return {
    closeRemoteSession: async () => undefined,
    executeRemote: unused,
    executeTransaction: unused,
    forceCloseRemoteSession: () => undefined,
    openRemoteSession: unused,
    subscribeRemoteFailure: () => () => undefined,
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('il runtime sessioni richiede porte esplicite e ritarda la dipendenza SQLite', () => {
  assert.throws(() => createDatabaseSessionRuntime(), /Porta connessioni database non valida/u)

  const runtime = createDatabaseSessionRuntime({
    getConnectionWithSecrets: () => null,
    invalidateSchema: () => undefined,
    invalidateWorkspaceSchema: () => undefined,
  })

  assert.deepEqual(runtime.sqliteWorkerDiagnostics(), { activeWorkers: 0, pendingRequests: 0 })
  assert.throws(() => runtime.configureRuntime({}), /Runtime database non valido/u)
  assert.throws(() => runtime.configureRuntime({
    createSqliteWorkerSession: () => undefined,
    sqliteWorkerDiagnostics: () => ({}),
  }), /Porta driver database non valida/u)
})

test('il runtime sessioni mantiene single-flight e cleanup SQLite confinati al workspace', async () => {
  const workspacePath = '/workspace/session-runtime'
  const connectionId = 'connection-1'
  const key = `${workspacePath}\u0000${connectionId}`
  const invalidated = []
  const invalidatedWorkspaces = []
  const sessions = []
  let createCalls = 0
  const runtime = createDatabaseSessionRuntime({
    getConnectionWithSecrets: () => ({ driver: 'sqlite', sqlitePath: '/database.sqlite' }),
    invalidateSchema: (candidate) => invalidated.push(candidate),
    invalidateWorkspaceSchema: (candidate) => invalidatedWorkspaces.push(candidate),
  })
  runtime.configureRuntime({
    createSqliteWorkerSession: (_sqlitePath, onClosed) => {
      createCalls += 1
      const session = {
        closeCalls: 0,
        ready: async () => undefined,
        request: async (operation, payload) => ({ operation, payload }),
        close: async () => {
          session.closeCalls += 1
          onClosed()
        },
      }
      sessions.push(session)
      return session
    },
    driverPort: fakeDriverPort(),
    sqliteWorkerDiagnostics: () => ({ activeWorkers: sessions.length, pendingRequests: 0 }),
  })

  const [first, second] = await Promise.all([
    runtime.getSession(workspacePath, connectionId),
    runtime.getSession(workspacePath, connectionId),
  ])

  assert.equal(first, second)
  assert.equal(createCalls, 1)
  assert.deepEqual(await runtime.requestSqlite(first, 'all', { sql: 'SELECT 1' }), {
    operation: 'all',
    payload: { sql: 'SELECT 1' },
  })
  assert.deepEqual(runtime.sqliteWorkerDiagnostics(), { activeWorkers: 1, pendingRequests: 0 })

  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(sessions[0].closeCalls, 1)
  assert.ok(invalidated.includes(key))

  await runtime.getSession(workspacePath, connectionId)
  await runtime.closeWorkspaceSessions(workspacePath)
  assert.equal(createCalls, 2)
  assert.equal(sessions[1].closeCalls, 1)
  assert.deepEqual(invalidatedWorkspaces, [workspacePath])
})

test('il runtime remoto riceve il driver dalla composition root senza caricarlo nel dominio', async () => {
  const workspacePath = '/workspace/remote-driver-port'
  const connectionId = 'postgres-1'
  const handle = Object.freeze({})
  let closeCalls = 0
  const openedConfigs = []
  const candidates = []
  let openCalls = 0
  const driverPort = fakeDriverPort({
    closeRemoteSession: async (candidate) => {
      assert.equal(candidate, handle)
      closeCalls += 1
    },
    openRemoteSession: async (config, { onCandidate }) => {
      openCalls += 1
      openedConfigs.push(config)
      onCandidate(handle)
      candidates.push(handle)
      return handle
    },
  })
  const runtime = createDatabaseSessionRuntime({
    getConnectionWithSecrets: () => ({
      database: 'app',
      driver: 'postgres',
      host: 'db.internal',
      password: 'secret',
      port: 5432,
      user: 'developer',
    }),
    invalidateSchema: () => undefined,
    invalidateWorkspaceSchema: () => undefined,
  })
  runtime.configureRuntime({
    createSqliteWorkerSession: () => undefined,
    driverPort,
    sqliteWorkerDiagnostics: () => ({ activeWorkers: 0, pendingRequests: 0 }),
  })

  const [session, sameSession] = await Promise.all([
    runtime.getSession(workspacePath, connectionId),
    runtime.getSession(workspacePath, connectionId),
  ])

  assert.equal(session, sameSession)
  assert.equal(session.handle, handle)
  assert.equal('client' in session, false)
  assert.equal('connection' in session, false)
  assert.equal(session.driverPort, driverPort)
  assert.equal(openCalls, 1)
  assert.deepEqual(candidates, [handle])
  assert.deepEqual(openedConfigs, [{
    database: 'app',
    driver: 'postgres',
    host: 'db.internal',
    password: 'secret',
    port: 5432,
    user: 'developer',
  }])

  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(closeCalls, 1)
})

test('il candidato remoto consente cleanup mentre openRemoteSession è ancora in corso', async () => {
  const workspacePath = '/workspace/remote-opening-cleanup'
  const connectionId = 'postgres-opening'
  const candidateReady = deferred()
  const connected = deferred()
  const closed = deferred()
  let openCalls = 0
  const handle = Object.freeze({})
  let closeCalls = 0
  const driverPort = fakeDriverPort({
    closeRemoteSession: async (candidate) => {
      assert.equal(candidate, handle)
      closeCalls += 1
      closed.resolve()
    },
    openRemoteSession: async (_config, { onCandidate }) => {
      openCalls += 1
      onCandidate(handle)
      candidateReady.resolve()
      await connected.promise
      return handle
    },
  })
  const runtime = createDatabaseSessionRuntime({
    getConnectionWithSecrets: () => ({
      database: 'app',
      driver: 'postgres',
      host: 'db.internal',
      password: 'secret',
      port: 5432,
      user: 'developer',
    }),
    invalidateSchema: () => undefined,
    invalidateWorkspaceSchema: () => undefined,
  })
  runtime.configureRuntime({
    createSqliteWorkerSession: () => undefined,
    driverPort,
    sqliteWorkerDiagnostics: () => ({ activeWorkers: 0, pendingRequests: 0 }),
  })

  const opening = runtime.getSession(workspacePath, connectionId)
  await candidateReady.promise
  const closing = runtime.closeConnectionSession(workspacePath, connectionId)
  await closed.promise

  assert.equal(openCalls, 1)
  assert.equal(closeCalls, 1)
  connected.resolve()
  await closing
  await assert.rejects(opening, (error) => error.publicCode === 'DATABASE_QUERY_CANCELLED')
})

test('un failure di apertura viene sanitizzato, pulito e consente un nuovo tentativo', async () => {
  const workspacePath = '/workspace/remote-opening-recovery'
  const connectionId = 'postgres-recovery'
  const handles = []
  const closeCalls = new Map()
  let attempts = 0
  const driverPort = fakeDriverPort({
    closeRemoteSession: async (handle) => closeCalls.set(handle, (closeCalls.get(handle) ?? 0) + 1),
    openRemoteSession: async (_config, { onCandidate }) => {
      attempts += 1
      const handle = Object.freeze({})
      handles.push(handle)
      onCandidate(handle)
      if (attempts === 1) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND private-db.internal password=opening-secret'), { code: 'ENOTFOUND' })
      }
      return handle
    },
  })
  const runtime = createDatabaseSessionRuntime({
    getConnectionWithSecrets: () => ({
      database: 'app',
      driver: 'postgres',
      host: 'db.internal',
      password: 'secret',
      port: 5432,
      user: 'developer',
    }),
    invalidateSchema: () => undefined,
    invalidateWorkspaceSchema: () => undefined,
  })
  runtime.configureRuntime({
    createSqliteWorkerSession: () => undefined,
    driverPort,
    sqliteWorkerDiagnostics: () => ({ activeWorkers: 0, pendingRequests: 0 }),
  })

  await assert.rejects(runtime.getSession(workspacePath, connectionId), (error) => (
    error.publicCode === 'DATABASE_NETWORK_HOST_UNREACHABLE'
    && !error.message.includes('private-db.internal')
    && !error.databaseDiagnostic.includes('opening-secret')
  ))
  assert.equal(closeCalls.get(handles[0]), 1)

  const recovered = await runtime.getSession(workspacePath, connectionId)
  assert.equal(recovered.handle, handles[1])
  assert.equal('client' in recovered, false)
  assert.equal(attempts, 2)
  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(closeCalls.get(handles[1]), 1)
})

test('due runtime remoti isolano stessa chiave, single-flight, close in apertura, code e failure lifecycle', async () => {
  const workspacePath = '/workspace/runtime-isolation'
  const connectionId = 'postgres-shared-key'
  const key = `${workspacePath}\u0000${connectionId}`
  const firstOpeningGate = deferred()
  const firstCandidateReady = deferred()

  function createRuntimeHarness(label, { gateFirstOpening = false } = {}) {
    const closeCalls = new Map()
    const closeWaiters = new Map()
    const failureListeners = new Map()
    const handles = []
    const invalidated = []
    let openCalls = 0
    const driverPort = fakeDriverPort({
      closeRemoteSession: async (handle) => {
        closeCalls.set(handle, (closeCalls.get(handle) ?? 0) + 1)
        closeWaiters.get(handle)?.resolve()
      },
      openRemoteSession: async (_config, { onCandidate }) => {
        openCalls += 1
        const handle = Object.freeze({ label, ordinal: openCalls })
        handles.push(handle)
        closeWaiters.set(handle, deferred())
        onCandidate(handle)
        if (gateFirstOpening && openCalls === 1) {
          firstCandidateReady.resolve()
          await firstOpeningGate.promise
        }
        return handle
      },
      subscribeRemoteFailure: (handle, listener) => {
        failureListeners.set(handle, listener)
        return () => {
          if (failureListeners.get(handle) === listener) failureListeners.delete(handle)
        }
      },
    })
    const runtime = createDatabaseSessionRuntime({
      getConnectionWithSecrets: () => ({
        database: 'app',
        driver: 'postgres',
        host: 'db.internal',
        password: 'secret',
        port: 5432,
        user: 'developer',
      }),
      invalidateSchema: (candidate) => invalidated.push(candidate),
      invalidateWorkspaceSchema: () => undefined,
    })
    runtime.configureRuntime({
      createSqliteWorkerSession: () => undefined,
      driverPort,
      sqliteWorkerDiagnostics: () => ({ activeWorkers: 0, pendingRequests: 0 }),
    })
    return {
      closeCalls,
      closeWaiters,
      fail(handle, error) {
        const listener = failureListeners.get(handle)
        assert.equal(typeof listener, 'function')
        listener({ error, event: 'error' })
      },
      failureListeners,
      handles,
      invalidated,
      openCalls: () => openCalls,
      runtime,
    }
  }

  const first = createRuntimeHarness('first', { gateFirstOpening: true })
  const second = createRuntimeHarness('second')
  const firstOpening = first.runtime.getSession(workspacePath, connectionId)
  const sameFirstOpening = first.runtime.getSession(workspacePath, connectionId)
  const firstOpeningRejected = Promise.all([
    assert.rejects(firstOpening, (error) => error.publicCode === 'DATABASE_QUERY_CANCELLED'),
    assert.rejects(sameFirstOpening, (error) => error.publicCode === 'DATABASE_QUERY_CANCELLED'),
  ])
  await firstCandidateReady.promise
  assert.equal(first.openCalls(), 1)

  const [secondSession, sameSecondSession] = await Promise.all([
    second.runtime.getSession(workspacePath, connectionId),
    second.runtime.getSession(workspacePath, connectionId),
  ])
  assert.equal(secondSession, sameSecondSession)
  assert.equal(second.openCalls(), 1)
  assert.notEqual(secondSession.handle, first.handles[0])

  const closingFirstOpening = first.runtime.closeConnectionSession(workspacePath, connectionId)
  await first.closeWaiters.get(first.handles[0]).promise
  assert.equal(first.closeCalls.get(first.handles[0]), 1)
  assert.equal(second.closeCalls.size, 0)
  assert.equal(await second.runtime.getSession(workspacePath, connectionId), secondSession)
  firstOpeningGate.resolve()
  await closingFirstOpening
  await firstOpeningRejected

  const [firstSession, sameFirstSession] = await Promise.all([
    first.runtime.getSession(workspacePath, connectionId),
    first.runtime.getSession(workspacePath, connectionId),
  ])
  assert.equal(firstSession, sameFirstSession)
  assert.equal(first.openCalls(), 2)
  assert.notEqual(firstSession, secondSession)

  const queuedOperation = deferred()
  firstSession.remoteOperationQueue = queuedOperation.promise
  first.fail(
    firstSession.handle,
    Object.assign(new Error('socket hang up password=runtime-secret'), { code: 'ECONNRESET' }),
  )
  await assert.rejects(first.runtime.getSession(workspacePath, connectionId), (error) => (
    error.publicCode === 'DATABASE_NETWORK_CONNECTION_LOST'
    && !error.databaseDiagnostic.includes('runtime-secret')
  ))
  assert.equal(await second.runtime.getSession(workspacePath, connectionId), secondSession)
  assert.deepEqual(first.invalidated, [key, key])
  assert.deepEqual(second.invalidated, [])

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(first.closeCalls.get(firstSession.handle), undefined)
  const closingSecond = second.runtime.closeConnectionSession(workspacePath, connectionId)
  await second.closeWaiters.get(secondSession.handle).promise
  await closingSecond
  assert.equal(second.closeCalls.get(secondSession.handle), 1)
  assert.equal(first.closeCalls.get(firstSession.handle), undefined)

  queuedOperation.resolve()
  await first.closeWaiters.get(firstSession.handle).promise
  const recoveredFirst = await first.runtime.getSession(workspacePath, connectionId)
  assert.equal(first.openCalls(), 3)
  assert.notEqual(recoveredFirst, firstSession)
  assert.equal(first.failureListeners.has(firstSession.handle), false)
  await first.runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(first.closeCalls.get(recoveredFirst.handle), 1)
})

test('disposal e force-close conservano stato non enumerabile sulla singola sessione', async () => {
  const closeGate = deferred()
  let closeCalls = 0
  const disposalSession = {
    driverPort: fakeDriverPort({
      closeRemoteSession: async () => {
        closeCalls += 1
        await closeGate.promise
      },
    }),
    handle: Object.freeze({}),
  }
  const disposalKeys = Object.keys(disposalSession)
  const firstDisposal = disposeRemoteSession(disposalSession)
  assert.equal(disposeRemoteSession(disposalSession), firstDisposal)
  assert.deepEqual(Object.keys(disposalSession), disposalKeys)
  closeGate.resolve()
  await firstDisposal
  assert.equal(closeCalls, 1)

  let forceCloseCalls = 0
  const forcedSession = {
    driverPort: fakeDriverPort({ forceCloseRemoteSession: () => { forceCloseCalls += 1 } }),
    handle: Object.freeze({}),
  }
  const forcedKeys = Object.keys(forcedSession)
  forceCloseRemoteSession(forcedSession)
  forceCloseRemoteSession(forcedSession)
  assert.deepEqual(Object.keys(forcedSession), forcedKeys)
  assert.equal(forceCloseCalls, 1)
})
