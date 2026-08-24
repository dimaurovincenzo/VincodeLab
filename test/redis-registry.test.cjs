const assert = require('node:assert/strict')
const test = require('node:test')

const { createRedisOperationRegistry } = require('../electron/domains/redis/redis-operation-registry.cjs')
const { RedisSessionInvalidatedError, createRedisSessionRegistry } = require('../electron/domains/redis/redis-session-registry.cjs')

const operationId = '11111111-1111-4111-8111-111111111111'

test('il registry operazioni Redis isola owner e attende il drain', async () => {
  const registry = createRedisOperationRegistry({ cleanupTimeoutMs: 100 })
  const operation = registry.start({ operationId, senderId: 7, workspacePath: '/workspace-a', connectionId: 'redis-1' })

  assert.deepEqual(registry.cancel(operationId, 8), { cancelled: false, mutative: false })
  const drain = registry.abortWorkspace('/workspace-a')
  assert.equal(operation.signal.aborted, true)
  operation.finish()
  assert.deepEqual(await drain, { cancelled: 1 })
  assert.deepEqual(registry.diagnostics(), { activeOperations: 0 })
})

test('il registry sessioni chiude un candidato invalidato durante connect', async () => {
  let release
  const connected = new Promise((resolve) => { release = resolve })
  const closed = []
  const registry = createRedisSessionRegistry({ closeSession: async (session) => { closed.push(session) } })
  const candidate = { id: 1 }
  const opening = registry.acquire('workspace\0connection', async ({ setCandidate }) => {
    setCandidate(candidate)
    await connected
    return candidate
  })
  await new Promise((resolve) => setImmediate(resolve))
  const closing = registry.close('workspace\0connection')
  release()

  await assert.rejects(opening, RedisSessionInvalidatedError)
  await closing
  assert.deepEqual(closed, [candidate])
})

test('il registry non dichiara chiusa una sessione quando falliscono cleanup graceful e forzato', async () => {
  let forceAttempts = 0
  const registry = createRedisSessionRegistry({
    cleanupTimeoutMs: 50,
    closeSession: async () => { throw new Error('quit failed') },
    forceCloseSession: async () => {
      forceAttempts += 1
      if (forceAttempts === 1) throw new Error('destroy failed')
    },
  })
  await registry.acquire('workspace\0connection', async () => ({ id: 1 }))

  await assert.rejects(
    registry.close('workspace\0connection'),
    (error) => error.code === 'REDIS_SESSION_CLEANUP_FAILED',
  )
  await assert.rejects(
    registry.acquire('workspace\0connection', async () => ({ id: 2 })),
    (error) => error.code === 'REDIS_SESSION_CLEANUP_FAILED',
  )
  await registry.close('workspace\0connection')
  assert.equal(forceAttempts, 2)
})
