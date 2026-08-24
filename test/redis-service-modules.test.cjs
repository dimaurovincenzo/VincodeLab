const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const servicePath = require.resolve('../electron/domains/redis/redis-service.cjs')
const sessionRuntimePath = require.resolve('../electron/domains/redis/redis-session-runtime.cjs')
const readServicePath = require.resolve('../electron/domains/redis/redis-read-service.cjs')
const searchServicePath = require.resolve('../electron/domains/redis/redis-search-service.cjs')
const adapterPath = require.resolve('../electron/infrastructure/redis/node-redis-client.adapter.cjs')
const mainPath = require.resolve('../electron/main.cjs')

test('il service Redis resta un orchestratore e il dominio non carica node-redis o infrastructure', () => {
  const service = readFileSync(servicePath, 'utf8')
  const domainSources = [servicePath, sessionRuntimePath, readServicePath, searchServicePath]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')

  assert.ok(service.split('\n').length < 260, 'redis-service deve restare un orchestratore sotto 260 righe')
  assert.match(service, /createRedisSessionRuntime\(/u)
  assert.match(service, /createRedisReadService\(/u)
  assert.match(service, /createRedisSearchService\(/u)
  assert.doesNotMatch(domainSources, /require\(['"]redis['"]\)/u)
  assert.doesNotMatch(domainSources, /infrastructure\/redis/u)
  assert.match(readFileSync(adapterPath, 'utf8'), /require\(['"]redis['"]\)/u)
})

test('il modulo Redis espone solo factory e utility pure e il main compone una sola istanza', () => {
  const serviceSource = readFileSync(servicePath, 'utf8')
  const mainSource = readFileSync(mainPath, 'utf8')
  const redisService = require(servicePath)

  assert.deepEqual(Object.keys(redisService).sort(), [
    'REDIS_READ_LIMIT',
    'REDIS_SCAN_LIMIT',
    'REDIS_SEARCH_KEY_LIMIT',
    'REDIS_SEARCH_MATCH_LIMIT',
    'createRedisService',
    'encodedKey',
    'keyBytes',
    'normalizeRedisError',
    'sanitizeRedisDiagnostic',
    'sessionKey',
    'toRedisPublicError',
    'validateConnectionConfig',
  ])
  assert.doesNotMatch(serviceSource, /\b(?:redisPersistence|redisClientAdapter|defaultService|configureRedisPersistence|configureRedisClientAdapter)\b/u)
  assert.equal((mainSource.match(/\bcreateRedisService\(\{/gu) ?? []).length, 1)
  assert.match(mainSource, /createRedisService\(\{[\s\S]*?createClient: nodeRedisClientAdapter\.createClient,[\s\S]*?createSentinel: nodeRedisClientAdapter\.createSentinel,[\s\S]*?getConnectionWithSecrets: getRedisConnectionWithSecrets,[\s\S]*?\}\)/u)
  assert.doesNotMatch(mainSource, /\b(?:configureRedisPersistence|configureRedisClientAdapter)\b/u)
})

test('la factory esplicita conserva alias e test connessione senza caricare infrastructure nel dominio', async () => {
  const client = {
    isOpen: false,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async ping() { return 'PONG' },
    async info() { return 'redis_version:7.4.0\r\n' },
  }
  const { createRedisService } = require(servicePath)
  assert.throws(() => createRedisService(), /createClient Redis non valido/u)
  assert.throws(() => createRedisService({
    createClient: () => client,
  }), /createSentinel Redis non valido/u)
  assert.throws(() => createRedisService({
    createClient: () => client,
    createSentinel: () => client,
  }), /Store connessioni Redis non valido/u)
  const redisService = createRedisService({
    createClient: () => client,
    createSentinel: () => { throw new Error('Sentinel non atteso') },
    getConnectionWithSecrets: () => null,
  })

  const result = await redisService.testConnectionInput({ host: '127.0.0.1', port: 6379, database: 0 })

  assert.equal(result.ok, true)
  assert.equal(result.serverVersion, '7.4.0')
  assert.equal(client.isOpen, false)
  assert.equal(redisService.inspectKey, redisService.readKey)
  assert.equal(redisService.searchPayload, redisService.searchKeys)
  assert.equal(Object.isFrozen(redisService), true)
})

test('due servizi Redis mantengono sessioni indipendenti anche per la stessa chiave', async () => {
  const { createRedisService } = require(servicePath)
  const clients = ['primo', 'secondo'].map((owner) => ({
    owner,
    isOpen: false,
    pingCalls: 0,
    quitCalls: 0,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async ping() { this.pingCalls += 1; return 'PONG' },
    async quit() { this.quitCalls += 1; this.isOpen = false },
  }))
  const createService = (client) => createRedisService({
    createClient: () => client,
    createSentinel: () => { throw new Error('Sentinel non atteso') },
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })
  const first = createService(clients[0])
  const second = createService(clients[1])

  await first.testConnection('/workspace', 'shared-connection')
  await second.testConnection('/workspace', 'shared-connection')
  await first.closeConnectionSession('/workspace', 'shared-connection')

  assert.equal(clients[0].isOpen, false)
  assert.equal(clients[0].quitCalls, 1)
  assert.equal(clients[1].isOpen, true)
  assert.equal(clients[1].quitCalls, 0)
  assert.equal((await second.testConnection('/workspace', 'shared-connection')).ok, true)
  assert.equal(clients[1].pingCalls, 2)

  await second.closeConnectionSession('/workspace', 'shared-connection')
  assert.equal(clients[1].quitCalls, 1)
})
