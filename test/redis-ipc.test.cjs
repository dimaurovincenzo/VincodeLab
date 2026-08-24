const assert = require('node:assert/strict')
const test = require('node:test')

const {
  REDIS_INVOKE_CHANNELS,
  createRedisHandlers,
  registerRedisIpc,
} = require('../electron/ipc/domains/redis.ipc.cjs')

function redisFixture(overrides = {}) {
  const calls = []
  const predicates = []
  const registrations = new Map()
  const operationSignal = { aborted: false, source: 'redis-registry' }
  let uuidSequence = 0
  const results = {
    connection: { id: 'redis-1', name: 'Cache locale' },
    connections: [{ id: 'redis-1', name: 'Cache locale' }],
    inspection: { key: { encoded: 'dXNlcjox', display: 'user:1' }, type: 'hash', entries: [] },
    page: {
      complete: false,
      items: [
        { key: { encoded: 'dXNlcjox', display: 'user:1' }, type: 'hash', ttlMs: 1_000 },
        { key: { binary: true, encoded: 'AAE=' }, type: 'string', ttlMs: null },
      ],
      nextCursor: '42',
      scanned: 250,
    },
    progress: { operationId: 'search-1', scanned: 50, matches: [{ key: { encoded: 'dXNlcjox' } }] },
    search: { cancelled: false, matches: [{ key: { encoded: 'dXNlcjox' } }], operationId: 'search-1', scanned: 100, truncated: false },
    test: { latencyMs: 12, ok: true, serverVersion: '7.4.2' },
  }
  const redisOperations = {
    abortAndWaitMatching(predicate) {
      calls.push(['abort-and-wait'])
      predicates.push(predicate)
      return Promise.resolve({ cancelled: 1 })
    },
    cancel(operationId, senderId) {
      calls.push(['cancel', operationId, senderId])
      return { cancelled: true, internal: 'not-public' }
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
    closeRedisConnectionSession: async (workspacePath, connectionId) => { calls.push(['close-session', workspacePath, connectionId]); return { closed: true } },
    createPublicError: (code, message) => {
      calls.push(['public-error', code, message])
      return Object.assign(new Error(message), { publicCode: code })
    },
    createRedisConnection: (workspacePath, input) => { calls.push(['create-connection', workspacePath, input]); return results.connection },
    deleteRedisConnection: (workspacePath, id) => { calls.push(['delete-connection', workspacePath, id]) },
    getRedisConnectionWithSecrets: (workspacePath, connectionId) => {
      calls.push(['get-secrets', workspacePath, connectionId])
      return { id: connectionId, password: 'stored-secret' }
    },
    listRedisConnections: (workspacePath) => { calls.push(['list-connections', workspacePath]); return results.connections },
    mergeRedisTestConnectionSecrets: (input, stored) => {
      calls.push(['merge-secrets', input, stored])
      return { ...input, password: stored.password }
    },
    randomUUID: () => {
      uuidSequence += 1
      const value = `uuid-${uuidSequence}`
      calls.push(['uuid', value])
      return value
    },
    readRedisKey: async (workspacePath, connectionId, key, options) => {
      calls.push(['read-key', workspacePath, connectionId, key, options])
      return results.inspection
    },
    redisInspectionForRenderer: (inspection) => {
      calls.push(['map-inspection', inspection])
      return { key: 'user:1', keyRef: inspection.key.encoded, type: inspection.type }
    },
    redisOperations,
    redisSearchForRenderer: (result) => {
      calls.push(['map-search', result])
      return { ...result, renderer: true }
    },
    redisSummaryForRenderer: (summary) => {
      calls.push(['map-summary', summary])
      return { key: summary.key.display ?? 'binary', keyRef: summary.key.encoded, type: summary.type }
    },
    requireActiveWorkspace: () => { calls.push(['require-workspace']); return '/workspace/current' },
    runWorkspaceMutation: (event, type, operation) => {
      calls.push(['workspace-mutation', event, type])
      return operation('/workspace/current')
    },
    scanRedisKeys: async (workspacePath, connectionId, options) => {
      calls.push(['scan-keys', workspacePath, connectionId, options])
      return results.page
    },
    searchRedisKeys: async (workspacePath, connectionId, input, onProgress) => {
      calls.push(['search-keys', workspacePath, connectionId, input])
      onProgress(results.progress)
      return results.search
    },
    sendToRenderer: (channel, payload) => { calls.push(['send-renderer', channel, payload]); return true },
    testRedisConnectionInput: async (input, options) => { calls.push(['test-connection', input, options]); return results.test },
    updateRedisConnection: (workspacePath, id, input) => { calls.push(['update-connection', workspacePath, id, input]); return results.connection },
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

test('registra una sola volta il manifesto completo dei 10 canali IPC Redis', () => {
  const fixture = redisFixture()
  const registration = registerRedisIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(REDIS_INVOKE_CHANNELS, [
    'redis:listConnections',
    'redis:createConnection',
    'redis:updateConnection',
    'redis:deleteConnection',
    'redis:testConnection',
    'redis:scanKeys',
    'redis:readKey',
    'redis:reconnect',
    'redis:searchPayloads',
    'redis:cancel',
  ])
  assert.deepEqual(registration.channels, REDIS_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], REDIS_INVOKE_CHANNELS)
  assert.equal(Object.isFrozen(REDIS_INVOKE_CHANNELS), true)
  assert.equal(Object.isFrozen(registration), true)
})

test('gli handler diretti verificano il sender prima di workspace, registry e servizi', async () => {
  const rejection = new Error('sender non attendibile')
  const asyncChannels = new Set(['redis:testConnection', 'redis:scanKeys', 'redis:readKey', 'redis:reconnect', 'redis:searchPayloads'])
  const argumentsByChannel = new Map([
    ['redis:listConnections', []],
    ['redis:testConnection', [{ host: 'localhost' }, undefined]],
    ['redis:scanKeys', ['redis-1', {}]],
    ['redis:readKey', ['redis-1', 'dXNlcjox', {}]],
    ['redis:reconnect', ['redis-1']],
    ['redis:searchPayloads', ['redis-1', { operationId: 'search-1' }]],
    ['redis:cancel', ['search-1']],
  ])

  for (const [channel, args] of argumentsByChannel) {
    const fixture = redisFixture({ assertTrustedSender: (event) => {
      fixture.calls.push(['guard', event])
      throw rejection
    } })
    const event = { sender: { id: 7 } }
    const handler = createRedisHandlers(fixture.dependencies).get(channel)
    const invoke = () => handler(event, ...args)
    if (asyncChannels.has(channel)) await assert.rejects(invoke, (error) => error === rejection)
    else assert.throws(invoke, (error) => error === rejection)
    assert.deepEqual(fixture.calls, [['guard', event]], channel)
  }
})

test('create, update e delete demandano guardia e workspace a runWorkspaceMutation', () => {
  const rejection = new Error('mutation rifiutata')
  const cases = [
    ['redis:createConnection', [{ name: 'Cache' }], 'redis:create-connection'],
    ['redis:updateConnection', ['redis-1', { name: 'Cache' }], 'redis:update-connection'],
    ['redis:deleteConnection', ['redis-1'], 'redis:delete-connection'],
  ]

  for (const [channel, args, expectedType] of cases) {
    const fixture = redisFixture({ runWorkspaceMutation: (event, type) => {
      fixture.calls.push(['workspace-mutation', event, type])
      throw rejection
    } })
    const event = { sender: { id: 9 } }
    const handler = createRedisHandlers(fixture.dependencies).get(channel)
    assert.throws(() => handler(event, ...args), (error) => error === rejection)
    assert.deepEqual(fixture.calls, [['workspace-mutation', event, expectedType]])
  }
})

test('list e create conservano workspace, argomenti e risultati pubblici', () => {
  const fixture = redisFixture()
  const handlers = createRedisHandlers(fixture.dependencies)
  const event = { sender: { id: 11 } }
  const input = { host: '127.0.0.1', name: 'Cache', port: 6379 }

  assert.equal(handlers.get('redis:listConnections')(event), fixture.results.connections)
  assert.equal(handlers.get('redis:createConnection')(event, input), fixture.results.connection)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['list-connections', '/workspace/current'],
    ['workspace-mutation', event, 'redis:create-connection'],
    ['create-connection', '/workspace/current', input],
  ])
})

test('update e delete drenano operazioni e sessione prima di mutare lo store', async () => {
  const event = { sender: { id: 13 } }
  const input = { name: 'Cache aggiornata' }
  const updateFixture = redisFixture()
  const updateHandler = createRedisHandlers(updateFixture.dependencies).get('redis:updateConnection')

  assert.equal(await updateHandler(event, 'redis-1', input), updateFixture.results.connection)
  assert.deepEqual(updateFixture.calls, [
    ['workspace-mutation', event, 'redis:update-connection'],
    ['abort-and-wait'],
    ['close-session', '/workspace/current', 'redis-1'],
    ['cleanup-deadline', 6_000, 'redis-connection-runtime'],
    ['update-connection', '/workspace/current', 'redis-1', input],
  ])
  assert.equal(updateFixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'redis-1' }), true)
  assert.equal(updateFixture.predicates[0]({ workspacePath: '/workspace/other', connectionId: 'redis-1' }), false)
  assert.equal(updateFixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'redis-2' }), false)

  const deleteFixture = redisFixture()
  const deleteHandler = createRedisHandlers(deleteFixture.dependencies).get('redis:deleteConnection')
  assert.deepEqual(await deleteHandler(event, 'redis-1'), { deleted: true })
  assert.deepEqual(deleteFixture.calls, [
    ['workspace-mutation', event, 'redis:delete-connection'],
    ['abort-and-wait'],
    ['close-session', '/workspace/current', 'redis-1'],
    ['cleanup-deadline', 6_000, 'redis-connection-runtime'],
    ['delete-connection', '/workspace/current', 'redis-1'],
  ])
})

test('testConnection usa un draft senza leggere segreti e chiude sempre il registry', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 17 } }
  const input = { host: 'localhost', password: 'draft-secret', port: 6379 }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:testConnection')

  assert.equal(await handler(event, input, undefined), fixture.results.test)
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['uuid', 'uuid-1'],
    ['operation-start', {
      operationId: 'uuid-1',
      senderId: 17,
      workspacePath: '/workspace/current',
      connectionId: 'draft',
    }],
    ['test-connection', input, { signal: fixture.operationSignal }],
    ['operation-finish'],
  ])

  const failure = new Error('timeout')
  const failedFixture = redisFixture({ testRedisConnectionInput: async () => { throw failure } })
  const failedHandler = createRedisHandlers(failedFixture.dependencies).get('redis:testConnection')
  await assert.rejects(() => failedHandler(event, input, undefined), (error) => error === failure)
  assert.equal(failedFixture.calls.at(-1)[0], 'operation-finish')
})

test('testConnection fonde i segreti salvati e normalizza una connessione scomparsa', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 19 } }
  const input = { host: 'redis.internal', password: '' }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:testConnection')

  assert.equal(await handler(event, input, 'redis-1'), fixture.results.test)
  const stored = { id: 'redis-1', password: 'stored-secret' }
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['get-secrets', '/workspace/current', 'redis-1'],
    ['merge-secrets', input, stored],
    ['uuid', 'uuid-1'],
    ['operation-start', {
      operationId: 'uuid-1',
      senderId: 19,
      workspacePath: '/workspace/current',
      connectionId: 'redis-1',
    }],
    ['test-connection', { ...input, password: 'stored-secret' }, { signal: fixture.operationSignal }],
    ['operation-finish'],
  ])

  let incident
  const missingFixture = redisFixture({
    createPublicError: (code, message) => {
      missingFixture.calls.push(['public-error', code, message])
      incident = Object.assign(new Error(message), { publicCode: code })
      return incident
    },
    getRedisConnectionWithSecrets: (workspacePath, connectionId) => {
      missingFixture.calls.push(['get-secrets', workspacePath, connectionId])
      return null
    },
  })
  const missingHandler = createRedisHandlers(missingFixture.dependencies).get('redis:testConnection')
  await assert.rejects(() => missingHandler(event, input, 'redis-missing'), (error) => error === incident)
  assert.deepEqual(missingFixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['get-secrets', '/workspace/current', 'redis-missing'],
    ['public-error', 'REDIS_CONNECTION_NOT_FOUND', 'La connessione Redis del workspace non è più disponibile. Aggiorna l’elenco e riprova.'],
  ])
})

test('scanKeys inoltra solo le opzioni ammesse, mappa le chiavi e chiude il registry', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 23 } }
  const input = { count: 250, cursor: '10', extra: 'ignored', match: 'user:*', type: 'hash' }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:scanKeys')

  assert.deepEqual(await handler(event, 'redis-1', input), {
    cursor: '42',
    keys: [
      { key: 'user:1', keyRef: 'dXNlcjox', type: 'hash' },
      { key: 'binary', keyRef: 'AAE=', type: 'string' },
    ],
    scanned: 250,
    hasMore: true,
  })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['uuid', 'uuid-1'],
    ['operation-start', { operationId: 'uuid-1', senderId: 23, workspacePath: '/workspace/current', connectionId: 'redis-1' }],
    ['scan-keys', '/workspace/current', 'redis-1', { cursor: '10', match: 'user:*', type: 'hash', count: 250, signal: fixture.operationSignal }],
    ['map-summary', fixture.results.page.items[0]],
    ['map-summary', fixture.results.page.items[1]],
    ['operation-finish'],
  ])
})

test('readKey mantiene il riferimento codificato, pagina l’ispezione e applica il mapper', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 29 } }
  const input = { count: 200, cursor: '5', ignored: true, offset: 20 }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:readKey')

  assert.deepEqual(await handler(event, 'redis-1', 'dXNlcjox', input), { key: 'user:1', keyRef: 'dXNlcjox', type: 'hash' })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['uuid', 'uuid-1'],
    ['operation-start', { operationId: 'uuid-1', senderId: 29, workspacePath: '/workspace/current', connectionId: 'redis-1' }],
    ['read-key', '/workspace/current', 'redis-1', { encoded: 'dXNlcjox' }, { cursor: '5', offset: 20, count: 200, signal: fixture.operationSignal }],
    ['map-inspection', fixture.results.inspection],
    ['operation-finish'],
  ])
})

test('reconnect attende drain e chiusura della sola connessione richiesta', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 31 } }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:reconnect')

  assert.deepEqual(await handler(event, 'redis-1'), { reconnected: true })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['abort-and-wait'],
    ['close-session', '/workspace/current', 'redis-1'],
  ])
  assert.equal(fixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'redis-1' }), true)
  assert.equal(fixture.predicates[0]({ workspacePath: '/workspace/current', connectionId: 'redis-2' }), false)
})

test('searchPayloads confina signal e progress, mappa il risultato e chiude sempre il registry', async () => {
  const fixture = redisFixture()
  const event = { sender: { id: 37 } }
  const input = {
    count: 100,
    ignored: true,
    keyPattern: 'user:*',
    keyRef: 'dXNlcjox',
    limit: 50,
    maxScanned: 1_000,
    operationId: 'search-1',
    query: 'Ada',
    type: 'hash',
  }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:searchPayloads')

  assert.deepEqual(await handler(event, 'redis-1', input), { ...fixture.results.search, renderer: true })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['require-workspace'],
    ['operation-start', { operationId: 'search-1', senderId: 37, workspacePath: '/workspace/current', connectionId: 'redis-1' }],
    ['search-keys', '/workspace/current', 'redis-1', {
      operationId: 'search-1',
      query: 'Ada',
      keyRef: 'dXNlcjox',
      keyPattern: 'user:*',
      type: 'hash',
      count: 100,
      limit: 50,
      maxScanned: 1_000,
      signal: fixture.operationSignal,
    }],
    ['map-search', fixture.results.progress],
    ['send-renderer', 'redis:searchProgress', { ...fixture.results.progress, renderer: true }],
    ['map-search', fixture.results.search],
    ['operation-finish'],
  ])

  const failure = new Error('connection lost')
  const failedFixture = redisFixture({ searchRedisKeys: async () => { throw failure } })
  const failedHandler = createRedisHandlers(failedFixture.dependencies).get('redis:searchPayloads')
  await assert.rejects(() => failedHandler(event, 'redis-1', input), (error) => error === failure)
  assert.equal(failedFixture.calls.at(-1)[0], 'operation-finish')
})

test('cancel usa l’owner renderer e non espone i dettagli interni del registry', () => {
  const fixture = redisFixture()
  const event = { sender: { id: 41 } }
  const handler = createRedisHandlers(fixture.dependencies).get('redis:cancel')

  assert.deepEqual(handler(event, 'search-1'), { cancelled: true })
  assert.deepEqual(fixture.calls, [
    ['guard', event],
    ['cancel', 'search-1', 41],
  ])
})
