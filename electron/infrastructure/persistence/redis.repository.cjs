const crypto = require('node:crypto')
const path = require('node:path')
const { getDatabase } = require('./workspace.repository.cjs')
const { createPublicError, isPublicError } = require('../../domains/errors/public-error.cjs')

let redisSecretStorage = null

function hasControlCharacter(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function configureRedisSecretStorage(storage) {
  if (storage === null) {
    redisSecretStorage = null
    return
  }
  if (!storage || typeof storage.isEncryptionAvailable !== 'function'
    || typeof storage.encryptString !== 'function' || typeof storage.decryptString !== 'function') {
    throw new TypeError('Provider credenziali Redis non valido.')
  }
  redisSecretStorage = storage
}

function requireSecretStorage() {
  let available = false
  try { available = Boolean(redisSecretStorage?.isEncryptionAvailable()) } catch { /* Il dettaglio del keychain resta privato. */ }
  if (!available) throw createPublicError(
    'REDIS_SECURE_STORAGE_UNAVAILABLE',
    'Le credenziali Redis non possono essere protette in questo momento. Sblocca il Portachiavi, reinserisci la password e riprova.',
  )
  return redisSecretStorage
}

function encryptPassword(password) {
  try {
    const ciphertext = requireSecretStorage().encryptString(password)
    if (!Buffer.isBuffer(ciphertext) && !(ciphertext instanceof Uint8Array)) throw new Error('invalid ciphertext')
    return Buffer.from(ciphertext)
  } catch (error) {
    if (isPublicError(error)) throw error
    throw createPublicError('REDIS_CREDENTIAL_PROTECTION_FAILED', 'La password Redis non è stata salvata perché non è stato possibile proteggerla. Sblocca il Portachiavi e riprova.')
  }
}

function decryptPassword(ciphertext) {
  try {
    const password = requireSecretStorage().decryptString(Buffer.from(ciphertext))
    if (typeof password !== 'string' || !password || password.length > 4_096) throw new Error('invalid plaintext')
    return password
  } catch (error) {
    if (isPublicError(error)) throw error
    throw createPublicError('REDIS_CREDENTIAL_UNAVAILABLE', 'La password Redis salvata non può essere letta. Sblocca il Portachiavi oppure modifica la connessione.')
  }
}

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS redis_connections (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS redis_connections_workspace_order
      ON redis_connections(workspace_path, updated_at DESC);
    CREATE TABLE IF NOT EXISTS redis_connection_secrets (
      connection_id TEXT PRIMARY KEY NOT NULL REFERENCES redis_connections(id) ON DELETE CASCADE,
      password_ciphertext BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS redis_sentinel_secrets (
      connection_id TEXT PRIMARY KEY NOT NULL REFERENCES redis_connections(id) ON DELETE CASCADE,
      password_ciphertext BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function assertWorkspacePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 4_096) throw new Error('Workspace non valido.')
  return value
}

function assertId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw new Error('Connessione Redis non valida.')
  return value
}

function assertText(value, label, maxLength, { required = true } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || hasControlCharacter(value) || (required && !value.trim())) throw new Error(`${label} non valido.`)
  return required ? value.trim() : value
}

function assertPassword(value) {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > 4_096 || value.includes(String.fromCharCode(0))) throw new Error('Password Redis non valida.')
  return value
}

function validateConnectionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Connessione Redis non valida.')
  const name = assertText(input.name, 'Nome connessione Redis', 128)
  const mode = input.mode === undefined ? 'standalone' : input.mode
  if (mode !== 'standalone' && mode !== 'sentinel') throw new Error('Modalità Redis non valida.')
  const host = assertText(input.host, 'Host Redis', 255)
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) throw new Error('Porta Redis non valida.')
  const database = input.database === undefined ? 0 : input.database
  if (!Number.isInteger(database) || database < 0 || database > 65_535) throw new Error('Database Redis non valido.')
  const username = input.username === undefined || input.username === '' ? undefined : assertText(input.username, 'Utente Redis', 255)
  if (input.clearPassword !== undefined && typeof input.clearPassword !== 'boolean') throw new Error('Richiesta rimozione password Redis non valida.')
  if (input.clearPassword && input.password) throw new Error('Password Redis e richiesta di rimozione non possono essere usate insieme.')
  const sentinelMasterName = mode === 'sentinel'
    ? assertText(input.sentinelMasterName, 'Nome master Sentinel', 255)
    : undefined
  const sentinelUsername = mode === 'sentinel' && input.sentinelUsername
    ? assertText(input.sentinelUsername, 'Utente Sentinel', 255)
    : undefined
  if (input.clearSentinelPassword !== undefined && typeof input.clearSentinelPassword !== 'boolean') throw new Error('Richiesta rimozione password Sentinel non valida.')
  if (input.clearSentinelPassword && input.sentinelPassword) throw new Error('Password Sentinel e richiesta di rimozione non possono essere usate insieme.')
  if (mode !== 'sentinel' && (input.sentinelUsername || input.sentinelPassword)) throw new Error('Credenziali Sentinel non valide per la modalità selezionata.')
  if (input.tls !== undefined && typeof input.tls !== 'boolean') throw new Error('Configurazione TLS Redis non valida.')
  return {
    name,
    config: {
      mode,
      host,
      port: input.port,
      database,
      ...(sentinelMasterName ? { sentinelMasterName } : {}),
      ...(sentinelUsername ? { sentinelUsername } : {}),
      ...(username ? { username } : {}),
      ...(input.tls ? { tls: true } : {}),
    },
    password: assertPassword(input.password),
    clearPassword: Boolean(input.clearPassword),
    sentinelPassword: mode === 'sentinel' ? assertPassword(input.sentinelPassword) : null,
    clearSentinelPassword: mode !== 'sentinel' || Boolean(input.clearSentinelPassword),
  }
}

function parseConfig(value) {
  const config = JSON.parse(value)
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.hasOwn(config, 'password') || Object.hasOwn(config, 'sentinelPassword')) throw new Error('Configurazione Redis salvata non valida.')
  return config
}

function connectionFromRow(row) {
  if (!row) return null
  return { id: row.id, name: row.name, ...parseConfig(row.config_json), hasPassword: Boolean(row.password_ciphertext), hasSentinelPassword: Boolean(row.sentinel_password_ciphertext) }
}

function connectionRow(workspacePath, connectionId) {
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.config_json, s.password_ciphertext, ss.password_ciphertext AS sentinel_password_ciphertext
    FROM redis_connections c
    LEFT JOIN redis_connection_secrets s ON s.connection_id = c.id
    LEFT JOIN redis_sentinel_secrets ss ON ss.connection_id = c.id
    WHERE c.workspace_path = ? AND c.id = ?
  `).get(workspacePath, connectionId)
}

function getConnection(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId)
  ensureSchema()
  return connectionFromRow(connectionRow(workspacePath, connectionId))
}

function getConnectionWithSecrets(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId)
  ensureSchema()
  const row = connectionRow(workspacePath, connectionId)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    ...parseConfig(row.config_json),
    ...(row.password_ciphertext ? { password: decryptPassword(row.password_ciphertext) } : {}),
    ...(row.sentinel_password_ciphertext ? { sentinelPassword: decryptPassword(row.sentinel_password_ciphertext) } : {}),
  }
}

function listConnections(workspacePath) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.config_json, s.password_ciphertext, ss.password_ciphertext AS sentinel_password_ciphertext
    FROM redis_connections c
    LEFT JOIN redis_connection_secrets s ON s.connection_id = c.id
    LEFT JOIN redis_sentinel_secrets ss ON ss.connection_id = c.id
    WHERE c.workspace_path = ?
    ORDER BY c.updated_at DESC, c.created_at DESC
  `).all(workspacePath).map(connectionFromRow)
}

function createConnection(workspacePath, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  const connection = { id: crypto.randomUUID(), ...validateConnectionInput(input) }
  const passwordCiphertext = connection.password ? encryptPassword(connection.password) : null
  const sentinelPasswordCiphertext = connection.sentinelPassword ? encryptPassword(connection.sentinelPassword) : null
  const now = Date.now()
  const database = getDatabase()
  database.transaction(() => {
    database.prepare(`INSERT INTO redis_connections (id, workspace_path, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(connection.id, workspacePath, connection.name, JSON.stringify(connection.config), now, now)
    if (passwordCiphertext) database.prepare(`INSERT INTO redis_connection_secrets (connection_id, password_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(connection.id, passwordCiphertext, now, now)
    if (sentinelPasswordCiphertext) database.prepare(`INSERT INTO redis_sentinel_secrets (connection_id, password_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(connection.id, sentinelPasswordCiphertext, now, now)
  })()
  return { id: connection.id, name: connection.name, ...connection.config, hasPassword: Boolean(passwordCiphertext), hasSentinelPassword: Boolean(sentinelPasswordCiphertext) }
}

function updateConnection(workspacePath, connectionId, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId)
  ensureSchema()
  const connection = validateConnectionInput(input)
  const database = getDatabase()
  const existing = connectionRow(workspacePath, connectionId)
  if (!existing) throw new Error('Connessione Redis del workspace non trovata.')
  const passwordCiphertext = connection.password ? encryptPassword(connection.password) : null
  const sentinelPasswordCiphertext = connection.sentinelPassword ? encryptPassword(connection.sentinelPassword) : null
  const preservePassword = !connection.clearPassword && !passwordCiphertext && Boolean(existing.password_ciphertext)
  const preserveSentinelPassword = !connection.clearSentinelPassword && !sentinelPasswordCiphertext && Boolean(existing.sentinel_password_ciphertext)
  const now = Date.now()
  database.transaction(() => {
    database.prepare(`UPDATE redis_connections SET name = ?, config_json = ?, updated_at = ? WHERE workspace_path = ? AND id = ?`)
      .run(connection.name, JSON.stringify(connection.config), now, workspacePath, connectionId)
    if (passwordCiphertext) database.prepare(`
      INSERT INTO redis_connection_secrets (connection_id, password_ciphertext, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET password_ciphertext = excluded.password_ciphertext, updated_at = excluded.updated_at
    `).run(connectionId, passwordCiphertext, now, now)
    else if (connection.clearPassword) database.prepare('DELETE FROM redis_connection_secrets WHERE connection_id = ?').run(connectionId)
    if (sentinelPasswordCiphertext) database.prepare(`
      INSERT INTO redis_sentinel_secrets (connection_id, password_ciphertext, created_at, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(connection_id) DO UPDATE SET password_ciphertext = excluded.password_ciphertext, updated_at = excluded.updated_at
    `).run(connectionId, sentinelPasswordCiphertext, now, now)
    else if (connection.clearSentinelPassword) database.prepare('DELETE FROM redis_sentinel_secrets WHERE connection_id = ?').run(connectionId)
  })()
  return { id: connectionId, name: connection.name, ...connection.config, hasPassword: preservePassword || Boolean(passwordCiphertext), hasSentinelPassword: preserveSentinelPassword || Boolean(sentinelPasswordCiphertext) }
}

function deleteConnection(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId)
  ensureSchema()
  const result = getDatabase().prepare('DELETE FROM redis_connections WHERE workspace_path = ? AND id = ?').run(workspacePath, connectionId)
  if (!result.changes) throw new Error('Connessione Redis del workspace non trovata.')
}

module.exports = {
  configureRedisSecretStorage,
  createConnection,
  createRedisConnection: createConnection,
  deleteConnection,
  deleteRedisConnection: deleteConnection,
  getConnection,
  getRedisConnection: getConnection,
  getConnectionWithSecrets,
  getRedisConnectionWithSecrets: getConnectionWithSecrets,
  listConnections,
  listRedisConnections: listConnections,
  updateConnection,
  updateRedisConnection: updateConnection,
  validateConnectionInput,
}
