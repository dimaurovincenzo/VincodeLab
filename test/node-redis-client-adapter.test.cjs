const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createNodeRedisClientAdapter,
} = require('../electron/infrastructure/redis/node-redis-client.adapter.cjs')

test('l adapter node-redis carica la dipendenza solo al primo client e conserva le opzioni', () => {
  const mappedClient = { name: 'mapped-client' }
  const rawClient = {
    withTypeMapping(mapping) {
      assert.deepEqual(mapping, { 7: Buffer })
      return mappedClient
    },
  }
  let loads = 0
  let optionsSeen
  const adapter = createNodeRedisClientAdapter({
    loadRedis: () => {
      loads += 1
      return {
        RESP_TYPES: { BLOB_STRING: 7 },
        createClient(options) { optionsSeen = options; return rawClient },
        createSentinel() { throw new Error('Sentinel non atteso') },
      }
    },
  })
  const options = { socket: { host: '127.0.0.1', port: 6379 } }

  assert.equal(loads, 0)
  assert.equal(adapter.createClient(options), mappedClient)
  assert.equal(loads, 1)
  assert.equal(optionsSeen, options)
})

test('l adapter node-redis applica il mapping binario anche a Sentinel', () => {
  const mappedClient = { name: 'mapped-sentinel' }
  const rawClient = { withTypeMapping: () => mappedClient }
  let optionsSeen
  const adapter = createNodeRedisClientAdapter({
    loadRedis: () => ({
      RESP_TYPES: { BLOB_STRING: 5 },
      createClient() { throw new Error('Standalone non atteso') },
      createSentinel(options) { optionsSeen = options; return rawClient },
    }),
  })
  const options = { name: 'primary', sentinelRootNodes: [{ host: 'sentinel', port: 26379 }] }

  assert.equal(adapter.createSentinel(options), mappedClient)
  assert.equal(optionsSeen, options)
})

test('l adapter rifiuta loader e implementazioni node-redis incomplete', () => {
  assert.throws(() => createNodeRedisClientAdapter({ loadRedis: null }), /Loader node-redis non valido/u)
  assert.throws(
    () => createNodeRedisClientAdapter({ loadRedis: () => ({}) }).createClient({}),
    /node_redis_client_unavailable/u,
  )
  assert.throws(
    () => createNodeRedisClientAdapter({ loadRedis: () => ({}) }).createSentinel({}),
    /node_redis_sentinel_unavailable/u,
  )
})
