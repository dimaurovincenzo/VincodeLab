const assert = require('node:assert/strict')
const test = require('node:test')

const { mergeRedisTestConnectionSecrets } = require('../electron/domains/redis/redis-connection-input.cjs')

test('il test Sentinel preserva separatamente i segreti salvati quando i campi restano vuoti', () => {
  const merged = mergeRedisTestConnectionSecrets(
    { mode: 'sentinel', host: 'sentinel.internal', port: 26379, database: 0 },
    { password: 'data-secret', sentinelPassword: 'discovery-secret' },
  )

  assert.equal(merged.password, 'data-secret')
  assert.equal(merged.sentinelPassword, 'discovery-secret')
})

test('il cambio da Sentinel a standalone non reinietta il segreto del discovery', () => {
  const merged = mergeRedisTestConnectionSecrets(
    { mode: 'standalone', host: 'redis.internal', port: 6379, database: 0 },
    { password: 'data-secret', sentinelPassword: 'discovery-secret' },
  )

  assert.equal(merged.password, 'data-secret')
  assert.equal(Object.hasOwn(merged, 'sentinelPassword'), false)
})
