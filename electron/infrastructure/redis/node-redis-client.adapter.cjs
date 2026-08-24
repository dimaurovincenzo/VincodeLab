function createNodeRedisClientAdapter({ loadRedis = () => require('redis') } = {}) {
  if (typeof loadRedis !== 'function') throw new TypeError('Loader node-redis non valido.')

  function withBinaryTypeMapping(client, redis) {
    // SCAN deve conservare anche chiavi non UTF-8. Con RESP3 il mapping a
    // Buffer evita conversioni lossy; i DTO renderer vengono codificati base64.
    return typeof client?.withTypeMapping === 'function' && redis.RESP_TYPES?.BLOB_STRING !== undefined
      ? client.withTypeMapping({ [redis.RESP_TYPES.BLOB_STRING]: Buffer })
      : client
  }

  function createClient(options) {
    const redis = loadRedis()
    if (!redis || typeof redis.createClient !== 'function') throw new Error('node_redis_client_unavailable')
    return withBinaryTypeMapping(redis.createClient(options), redis)
  }

  function createSentinel(options) {
    const redis = loadRedis()
    if (!redis || typeof redis.createSentinel !== 'function') throw new Error('node_redis_sentinel_unavailable')
    return withBinaryTypeMapping(redis.createSentinel(options), redis)
  }

  return Object.freeze({ createClient, createSentinel })
}

const nodeRedisClientAdapter = createNodeRedisClientAdapter()

module.exports = { createNodeRedisClientAdapter, nodeRedisClientAdapter }
