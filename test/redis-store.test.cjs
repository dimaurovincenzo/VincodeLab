const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/workspace-store.cjs')
const {
  configureRedisSecretStorage,
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionWithSecrets,
  listConnections,
  updateConnection,
} = require('../electron/redis-store.cjs')

function secretStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`redis-test:${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => Buffer.from(Buffer.from(value).toString().slice('redis-test:'.length), 'base64').toString(),
  }
}

function temporaryStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-redis-store-'))
  const previous = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = directory
  configureRedisSecretStorage(secretStorage())
  t.after(() => {
    closeDatabase()
    configureRedisSecretStorage(null)
    if (previous === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previous
    fs.rmSync(directory, { recursive: true, force: true })
  })
}

test('salva connessioni Redis per workspace senza esporre la password', (t) => {
  temporaryStore(t)
  const workspace = '/tmp/redis-workspace-a'
  const password = 'redis-password-private'
  const connection = createConnection(workspace, {
    name: 'Cache locale', host: '127.0.0.1', port: 6379, database: 2, username: 'app', tls: true, password,
  })

  assert.equal(connection.hasPassword, true)
  assert.equal(Object.hasOwn(connection, 'password'), false)
  assert.equal(getConnection('/tmp/redis-workspace-b', connection.id), null)
  assert.equal(Object.hasOwn(listConnections(workspace)[0], 'password'), false)
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, password)

  const row = getDatabase().prepare(`
    SELECT c.config_json, s.password_ciphertext FROM redis_connections c
    JOIN redis_connection_secrets s ON s.connection_id = c.id WHERE c.id = ?
  `).get(connection.id)
  assert.equal(Object.hasOwn(JSON.parse(row.config_json), 'password'), false)
  assert.equal(Buffer.from(row.password_ciphertext).includes(Buffer.from(password)), false)

  deleteConnection(workspace, connection.id)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM redis_connection_secrets').get().total, 0)
})

test('conserva il segreto su update vuoto e non salva se safeStorage non è disponibile', (t) => {
  temporaryStore(t)
  const workspace = '/tmp/redis-workspace-update'
  const base = { name: 'Cache', host: 'redis.internal', port: 6380, database: 0, tls: true }
  const connection = createConnection(workspace, { ...base, password: 'prima-password' })

  updateConnection(workspace, connection.id, { ...base, name: 'Cache nuova', password: '' })
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, 'prima-password')

  const cleared = updateConnection(workspace, connection.id, { ...base, name: 'Cache senza password', clearPassword: true })
  assert.equal(cleared.hasPassword, false)
  assert.equal(Object.hasOwn(getConnectionWithSecrets(workspace, connection.id), 'password'), false)

  configureRedisSecretStorage(secretStorage({ available: false }))
  assert.throws(() => createConnection(workspace, { ...base, password: 'non-salvare' }), (error) => error.publicCode === 'REDIS_SECURE_STORAGE_UNAVAILABLE')
  assert.equal(listConnections(workspace).length, 1)
})

test('salva una connessione Sentinel con il nome master senza segreti nella configurazione pubblica', (t) => {
  temporaryStore(t)
  const workspace = '/tmp/redis-workspace-sentinel'
  const connection = createConnection(workspace, {
    name: 'Redis HA', mode: 'sentinel', host: 'sentinel.internal', port: 26379,
    sentinelMasterName: 'vincodelab-primary', database: 0,
    username: 'data-user', password: 'data-password', sentinelUsername: 'discovery-user', sentinelPassword: 'sentinel-password',
  })

  assert.equal(connection.mode, 'sentinel')
  assert.equal(connection.sentinelMasterName, 'vincodelab-primary')
  assert.equal(connection.sentinelUsername, 'discovery-user')
  assert.equal(connection.hasSentinelPassword, true)
  assert.equal(Object.hasOwn(connection, 'password'), false)
  assert.equal(Object.hasOwn(connection, 'sentinelPassword'), false)
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, 'data-password')
  assert.equal(getConnectionWithSecrets(workspace, connection.id).sentinelPassword, 'sentinel-password')

  const stored = getDatabase().prepare(`
    SELECT c.config_json, ss.password_ciphertext FROM redis_connections c
    JOIN redis_sentinel_secrets ss ON ss.connection_id = c.id WHERE c.id = ?
  `).get(connection.id)
  assert.equal(Object.hasOwn(JSON.parse(stored.config_json), 'sentinelPassword'), false)
  assert.equal(Buffer.from(stored.password_ciphertext).includes(Buffer.from('sentinel-password')), false)

  const cleared = updateConnection(workspace, connection.id, {
    name: 'Redis HA', mode: 'sentinel', host: 'sentinel.internal', port: 26379,
    sentinelMasterName: 'vincodelab-primary', database: 0, sentinelUsername: 'discovery-user', clearSentinelPassword: true,
  })
  assert.equal(cleared.hasSentinelPassword, false)
  assert.equal(Object.hasOwn(getConnectionWithSecrets(workspace, connection.id), 'sentinelPassword'), false)
  assert.throws(() => createConnection(workspace, {
    name: 'Sentinel incompleto', mode: 'sentinel', host: 'sentinel.internal', port: 26379, database: 0,
  }), /Nome master Sentinel/u)
})
