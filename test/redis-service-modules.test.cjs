const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

const servicePath = require.resolve('../electron/domains/redis/redis-service.cjs')
const sessionRuntimePath = require.resolve('../electron/domains/redis/redis-session-runtime.cjs')
const readServicePath = require.resolve('../electron/domains/redis/redis-read-service.cjs')
const searchServicePath = require.resolve('../electron/domains/redis/redis-search-service.cjs')
const adapterPath = require.resolve('../electron/infrastructure/redis/node-redis-client.adapter.cjs')

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

test('la configurazione esplicita conserva la superficie default senza import inversi', async () => {
  const client = {
    isOpen: false,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async ping() { return 'PONG' },
    async info() { return 'redis_version:7.4.0\r\n' },
  }
  const redisService = require(servicePath)
  redisService.configureRedisClientAdapter({
    createClient: () => client,
    createSentinel: () => { throw new Error('Sentinel non atteso') },
  })

  const result = await redisService.testConnectionInput({ host: '127.0.0.1', port: 6379, database: 0 })

  assert.equal(result.ok, true)
  assert.equal(result.serverVersion, '7.4.0')
  assert.equal(client.isOpen, false)
  assert.equal(redisService.inspectKey, redisService.readKey)
  assert.equal(redisService.searchPayload, redisService.searchKeys)
})
