const assert = require('node:assert/strict')
const test = require('node:test')

const {
  DATABASE_INVOKE_CHANNELS,
  createDatabaseHandlers,
  registerDatabaseIpc,
} = require('../electron/ipc/domains/database.ipc.cjs')

function databaseFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const predicates = []
  const operationSignal = { aborted: false, source: 'registry' }
  const results = {
    begin: { transactionActive: true },
    clearHistory: { cleared: true },
    commit: { transactionActive: false },
    connected: { connected: true },
    connection: { id: 'connection-1', name: 'Local' },
    connections: [{ id: 'connection-1', name: 'Local' }],
    execute: { columns: ['id'], rows: [[1]] },
    history: [{ id: 'history-1' }],
    query: { id: 'query-1', name: 'Lista' },
    queries: [{ id: 'query-1', name: 'Lista' }],
    rollback: { transactionActive: false },
    routine: { name: 'public.refresh_cache', kind: 'procedure', definition: 'BEGIN END' },
    schema: { tables: [{ name: 'users' }] },
    tableRows: { rows: [{ id: 1 }, { id: 2 }], total: 2 },
    updatedRows: { updated: 1 },
  }
  const databaseOperations = {
    abortAndWaitMatching(predicate) {
      calls.push(['abort-and-wait'])
      predicates.push(predicate)
      return Promise.resolve({ cancelled: 1 })
    },
    cancel(operationId, senderId) {
      calls.push(['cancel', operationId, senderId])
      return { cancelled: true, mutative: false }
    },
    start(context) {
      calls.push(['operation-start', context])
      return {
        signal: operationSignal,
        finish: () => { calls.push(['operation-finish']); return true },
      }
    },
  }
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    beginTransaction: (workspacePath, id) => { calls.push(['begin', workspacePath, id]); return results.begin },
    classifySql: (sql) => { calls.push(['classify-sql', sql]); return { mutative: /^\s*(?:delete|insert|update)\b/iu.test(sql) } },
    clearHistory: (workspacePath, id) => { calls.push(['clear-history', workspacePath, id]); return results.clearHistory },
    closeConnectionSession: async (workspacePath, id) => { calls.push(['close-session', workspacePath, id]); return { closed: true } },
    commitTransaction: (workspacePath, id) => { calls.push(['commit', workspacePath, id]); return results.commit },
    createConnection: (workspacePath, input) => { calls.push(['create-connection', workspacePath, input]); return results.connection },
    databaseOperations,
    deleteConnection: (workspacePath, id) => { calls.push(['delete-connection', workspacePath, id]) },
    deleteSavedQuery: (workspacePath, id) => { calls.push(['delete-query', workspacePath, id]) },
    executeQuery: async (workspacePath, id, sql, options) => { calls.push(['execute', workspacePath, id, sql, options]); return results.execute },
    getApplicationErrorLogMetadata: (incident) => { calls.push(['error-metadata', incident]); return { correlationId: incident.correlationId } },
    inspectRoutine: (workspacePath, id, routineName, kind) => { calls.push(['inspect-routine', workspacePath, id, routineName, kind]); return results.routine },
    inspectSchema: (workspacePath, id, options) => { calls.push(['inspect-schema', workspacePath, id, options]); return results.schema },
    listConnections: (workspacePath) => { calls.push(['list-connections', workspacePath]); return results.connections },
    listHistory: (workspacePath, id, limit) => { calls.push(['list-history', workspacePath, id, limit]); return results.history },
    listSavedQueries: (workspacePath, id) => { calls.push(['list-queries', workspacePath, id]); return results.queries },
    log: (...args) => { calls.push(['log', ...args]) },
    openConnection: (workspacePath, id) => { calls.push(['connect', workspacePath, id]); return results.connected },
    readTableRows: async (workspacePath, id, tableName, options) => { calls.push(['table-rows', workspacePath, id, tableName, options]); return results.tableRows },
    requireActiveWorkspace: () => { calls.push(['require-workspace']); return '/workspace/current' },
    rollbackTransaction: (workspacePath, id) => { calls.push(['rollback', workspacePath, id]); return results.rollback },
    runWorkspaceMutation: (event, type, operation) => {
      calls.push(['workspace-mutation', event, type])
      return operation('/workspace/current')
    },
    saveQuery: (workspacePath, input) => { calls.push(['save-query', workspacePath, input]); return results.query },
    toApplicationError: (error, context) => {
      calls.push(['to-application-error', error, context])
      return Object.assign(new Error('Database non disponibile'), { correlationId: 'ERR-DB', severity: 'error' })
    },
    updateConnection: (workspacePath, id, input) => { calls.push(['update-connection', workspacePath, id, input]); return results.connection },
    updateSavedQuery: (workspacePath, id, input) => { calls.push(['update-query', workspacePath, id, input]); return results.query },
    updateTableRows: (workspacePath, id, tableName, changes) => { calls.push(['update-table-rows', workspacePath, id, tableName, changes]); return results.updatedRows },
    withCleanupDeadline: async (promise, timeoutMs, label) => {
      calls.push(['cleanup-deadline', timeoutMs, label])
      return promise
    },
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, operationSignal, predicates, registrations, results }
}

test('registra una sola volta il manifesto completo dei 20 canali IPC Database', () => {
  const fixture = databaseFixture()
  const registration = registerDatabaseIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(DATABASE_INVOKE_CHANNELS, [
    'database:listConnections',
    'database:createConnection',
    'database:updateConnection',
    'database:deleteConnection',
    'database:connect',
    'database:execute',
    'database:cancel',
    'database:begin',
    'database:commit',
    'database:rollback',
    'database:inspectSchema',
    'database:inspectRoutine',
    'database:tableRows',
    'database:updateTableRows',
    'database:listSavedQueries',
    'database:saveQuery',
    'database:updateSavedQuery',
    'database:deleteSavedQuery',
    'database:listHistory',
    'database:clearHistory',
  ])
  assert.deepEqual(registration.channels, DATABASE_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], DATABASE_INVOKE_CHANNELS)
})

test('gli handler diretti verificano il sender prima di workspace e servizi', async () => {
  const rejection = new Error('sender non attendibile')
  const asyncChannels = new Set(['database:execute', 'database:tableRows'])
  const argumentsByChannel = new Map([
    ['database:listConnections', []],
    ['database:createConnection', [{}]],
    ['database:connect', ['connection-1']],
    ['database:execute', ['connection-1', 'SELECT 1', { operationId: 'operation-1' }]],
    ['database:cancel', ['operation-1']],
    ['database:inspectSchema', ['connection-1', {}]],
    ['database:inspectRoutine', ['connection-1', 'public.refresh_cache', 'procedure']],
    ['database:tableRows', ['connection-1', 'users', {}]],
    ['database:listSavedQueries', ['connection-1']],
    ['database:saveQuery', [{}]],
    ['database:updateSavedQuery', ['query-1', {}]],
    ['database:deleteSavedQuery', ['query-1']],
    ['database:listHistory', ['connection-1', 50]],
    ['database:clearHistory', ['connection-1']],
  ])

  for (const [channel, args] of argumentsByChannel) {
    const fixture = databaseFixture({ assertTrustedSender: (event) => {
      fixture.calls.push(['guard', event])
      throw rejection
    } })
    const event = { sender: { id: 7 } }
    const handler = createDatabaseHandlers(fixture.dependencies).get(channel)
    const invoke = () => handler(event, ...args)
    if (asyncChannels.has(channel)) await assert.rejects(invoke, (error) => error === rejection)
    else assert.throws(invoke, (error) => error === rejection)
    assert.deepEqual(fixture.calls, [['guard', event]], channel)
  }
})

test('le mutation demandano guardia, owner e workspace a runWorkspaceMutation', () => {
  const rejection = new Error('mutation rifiutata')
  const mutationArguments = new Map([
    ['database:updateConnection', ['connection-1', {}]],
    ['database:deleteConnection', ['connection-1']],
    ['database:begin', ['connection-1']],
    ['database:commit', ['connection-1']],
    ['database:rollback', ['connection-1']],
    ['database:updateTableRows', ['connection-1', 'users', []]],
  ])

  for (const [channel, args] of mutationArguments) {
    const fixture = databaseFixture({ runWorkspaceMutation: (event, type) => {
      fixture.calls.push(['workspace-mutation', event, type])
      throw rejection
    } })
    const event = { sender: { id: 9 } }
    const handler = createDatabaseHandlers(fixture.dependencies).get(channel)
    assert.throws(() => handler(event, ...args), (error) => error === rejection)
    assert.equal(fixture.calls.length, 1, channel)
    assert.deepEqual(fixture.calls[0].slice(0, 2), ['workspace-mutation', event], channel)
  }
})

test('inoltra letture, query salvate e history preservando workspace, argomenti e risultati', () => {
  const fixture = databaseFixture()
  const handlers = createDatabaseHandlers(fixture.dependencies)
  const event = { sender: { id: 11 } }
  const connectionInput = { name: 'Local', driver: 'sqlite' }
  const schemaOptions = { force: true, offset: 50, limit: 50 }
  const queryInput = { connectionId: 'connection-1', name: 'Lista', sql: 'SELECT 1' }
  const queryUpdate = { name: 'Lista aggiornata' }

  assert.equal(handlers.get('database:listConnections')(event), fixture.results.connections)
  assert.equal(handlers.get('database:createConnection')(event, connectionInput), fixture.results.connection)
  assert.equal(handlers.get('database:connect')(event, 'connection-1'), fixture.results.connected)
  assert.equal(handlers.get('database:inspectSchema')(event, 'connection-1', schemaOptions), fixture.results.schema)
  assert.equal(handlers.get('database:inspectRoutine')(event, 'connection-1', 'public.refresh_cache', 'procedure'), fixture.results.routine)
  assert.equal(handlers.get('database:listSavedQueries')(event, 'connection-1'), fixture.results.queries)
  assert.equal(handlers.get('database:saveQuery')(event, queryInput), fixture.results.query)
  assert.equal(handlers.get('database:updateSavedQuery')(event, 'query-1', queryUpdate), fixture.results.query)
  assert.deepEqual(handlers.get('database:deleteSavedQuery')(event, 'query-1'), { deleted: true })
  assert.equal(handlers.get('database:listHistory')(event, 'connection-1', 25), fixture.results.history)
  assert.equal(handlers.get('database:clearHistory')(event, 'connection-1'), fixture.results.clearHistory)

  assert.deepEqual(fixture.calls, [
    ['guard', event], ['require-workspace'], ['list-connections', '/workspace/current'],
    ['guard', event], ['require-workspace'], ['create-connection', '/workspace/current', connectionInput],
    ['guard', event], ['require-workspace'], ['connect', '/workspace/current', 'connection-1'],
    ['guard', event], ['require-workspace'], ['inspect-schema', '/workspace/current', 'connection-1', schemaOptions],
    ['guard', event], ['require-workspace'], ['inspect-routine', '/workspace/current', 'connection-1', 'public.refresh_cache', 'procedure'],
    ['guard', event], ['require-workspace'], ['list-queries', '/workspace/current', 'connection-1'],
    ['guard', event], ['require-workspace'], ['save-query', '/workspace/current', queryInput],
    ['guard', event], ['require-workspace'], ['update-query', '/workspace/current', 'query-1', queryUpdate],
    ['guard', event], ['require-workspace'], ['delete-query', '/workspace/current', 'query-1'],
    ['guard', event], ['require-workspace'], ['list-history', '/workspace/current', 'connection-1', 25],
    ['guard', event], ['require-workspace'], ['clear-history', '/workspace/current', 'connection-1'],
  ])
})

test('updateConnection drena le operazioni e chiude la sessione prima di aggiornare', async () => {
  const fixture = databaseFixture()
  const event = { sender: { id: 13 } }
  const input = { name: 'Aggiornata' }
  const handler = createDatabaseHandlers(fixture.dependencies).get('database:updateConnection')

  assert.equal(await handler(event, 'connection-1', input), fixture.results.connection)
  assert.deepEqual(fixture.calls, [
    ['workspace-mutation', event, 'database:update-connection'],
    ['abort-and-wait'],
    ['close-session', '/workspace/current', 'connection-1'],
    ['cleanup-deadline', 6_000, 'database-connection-runtime'],
    ['update-connection', '/workspace/current', 'connection-1', input],
  ])
  assert.equal(fixture.predicates.length, 1)
  assert.equal(fixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'connection-1' }), true)
  assert.equal(fixture.predicates[0]({ workspacePath: '/workspace/other', connectionId: 'connection-1' }), false)
  assert.equal(fixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'connection-2' }), false)
})

test('deleteConnection completa il cleanup, elimina e restituisce il contratto pubblico', async () => {
  const fixture = databaseFixture()
  const event = { sender: { id: 15 } }
  const handler = createDatabaseHandlers(fixture.dependencies).get('database:deleteConnection')

  assert.deepEqual(await handler(event, 'connection-1'), { deleted: true })
  assert.deepEqual(fixture.calls, [
    ['workspace-mutation', event, 'database:delete-connection'],
    ['abort-and-wait'],
    ['close-session', '/workspace/current', 'connection-1'],
    ['cleanup-deadline', 6_000, 'database-connection-runtime'],
    ['delete-connection', '/workspace/current', 'connection-1'],
  ])
})

test('begin, commit, rollback e updateTableRows conservano registry type e callback', () => {
  const fixture = databaseFixture()
  const handlers = createDatabaseHandlers(fixture.dependencies)
  const event = { sender: { id: 17 } }
  const changes = [{ row: 0, values: { name: 'Ada' } }]

  assert.equal(handlers.get('database:begin')(event, 'connection-1'), fixture.results.begin)
  assert.equal(handlers.get('database:commit')(event, 'connection-1'), fixture.results.commit)
  assert.equal(handlers.get('database:rollback')(event, 'connection-1'), fixture.results.rollback)
  assert.equal(handlers.get('database:updateTableRows')(event, 'connection-1', 'users', changes), fixture.results.updatedRows)
  assert.deepEqual(fixture.calls, [
    ['workspace-mutation', event, 'database:begin'], ['begin', '/workspace/current', 'connection-1'],
    ['workspace-mutation', event, 'database:commit'], ['commit', '/workspace/current', 'connection-1'],
    ['workspace-mutation', event, 'database:rollback'], ['rollback', '/workspace/current', 'connection-1'],
    ['workspace-mutation', event, 'database:update-table-rows'], ['update-table-rows', '/workspace/current', 'connection-1', 'users', changes],
  ])
})

test('execute registra mutatività e owner, sostituisce il signal e chiude sempre l’operazione', async () => {
  const fixture = databaseFixture()
  const event = { sender: { id: 23 } }
  const options = { operationId: 'operation-1', rowLimit: 100, signal: 'renderer-signal' }
  const handler = createDatabaseHandlers(fixture.dependencies).get('database:execute')

  assert.equal(await handler(event, 'connection-1', 'UPDATE users SET active = 1', options), fixture.results.execute)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['classify-sql', 'UPDATE users SET active = 1'],
    ['operation-start', {
      operationId: 'operation-1',
      senderId: 23,
      workspacePath: '/workspace/current',
      connectionId: 'connection-1',
      mutative: true,
    }],
    ['execute', '/workspace/current', 'connection-1', 'UPDATE users SET active = 1', { rowLimit: 100, signal: fixture.operationSignal }],
    ['operation-finish'],
  ])

  const failure = new Error('query interrotta')
  const failedFixture = databaseFixture({ executeQuery: async () => { throw failure } })
  const failedHandler = createDatabaseHandlers(failedFixture.dependencies).get('database:execute')
  await assert.rejects(() => failedHandler(event, 'connection-1', 'SELECT 1', { operationId: 'operation-2' }), (error) => error === failure)
  assert.equal(failedFixture.calls.at(-1)[0], 'operation-finish')
})

test('cancel confina la richiesta all’owner renderer e conserva il risultato del registry', () => {
  const fixture = databaseFixture()
  const event = { sender: { id: 29 } }
  const handler = createDatabaseHandlers(fixture.dependencies).get('database:cancel')

  assert.deepEqual(handler(event, 'operation-1'), { cancelled: true, mutative: false })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['cancel', 'operation-1', 29],
  ])
})

test('tableRows registra il numero righe e normalizza soltanto il percorso di errore', async () => {
  const fixture = databaseFixture()
  const event = { sender: { id: 31 } }
  const options = { limit: 50, offset: 100 }
  const handler = createDatabaseHandlers(fixture.dependencies).get('database:tableRows')

  assert.equal(await handler(event, 'connection-1', 'users', options), fixture.results.tableRows)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['table-rows', '/workspace/current', 'connection-1', 'users', options],
    ['log', 'info', 'database_table_rows_read', { rows: 2 }],
  ])

  const failure = new Error('driver failed')
  let incident
  const failedFixture = databaseFixture({
    readTableRows: async () => { throw failure },
    toApplicationError: (error, context) => {
      failedFixture.calls.push(['to-application-error', error, context])
      incident = Object.assign(new Error('Tabella non leggibile'), { correlationId: 'ERR-TABLE', severity: 'warning' })
      return incident
    },
  })
  const failedHandler = createDatabaseHandlers(failedFixture.dependencies).get('database:tableRows')
  await assert.rejects(() => failedHandler(event, 'connection-1', 'users', options), (error) => error === incident)
  assert.deepEqual(failedFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['to-application-error', failure, { channel: 'database:tableRows' }],
    ['error-metadata', incident],
    ['log', 'warning', 'database_table_rows_failed', { correlationId: 'ERR-TABLE' }],
  ])
})
