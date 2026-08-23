const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/workspace-store.cjs')
const {
  clearHistory,
  configureDatabaseSecretStorage,
  createConnection,
  deleteConnection,
  getConnection,
  getConnectionWithSecrets,
  listConnections,
  listHistory,
  listSavedQueries,
  migrateLegacyConnectionSecrets,
  recordHistory,
  saveQuery,
  updateConnection,
} = require('../electron/database-store.cjs')

function testSecretStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`test:v1:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (value) => Buffer.from(Buffer.from(value).toString('utf8').slice('test:v1:'.length), 'base64').toString('utf8'),
  }
}

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-database-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  configureDatabaseSecretStorage(testSecretStorage())
  t.after(() => {
    closeDatabase()
    configureDatabaseSecretStorage(null)
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('isola connessioni e query salvate per workspace e applica la cascata', (t) => {
  withTemporaryDatabase(t)
  const connection = createConnection('/tmp/database-workspace-a', {
    name: 'Locale',
    driver: 'sqlite',
    sqlitePath: '/tmp/database-workspace-a/data.sqlite',
  })
  saveQuery('/tmp/database-workspace-a', { connectionId: connection.id, name: 'Elenco', sql: 'SELECT 1' })

  assert.equal(getConnection('/tmp/database-workspace-b', connection.id), null)
  assert.equal(listSavedQueries('/tmp/database-workspace-a', connection.id).length, 1)

  deleteConnection('/tmp/database-workspace-a', connection.id)
  assert.deepEqual(listSavedQueries('/tmp/database-workspace-a', connection.id), [])
})

test('pulisce solo la cronologia della connessione selezionata senza eliminare query salvate', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-history'
  const first = createConnection(workspace, { name: 'Prima', driver: 'sqlite', sqlitePath: '/tmp/first.sqlite' })
  const second = createConnection(workspace, { name: 'Seconda', driver: 'sqlite', sqlitePath: '/tmp/second.sqlite' })
  saveQuery(workspace, { connectionId: first.id, name: 'Query salvata', sql: 'SELECT 1' })
  recordHistory(workspace, { connectionId: first.id, sql: 'SELECT 1', durationMs: 2, affectedRows: null })
  recordHistory(workspace, { connectionId: second.id, sql: 'SELECT 2', durationMs: 3, affectedRows: null })

  assert.deepEqual(clearHistory(workspace, first.id), { deleted: 1 })
  assert.deepEqual(listHistory(workspace, first.id), [])
  assert.equal(listHistory(workspace, second.id).length, 1)
  assert.equal(listSavedQueries(workspace, first.id).length, 1)
})

test('separa e cifra la password senza inserirla nei DTO pubblici o nel config JSON', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-secret'
  const password = 'segreto-che-non-deve-uscire'
  const connection = createConnection(workspace, {
    name: 'Produzione',
    driver: 'postgres',
    host: 'db.internal',
    port: 5432,
    database: 'app',
    user: 'developer',
    password,
  })

  assert.equal(connection.hasPassword, true)
  assert.equal(Object.hasOwn(connection, 'password'), false)
  const publicConnection = getConnection(workspace, connection.id)
  assert.equal(publicConnection.hasPassword, true)
  assert.equal(Object.hasOwn(publicConnection, 'password'), false)
  assert.equal(Object.hasOwn(listConnections(workspace)[0], 'password'), false)
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, password)

  const row = getDatabase().prepare(`
    SELECT c.config_json, s.password_ciphertext
    FROM database_connections c
    JOIN database_connection_secrets s ON s.connection_id = c.id
    WHERE c.id = ?
  `).get(connection.id)
  assert.equal(Object.hasOwn(JSON.parse(row.config_json), 'password'), false)
  assert.equal(Buffer.from(row.password_ciphertext).includes(Buffer.from(password)), false)

  deleteConnection(workspace, connection.id)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM database_connection_secrets').get().total, 0)
})

test('un update vuoto conserva la password mentre un valore esplicito la sostituisce', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-secret-update'
  const base = { name: 'Remoto', driver: 'mysql', host: '127.0.0.1', port: 3306, database: 'app', user: 'user' }
  const connection = createConnection(workspace, { ...base, password: 'prima-password' })
  const ciphertextBefore = Buffer.from(getDatabase().prepare('SELECT password_ciphertext FROM database_connection_secrets WHERE connection_id = ?').get(connection.id).password_ciphertext)

  const preserved = updateConnection(workspace, connection.id, { ...base, name: 'Remoto rinominato', password: '' })
  const ciphertextPreserved = Buffer.from(getDatabase().prepare('SELECT password_ciphertext FROM database_connection_secrets WHERE connection_id = ?').get(connection.id).password_ciphertext)
  assert.equal(preserved.hasPassword, true)
  assert.deepEqual(ciphertextPreserved, ciphertextBefore)
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, 'prima-password')

  const replaced = updateConnection(workspace, connection.id, { ...base, password: 'seconda-password' })
  const ciphertextReplaced = Buffer.from(getDatabase().prepare('SELECT password_ciphertext FROM database_connection_secrets WHERE connection_id = ?').get(connection.id).password_ciphertext)
  assert.equal(replaced.hasPassword, true)
  assert.notDeepEqual(ciphertextReplaced, ciphertextBefore)
  assert.equal(getConnectionWithSecrets(workspace, connection.id).password, 'seconda-password')
  assert.equal(Object.hasOwn(replaced, 'password'), false)
})

test('rimuove il segreto quando una connessione remota diventa SQLite', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-secret-driver'
  const connection = createConnection(workspace, { name: 'Remoto', driver: 'mssql', host: 'db', port: 1433, database: 'app', user: 'user', password: 'secret' })

  const updated = updateConnection(workspace, connection.id, { name: 'Locale', driver: 'sqlite', sqlitePath: '/tmp/local.sqlite' })

  assert.equal(updated.hasPassword, false)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM database_connection_secrets WHERE connection_id = ?').get(connection.id).total, 0)
})

test('migra le password legacy in batch limitati e non le espone durante la migrazione', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-legacy'
  createConnection(workspace, { name: 'Schema', driver: 'sqlite', sqlitePath: '/tmp/schema.sqlite' })
  const database = getDatabase()
  const insert = database.prepare(`
    INSERT INTO database_connections (id, workspace_path, name, driver, config_json, created_at, updated_at)
    VALUES (?, ?, ?, 'postgres', ?, ?, ?)
  `)
  const ids = []
  for (let index = 0; index < 3; index += 1) {
    const id = crypto.randomUUID()
    ids.push(id)
    insert.run(id, workspace, `Legacy ${index}`, JSON.stringify({ host: 'db', port: 5432, database: 'app', user: 'user', password: `legacy-${index}` }), index + 1, index + 1)
  }

  const before = getConnection(workspace, ids[0])
  assert.equal(before.hasPassword, true)
  assert.equal(Object.hasOwn(before, 'password'), false)

  assert.deepEqual(migrateLegacyConnectionSecrets({ limit: 2 }), { processed: 2, migrated: 2, scrubbed: 2, remaining: true })
  assert.equal(database.prepare(`SELECT COUNT(*) AS total FROM database_connections WHERE json_type(config_json, '$.password') IS NOT NULL`).get().total, 1)
  assert.deepEqual(migrateLegacyConnectionSecrets({ limit: 2 }), { processed: 1, migrated: 1, scrubbed: 1, remaining: false })
  assert.equal(database.prepare(`SELECT COUNT(*) AS total FROM database_connections WHERE json_type(config_json, '$.password') IS NOT NULL`).get().total, 0)
  assert.equal(getConnectionWithSecrets(workspace, ids[2]).password, 'legacy-2')
})

test('il getter interno migra una singola credenziale legacy prima di decifrarla', (t) => {
  withTemporaryDatabase(t)
  const workspace = '/tmp/database-workspace-legacy-on-demand'
  createConnection(workspace, { name: 'Schema', driver: 'sqlite', sqlitePath: '/tmp/schema.sqlite' })
  const id = crypto.randomUUID()
  const config = { host: 'db', port: 5432, database: 'app', user: 'user', password: 'legacy-on-demand' }
  getDatabase().prepare(`
    INSERT INTO database_connections (id, workspace_path, name, driver, config_json, created_at, updated_at)
    VALUES (?, ?, 'Legacy', 'postgres', ?, 1, 1)
  `).run(id, workspace, JSON.stringify(config))

  assert.equal(getConnectionWithSecrets(workspace, id).password, config.password)
  const stored = getDatabase().prepare('SELECT config_json FROM database_connections WHERE id = ?').get(id)
  assert.equal(Object.hasOwn(JSON.parse(stored.config_json), 'password'), false)
})

test('non salva una password remota se safeStorage non è disponibile', (t) => {
  withTemporaryDatabase(t)
  configureDatabaseSecretStorage(testSecretStorage({ available: false }))

  assert.throws(() => createConnection('/tmp/database-workspace-unavailable', {
    name: 'Remoto',
    driver: 'postgres',
    host: 'db',
    port: 5432,
    database: 'app',
    user: 'user',
    password: 'non-salvare',
  }), (error) => {
    assert.equal(error.publicCode, 'DATABASE_SECURE_STORAGE_UNAVAILABLE')
    assert.match(error.publicMessage, /Sblocca il Portachiavi/u)
    assert.match(error.publicMessage, /connessione non è stata salvata/u)
    return true
  })
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS total FROM database_connections').get().total, 0)
})

test('richiede una password alla prima configurazione remota', (t) => {
  withTemporaryDatabase(t)
  assert.throws(() => createConnection('/tmp/database-workspace-password-required', {
    name: 'Remoto',
    driver: 'postgres',
    host: 'db',
    port: 5432,
    database: 'app',
    user: 'user',
    password: '',
  }), /Password non valida/)
})
