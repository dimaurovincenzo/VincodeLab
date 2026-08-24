const assert = require('node:assert/strict')
const test = require('node:test')

const { createDatabaseSessionRuntime } = require('../electron/domains/database/database-session-runtime.cjs')

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
