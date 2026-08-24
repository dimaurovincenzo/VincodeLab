const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createRedisService: createRedisServiceFactory,
  encodedKey,
  keyBytes,
  normalizeRedisError,
  toRedisPublicError,
} = require('../electron/domains/redis/redis-service.cjs')
const { createRedisSessionRuntime } = require('../electron/domains/redis/redis-session-runtime.cjs')

function unavailableClientFactory() {
  throw Object.assign(new Error('Client Redis non previsto dal test.'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
}

function createRedisService(options = {}) {
  return createRedisServiceFactory({
    createClient: unavailableClientFactory,
    createSentinel: unavailableClientFactory,
    getConnectionWithSecrets: () => null,
    ...options,
  })
}

function fakeRedisClient() {
  const values = new Map([
    ['greeting', { type: 'string', value: 'hello bounded world', ttl: 900 }],
    ['profile', { type: 'hash', value: { name: 'Ada', role: 'developer' }, ttl: -1 }],
    ['queue', { type: 'list', value: ['first', 'second', 'third'], ttl: -1 }],
  ])
  const key = (value) => Buffer.isBuffer(value) ? value.toString() : String(value)
  return {
    isOpen: false,
    on() {}, off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async ping() { return 'PONG' },
    async scan(cursor, options) {
      const keys = [...values.keys()].filter((item) => options.MATCH === '*' || item.includes(options.MATCH.replaceAll('*', '')))
      return { cursor: '0', keys }
    },
    async type(value) { return values.get(key(value))?.type ?? 'none' },
    async pTTL(value) { return values.get(key(value))?.ttl ?? -2 },
    async memoryUsage(value) { return JSON.stringify(values.get(key(value))?.value ?? '').length },
    async get(value) { return values.get(key(value))?.value ?? null },
    async strLen(value) { return Buffer.byteLength(values.get(key(value))?.value ?? '') },
    async getRange(value, start, stop) { return Buffer.from(values.get(key(value))?.value ?? '').subarray(start, stop + 1) },
    async hScan(value) {
      return { cursor: '0', entries: Object.entries(values.get(key(value)).value).map(([field, entryValue]) => ({ field, value: entryValue })) }
    },
    async lRange(value, start, stop) { return values.get(key(value)).value.slice(start, stop + 1) },
    async lLen(value) { return values.get(key(value)).value.length },
  }
}

function service(options = {}) {
  const client = fakeRedisClient()
  return {
    client,
    api: createRedisService({
      createClient: () => client,
      getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0, password: 'private-password' }),
      ...options,
    }),
  }
}

test('SCAN restituisce riferimenti base64, tipo e TTL senza payload', async () => {
  const { api } = service()
  const page = await api.scanKeys('/workspace', 'connection', { count: 10 })

  assert.equal(page.complete, true)
  assert.equal(page.nextCursor, '0')
  assert.deepEqual(page.items[0].key, { encoded: Buffer.from('greeting').toString('base64'), display: 'greeting', binary: false })
  assert.equal(page.items[0].type, 'string')
  assert.equal(page.items[0].ttlMs, 900)
  assert.equal(page.items[0].ttlState, 'expires')
  assert.equal(Object.hasOwn(page.items[0], 'value'), false)
  await api.closeWorkspaceSessions('/workspace')
})

test('SCAN non perde gli elementi restituiti oltre il suggerimento COUNT', async () => {
  const client = fakeRedisClient()
  client.scan = async () => ({ cursor: '0', keys: ['greeting', 'profile', 'queue'] })
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  const page = await api.scanKeys('/workspace', 'connection', { count: 1 })

  assert.deepEqual(page.items.map((item) => item.key.display), ['greeting', 'profile', 'queue'])
  await api.closeWorkspaceSessions('/workspace')
})

test('la chiusura esplicita propaga il fallimento e consente di ritentare destroy', async () => {
  const client = fakeRedisClient()
  let destroyAttempts = 0
  client.quit = async () => { throw new Error('quit failed') }
  client.destroy = async () => {
    destroyAttempts += 1
    if (destroyAttempts < 3) throw new Error('destroy failed')
    client.isOpen = false
  }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  await api.scanKeys('/workspace', 'connection', { count: 1 })

  await assert.rejects(
    api.closeConnectionSession('/workspace', 'connection'),
    (error) => error.code === 'REDIS_SESSION_CLEANUP_FAILED',
  )
  await api.closeConnectionSession('/workspace', 'connection')
  assert.equal(destroyAttempts, 3)
})

test('la chiusura esplicita non accetta un destroy risolto che lascia il client aperto', async () => {
  const client = fakeRedisClient()
  client.quit = async () => { throw new Error('quit failed') }
  client.destroy = async () => undefined
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  await api.scanKeys('/workspace', 'connection', { count: 1 })

  await assert.rejects(
    api.closeConnectionSession('/workspace', 'connection'),
    (error) => error.code === 'REDIS_SESSION_CLEANUP_FAILED',
  )
  assert.equal(client.isOpen, true)
})

test('un destroy scaduto viene rimosso dal single-flight e il retry può chiudere la sessione', async () => {
  let destroyAttempts = 0
  const client = {
    isOpen: true,
    destroy() {
      destroyAttempts += 1
      if (destroyAttempts === 1) return new Promise(() => undefined)
      this.isOpen = false
      return undefined
    },
  }
  const runtime = createRedisSessionRuntime({
    cleanupTimeoutMs: 5,
    connectionTimeoutMs: 5,
    createClient: () => client,
    createSentinel: () => client,
    getConnectionWithSecrets: () => null,
  })

  await assert.rejects(runtime.forceDisposeSession(client), (error) => error.code === 'ETIMEDOUT')
  await runtime.forceDisposeSession(client)
  assert.equal(destroyAttempts, 2)
  assert.equal(client.isOpen, false)
})

test('una sessione ancora in connect viene forzata anche se il client non è ancora open', async () => {
  let destroyAttempts = 0
  const client = {
    isOpen: false,
    destroy() { destroyAttempts += 1 },
    off() {},
  }
  const runtime = createRedisSessionRuntime({
    cleanupTimeoutMs: 20,
    connectionTimeoutMs: 20,
    createClient: () => client,
    createSentinel: () => client,
    getConnectionWithSecrets: () => null,
  })

  await runtime.disposeSession({ client, connecting: true, errorListener() {} })
  assert.equal(destroyAttempts, 1)
})

test('testConnectionInput usa un client effimero e lo chiude senza consultare lo store', async () => {
  const client = fakeRedisClient()
  client.info = async () => '# Server\r\nredis_version:7.4.2\r\n'
  let storeReads = 0
  const api = createRedisService({
    createClient: (options) => {
      assert.equal(options.password, 'draft-secret')
      return client
    },
    getConnectionWithSecrets: () => { storeReads += 1; return null },
  })

  const result = await api.testConnectionInput({ host: '127.0.0.1', port: 6379, database: 0, password: 'draft-secret' })

  assert.equal(result.ok, true)
  assert.equal(result.serverVersion, '7.4.2')
  assert.equal(Number.isInteger(result.latencyMs), true)
  assert.equal(client.isOpen, false)
  assert.equal(storeReads, 0)
})

test('inoltra timeout e AbortSignal con il contratto node-redis corrente', async () => {
  const client = fakeRedisClient()
  const optionsSeen = []
  client.withCommandOptions = function withCommandOptions(options) { optionsSeen.push(options); return this }
  const controller = new AbortController()
  const api = createRedisService({ createClient: () => client, getConnectionWithSecrets: () => null })

  await api.testConnectionInput({ host: '127.0.0.1', port: 6379, database: 0 }, { signal: controller.signal })

  assert.ok(optionsSeen.some((options) => options.abortSignal === controller.signal && options.timeout === 10_000))
  assert.equal(optionsSeen.some((options) => Object.hasOwn(options, 'signal')), false)
})

test('annulla anche una connessione persistente ancora in apertura e consente il drain', async () => {
  const client = fakeRedisClient()
  let destroyed = false
  client.connect = () => new Promise(() => undefined)
  client.destroy = () => { destroyed = true; client.isOpen = false }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  const controller = new AbortController()
  const pending = api.scanKeys('/workspace', 'connection', { signal: controller.signal })
  await new Promise((resolve) => setImmediate(resolve))

  controller.abort()

  await assert.rejects(pending, (error) => error.publicCode === 'REDIS_OPERATION_CANCELLED')
  assert.equal(destroyed, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('Sentinel scopre il master nativamente senza dipendere da redis-cli', async () => {
  const client = fakeRedisClient()
  let sentinelOptions
  const api = createRedisService({
    createClient: () => { throw new Error('standalone non atteso') },
    createSentinel: (options) => { sentinelOptions = options; return client },
    getConnectionWithSecrets: () => ({
      mode: 'sentinel', host: 'sentinel.internal', port: 26379, sentinelMasterName: 'vincodelab-primary', database: 0, password: 'private-password',
    }),
  })

  const result = await api.testConnection('/workspace', 'connection')

  assert.equal(result.ok, true)
  assert.equal(sentinelOptions.name, 'vincodelab-primary')
  assert.deepEqual(sentinelOptions.sentinelRootNodes, [{ host: 'sentinel.internal', port: 26379 }])
  assert.equal(sentinelOptions.nodeClientOptions.password, 'private-password')
  assert.equal(sentinelOptions.sentinelClientOptions.password, undefined)
  assert.equal(sentinelOptions.nodeClientOptions.database, 0)
  assert.equal(sentinelOptions.replicaPoolSize, 0)
  assert.equal(sentinelOptions.maxCommandRediscovers, 1)
  assert.equal(sentinelOptions.passthroughClientErrorEvents, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('Sentinel mantiene separate le credenziali del discovery e del data node', async () => {
  const client = fakeRedisClient()
  let sentinelOptions
  const api = createRedisService({
    createSentinel: (options) => { sentinelOptions = options; return client },
    getConnectionWithSecrets: () => null,
  })

  await api.testConnectionInput({
    mode: 'sentinel', host: 'sentinel.internal', port: 26379, sentinelMasterName: 'vincodelab-primary', database: 0,
    username: 'data-user', password: 'data-password', sentinelUsername: 'discovery-user', sentinelPassword: 'discovery-password',
  })

  assert.equal(sentinelOptions.nodeClientOptions.username, 'data-user')
  assert.equal(sentinelOptions.nodeClientOptions.password, 'data-password')
  assert.equal(sentinelOptions.sentinelClientOptions.username, 'discovery-user')
  assert.equal(sentinelOptions.sentinelClientOptions.password, 'discovery-password')
})

test('Sentinel conserva la causa di autenticazione senza mostrare credenziali', async () => {
  const client = fakeRedisClient()
  let errorListener
  client.on = (event, listener) => { if (event === 'error') errorListener = listener }
  client.off = () => undefined
  client.connect = async () => {
    errorListener?.(new Error('WRONGPASS password=sentinel-secret'))
    throw new Error('None of the sentinels are available')
  }
  const api = createRedisService({ createSentinel: () => client, getConnectionWithSecrets: () => null })

  await assert.rejects(() => api.testConnectionInput({
    mode: 'sentinel', host: 'sentinel.internal', port: 26379, sentinelMasterName: 'vincodelab-primary', database: 0,
  }), (error) => {
    assert.equal(error.publicCode, 'REDIS_AUTHENTICATION_FAILED')
    assert.doesNotMatch(error.message, /sentinel-secret|WRONGPASS/u)
    return true
  })
})

test('Sentinel interrompe una connessione sospesa con un timeout recuperabile', async () => {
  const client = fakeRedisClient()
  let destroyed = false
  client.connect = () => new Promise(() => undefined)
  client.destroy = () => { destroyed = true; client.isOpen = false }
  const api = createRedisService({
    createSentinel: () => client,
    connectionTimeoutMs: 5,
    getConnectionWithSecrets: () => null,
  })

  await assert.rejects(() => api.testConnectionInput({
    mode: 'sentinel', host: 'sentinel.internal', port: 26379, sentinelMasterName: 'vincodelab-primary', database: 0,
  }), (error) => error.publicCode === 'REDIS_TIMEOUT')
  assert.equal(destroyed, true)
})

test('Sentinel classifica NOAUTH come autenticazione anche quando il timeout esterno chiude la connessione', async () => {
  const client = fakeRedisClient()
  let errorListener
  client.on = (event, listener) => { if (event === 'error') errorListener = listener }
  client.off = () => undefined
  client.connect = () => {
    errorListener?.(Object.assign(new Error('NOAUTH Authentication required'), { code: 'NOAUTH' }))
    return new Promise(() => undefined)
  }
  client.destroy = () => { client.isOpen = false }
  const api = createRedisService({
    createSentinel: () => client,
    connectionTimeoutMs: 5,
    getConnectionWithSecrets: () => null,
  })

  await assert.rejects(() => api.testConnectionInput({
    mode: 'sentinel', host: 'sentinel.internal', port: 26379, sentinelMasterName: 'vincodelab-primary', database: 0,
  }), (error) => error.publicCode === 'REDIS_AUTHENTICATION_FAILED' && error.redisKind === 'authentication')
})

test('una causa di autenticazione prevale sul wrapper di timeout senza esporre il dettaglio tecnico', () => {
  const cause = Object.assign(new Error('WRONGPASS password=private-sentinel-secret'), { code: 'WRONGPASS' })
  const error = Object.assign(new Error('redis_connection_timeout', { cause }), { code: 'ETIMEDOUT' })

  const normalized = normalizeRedisError(error, { phase: 'connection' })
  const publicError = toRedisPublicError(error, { phase: 'connection' })

  assert.equal(normalized.code, 'REDIS_AUTHENTICATION_FAILED')
  assert.equal(normalized.kind, 'authentication')
  assert.doesNotMatch(normalized.diagnostic, /private-sentinel-secret/u)
  assert.doesNotMatch(publicError.message, /private-sentinel-secret|WRONGPASS/u)
})

test('chiude in modo bounded anche un QUIT sospeso dopo il test connessione', async () => {
  const client = fakeRedisClient()
  let destroyed = false
  client.quit = () => new Promise(() => undefined)
  client.destroy = () => { destroyed = true; client.isOpen = false }
  const api = createRedisService({
    createClient: () => client,
    cleanupTimeoutMs: 5,
    getConnectionWithSecrets: () => null,
  })

  const result = await api.testConnectionInput({ host: '127.0.0.1', port: 6379, database: 0 })

  assert.equal(result.ok, true)
  assert.equal(destroyed, true)
})

test('attende la destroy asincrona Sentinel prima di completare il drain', async () => {
  const client = fakeRedisClient()
  let destroyFinished = false
  client.quit = () => new Promise(() => undefined)
  client.destroy = () => new Promise((resolve) => setImmediate(() => {
    destroyFinished = true
    client.isOpen = false
    resolve()
  }))
  const api = createRedisService({
    createClient: () => client,
    cleanupTimeoutMs: 5,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  await api.scanKeys('/workspace', 'connection')

  await api.closeWorkspaceSessions('/workspace')

  assert.equal(destroyFinished, true)
})

test('una cancellazione nei metadati non viene trasformata in uno SCAN riuscito', async () => {
  const client = fakeRedisClient()
  const cancelled = Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
  client.pTTL = async () => { throw cancelled }
  client.memoryUsage = async () => { throw cancelled }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  await assert.rejects(() => api.scanKeys('/workspace', 'connection'), (error) => error.publicCode === 'REDIS_OPERATION_CANCELLED')
  await api.closeWorkspaceSessions('/workspace')
})

test('un segnale già annullato non chiude una sessione condivisa sana', async () => {
  const client = fakeRedisClient()
  let quitCalls = 0
  client.quit = async () => { quitCalls += 1; client.isOpen = false }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  await api.scanKeys('/workspace', 'connection')
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(() => api.scanKeys('/workspace', 'connection', { signal: controller.signal }), (error) => error.publicCode === 'REDIS_OPERATION_CANCELLED')
  assert.equal(quitCalls, 0)
  await api.closeWorkspaceSessions('/workspace')
})

test('readKey legge per tipo, pagina e applica un budget in byte', async () => {
  const { api } = service()
  const greeting = await api.readKey('/workspace', 'connection', encodedKey('greeting'))
  const profile = await api.readKey('/workspace', 'connection', encodedKey('profile'))
  const queue = await api.readKey('/workspace', 'connection', encodedKey('queue'), { count: 2 })

  assert.equal(greeting.type, 'string')
  assert.equal(greeting.value, 'hello bounded world')
  assert.equal(greeting.truncated, false)
  assert.equal(greeting.previewBytes, Buffer.byteLength('hello bounded world'))
  assert.equal(greeting.totalBytes, Buffer.byteLength('hello bounded world'))
  assert.deepEqual(profile.entries, [{ field: 'name', value: 'Ada' }, { field: 'role', value: 'developer' }])
  assert.deepEqual(queue.items, [{ index: 0, value: 'first' }, { index: 1, value: 'second' }])
  assert.equal(queue.hasMore, true)

  const limited = service({ resultByteLimit: 8, resultItemByteLimit: 8 })
  await assert.rejects(() => limited.api.readKey('/workspace', 'connection', encodedKey('greeting')), (error) => error.publicCode === 'REDIS_RESULT_TOO_LARGE')
  await api.closeWorkspaceSessions('/workspace')
  await limited.api.closeWorkspaceSessions('/workspace')
})

test('le stringhe grandi usano STRLEN e GETRANGE senza caricare il valore completo', async () => {
  const client = fakeRedisClient()
  let getCalls = 0
  let range
  client.type = async () => 'string'
  client.memoryUsage = async () => 2_000_000
  client.strLen = async () => 2_000_000
  client.get = async () => { getCalls += 1; throw new Error('GET non deve essere usato') }
  client.getRange = async (_key, start, stop) => {
    range = { start, stop }
    return Buffer.alloc(stop - start + 1, 97)
  }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
    resultByteLimit: 400_000,
    resultItemByteLimit: 300_000,
  })

  const result = await api.readKey('/workspace', 'connection', encodedKey('large'))

  assert.equal(getCalls, 0)
  assert.deepEqual(range, { start: 0, stop: 262_143 })
  assert.equal(result.value.length, 262_144)
  assert.equal(result.totalBytes, 2_000_000)
  assert.equal(result.previewBytes, 262_144)
  assert.equal(result.truncated, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('JSON non viene materializzato quando Redis nega il preflight della dimensione', async () => {
  const client = fakeRedisClient()
  let jsonReads = 0
  client.type = async () => 'json'
  client.memoryUsage = async () => { throw new Error('NOPERM memory usage') }
  client.json = { get: async () => { jsonReads += 1; return { private: 'payload' } } }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  await assert.rejects(() => api.readKey('/workspace', 'connection', encodedKey('document')), (error) => error.publicCode === 'REDIS_SIZE_UNAVAILABLE')
  assert.equal(jsonReads, 0)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca payload è read-only, limitata e segnala operationId', async () => {
  const { api } = service()
  const progress = []
  const result = await api.searchKeys('/workspace', 'connection', {
    operationId: '11111111-1111-4111-8111-111111111111', query: 'developer', limit: 2,
  }, (snapshot) => progress.push(snapshot))

  assert.equal(result.operationId, '11111111-1111-4111-8111-111111111111')
  assert.equal(result.cancelled, false)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].type, 'hash')
  assert.ok(progress.length > 0)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca di una chiave contestuale usa il keyRef esatto senza glob SCAN', async () => {
  const client = fakeRedisClient()
  client.scan = async () => { throw new Error('SCAN non deve essere usato') }
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId: '22222222-2222-4222-8222-222222222222', query: 'hello', keyRef: encodedKey('greeting').encoded,
  })

  assert.equal(result.scanned, 1)
  assert.equal(result.matches[0].key.encoded, encodedKey('greeting').encoded)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca salta payload oltre preflight e continua con risultati parziali', async () => {
  const client = fakeRedisClient()
  client.scan = async () => ({ cursor: '0', keys: ['profile', 'greeting'] })
  client.memoryUsage = async (value) => (Buffer.isBuffer(value) ? value.toString() : String(value)) === 'profile' ? 9 * 1_024 * 1_024 : 128
  const api = createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId: '33333333-3333-4333-8333-333333333333', query: 'hello',
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].key.display, 'greeting')
  assert.equal(result.truncated, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('sanitizza gli errori Redis e valida rigorosamente le chiavi base64', () => {
  const error = Object.assign(new Error('WRONGPASS user private-user password=hunter2 redis://private:secret@10.0.0.1:6379'), { code: 'WRONGPASS' })
  const normalized = normalizeRedisError(error, { phase: 'connection' })
  const publicError = toRedisPublicError(error, { phase: 'connection' })

  assert.equal(normalized.code, 'REDIS_AUTHENTICATION_FAILED')
  assert.doesNotMatch(normalized.diagnostic, /hunter2|private-user|secret|10\.0\.0\.1/u)
  assert.doesNotMatch(publicError.message, /hunter2|private-user|secret|10\.0\.0\.1/u)
  assert.throws(() => keyBytes({ encoded: 'not base64!' }), /redis_input_invalid/u)
})
