const assert = require('node:assert/strict')
const test = require('node:test')

const { createDatabaseSessionRuntime } = require('../electron/domains/database/database-session-runtime.cjs')

function fakeDriverPort(overrides = {}) {
  const unused = () => { throw new Error('Driver non atteso nel test.') }
  return {
    createMssqlConnection: unused,
    createMysqlClient: unused,
    createPostgresClient: unused,
    executeRemote: unused,
    ...overrides,
  }
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
  const driverPort = fakeDriverPort({
    createPostgresClient: (config) => {
      openedConfigs.push(config)
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

  const session = await runtime.getSession(workspacePath, connectionId)

  assert.equal(session.client, client)
  assert.equal(session.driverPort, driverPort)
  assert.equal(client.connectCalls, 1)
  assert.deepEqual(openedConfigs, [{
    connectionTimeoutMillis: 10_000,
    database: 'app',
    host: 'db.internal',
    password: 'secret',
    port: 5432,
    query_timeout: 30_000,
    user: 'developer',
  }])

  await runtime.closeConnectionSession(workspacePath, connectionId)
  assert.equal(client.endCalls, 1)
})
