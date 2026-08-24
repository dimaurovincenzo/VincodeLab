const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { createDatabaseSessionRuntime } = require('../electron/domains/database/database-session-runtime.cjs')

function fakeDriverPort(overrides = {}) {
  const unused = () => { throw new Error('Driver non atteso nel test.') }
  return {
    executeRemote: unused,
    executeTransaction: unused,
    openRemoteSession: unused,
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
  const client = {
    connectCalls: 0,
    endCalls: 0,
    async connect() { this.connectCalls += 1 },
    async end() { this.endCalls += 1 },
    on() {},
    removeListener() {},
  }
  const openedConfigs = []
  const candidates = []
  let openCalls = 0
  const driverPort = fakeDriverPort({
    openRemoteSession: async (config, { onCandidate }) => {
      openCalls += 1
      openedConfigs.push(config)
      onCandidate(client)
      candidates.push(client)
      return client
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
  assert.equal(session.client, client)
  assert.equal(session.driverPort, driverPort)
  assert.equal(openCalls, 1)
  assert.deepEqual(candidates, [client])
  assert.deepEqual(openedConfigs, [{
    database: 'app',
    driver: 'postgres',
    host: 'db.internal',
    password: 'secret',
    port: 5432,
    user: 'developer',
  }])

  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(client.endCalls, 1)
})

test('il candidato remoto consente cleanup mentre openRemoteSession è ancora in corso', async () => {
  const workspacePath = '/workspace/remote-opening-cleanup'
  const connectionId = 'postgres-opening'
  const candidateReady = deferred()
  const connected = deferred()
  const closed = deferred()
  let openCalls = 0
  const client = {
    endCalls: 0,
    async end() {
      this.endCalls += 1
      closed.resolve()
    },
    on() {},
    removeListener() {},
  }
  const driverPort = fakeDriverPort({
    openRemoteSession: async (_config, { onCandidate }) => {
      openCalls += 1
      onCandidate(client)
      candidateReady.resolve()
      await connected.promise
      return client
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
  assert.equal(client.endCalls, 1)
  connected.resolve()
  await closing
  await assert.rejects(opening, (error) => error.publicCode === 'DATABASE_QUERY_CANCELLED')
})

test('un failure di apertura viene sanitizzato, pulito e consente un nuovo tentativo', async () => {
  const workspacePath = '/workspace/remote-opening-recovery'
  const connectionId = 'postgres-recovery'
  const clients = []
  let attempts = 0
  const driverPort = fakeDriverPort({
    openRemoteSession: async (_config, { onCandidate }) => {
      attempts += 1
      const client = new EventEmitter()
      client.endCalls = 0
      client.end = async () => { client.endCalls += 1 }
      clients.push(client)
      onCandidate(client)
      if (attempts === 1) {
        throw Object.assign(new Error('getaddrinfo ENOTFOUND private-db.internal password=opening-secret'), { code: 'ENOTFOUND' })
      }
      return client
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
  assert.equal(clients[0].endCalls, 1)

  const recovered = await runtime.getSession(workspacePath, connectionId)
  assert.equal(recovered.client, clients[1])
  assert.equal(attempts, 2)
  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(clients[1].endCalls, 1)
})
