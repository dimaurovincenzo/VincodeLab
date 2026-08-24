const crypto = require('node:crypto')
const path = require('node:path')
const { getDatabase } = require('./workspace.repository.cjs')
const { createPublicError, isPublicError } = require('../../domains/errors/public-error.cjs')

const DRIVERS = new Set(['sqlite', 'postgres', 'mysql', 'mssql'])
const REMOTE_DRIVERS = new Set(['postgres', 'mysql', 'mssql'])
const LEGACY_SECRET_MIGRATION_BATCH = 25
let databaseSecretStorage = null

function configureDatabaseSecretStorage(storage) {
  if (storage === null) {
    databaseSecretStorage = null
    return
  }
  if (!storage || typeof storage.isEncryptionAvailable !== 'function' || typeof storage.encryptString !== 'function' || typeof storage.decryptString !== 'function') {
    throw new TypeError('Provider credenziali database non valido.')
  }
  databaseSecretStorage = storage
}

function requireDatabaseSecretStorage() {
  let available = false
  try {
    available = Boolean(databaseSecretStorage?.isEncryptionAvailable())
  } catch {
    // Il dettaglio del portachiavi non deve attraversare l'IPC.
  }
  if (!available) throw createPublicError(
    'DATABASE_SECURE_STORAGE_UNAVAILABLE',
    'Le credenziali database non possono essere protette in questo momento. Sblocca il Portachiavi di macOS, reinserisci la password e riprova. La connessione non è stata salvata.',
  )
  return databaseSecretStorage
}

function encryptPassword(password) {
  try {
    const ciphertext = requireDatabaseSecretStorage().encryptString(password)
    if (!Buffer.isBuffer(ciphertext) && !(ciphertext instanceof Uint8Array)) throw new Error('invalid ciphertext')
    return Buffer.from(ciphertext)
  } catch (error) {
    if (isPublicError(error)) throw error
    throw createPublicError(
      'DATABASE_CREDENTIAL_PROTECTION_FAILED',
      'La password della connessione non è stata salvata perché non è stato possibile proteggerla. Sblocca il Portachiavi e riprova.',
    )
  }
}

function decryptPassword(ciphertext) {
  try {
    const password = requireDatabaseSecretStorage().decryptString(Buffer.from(ciphertext))
    if (typeof password !== 'string' || password.length === 0 || password.length > 4_096) throw new Error('invalid plaintext')
    return password
  } catch (error) {
    if (isPublicError(error)) throw error
    throw createPublicError(
      'DATABASE_CREDENTIAL_UNAVAILABLE',
      'La password salvata non può essere letta. Sblocca il Portachiavi oppure modifica la connessione e reinserisci la password.',
    )
  }
}

function ensureSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS database_connections (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      name TEXT NOT NULL,
      driver TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS database_connections_workspace_order
      ON database_connections(workspace_path, updated_at DESC);
    CREATE TABLE IF NOT EXISTS database_connection_secrets (
      connection_id TEXT PRIMARY KEY NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
      password_ciphertext BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS database_saved_queries (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sql TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS database_saved_queries_connection_order
      ON database_saved_queries(workspace_path, connection_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS database_query_history (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
      sql TEXT NOT NULL,
      executed_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      affected_rows INTEGER
    );
    CREATE INDEX IF NOT EXISTS database_query_history_connection_order
      ON database_query_history(workspace_path, connection_id, executed_at DESC);
  `)
}

function assertWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.length > 4_096) throw new Error('Workspace non valido.')
  return workspacePath
}

function assertId(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} non valido.`)
  return value
}

function assertText(value, label, maxLength, { required = true } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || (required && !value.trim())) throw new Error(`${label} non valido.`)
  return value
}

function parseConnectionConfig(configJson) {
  const config = JSON.parse(configJson)
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Configurazione connessione non valida.')
  return config
}

function configWithoutPassword(config) {
  const { password: _password, ...publicConfig } = config
  return publicConfig
}

function hasLegacyPassword(config) {
  return Object.prototype.hasOwnProperty.call(config, 'password')
}

function connectionFromRow(row) {
  if (!row) return null
  const config = parseConnectionConfig(row.config_json)
  return {
    ...configWithoutPassword(config),
    id: row.id,
    name: row.name,
    driver: row.driver,
    hasPassword: Boolean(row.password_ciphertext) || (typeof config.password === 'string' && config.password.length > 0),
  }
}

function assertPassword(value, { required }) {
  if (value === undefined || value === '') {
    if (required) throw new Error('Password non valida.')
    return null
  }
  if (typeof value !== 'string' || value.length > 4_096) throw new Error('Password non valida.')
  return value
}

function assertConnectionInput(input, { passwordRequired = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Connessione non valida.')
  const { name, driver } = input
  assertText(name, 'Nome connessione', 128)
  if (!DRIVERS.has(driver)) throw new Error('Driver non valido.')
  if (driver === 'sqlite') {
    const sqlitePath = assertText(input.sqlitePath, 'Percorso SQLite', 4_096)
    return { name: name.trim(), driver, config: { sqlitePath }, password: null }
  }
  const host = assertText(input.host, 'Host', 255).trim()
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) throw new Error('Porta non valida.')
  const database = assertText(input.database, 'Database', 255)
  const user = assertText(input.user, 'Utente', 255)
  const password = assertPassword(input.password, { required: passwordRequired })
  return { name: name.trim(), driver, config: { host, port: input.port, database, user }, password }
}

function getConnection(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  return connectionFromRow(getDatabase().prepare(`
    SELECT c.id, c.name, c.driver, c.config_json, s.password_ciphertext
    FROM database_connections c
    LEFT JOIN database_connection_secrets s ON s.connection_id = c.id
    WHERE c.workspace_path = ? AND c.id = ?
  `).get(workspacePath, assertId(connectionId, 'Connessione')))
}

function connectionRow(workspacePath, connectionId) {
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.driver, c.config_json, s.password_ciphertext
    FROM database_connections c
    LEFT JOIN database_connection_secrets s ON s.connection_id = c.id
    WHERE c.workspace_path = ? AND c.id = ?
  `).get(workspacePath, connectionId)
}

function getConnectionWithSecrets(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  ensureSchema()
  let row = connectionRow(workspacePath, connectionId)
  if (!row) return null
  let config = parseConnectionConfig(row.config_json)
  if (hasLegacyPassword(config)) {
    migrateLegacyConnectionSecrets({ connectionId, limit: 1 })
    row = connectionRow(workspacePath, connectionId)
    if (!row) return null
    config = parseConnectionConfig(row.config_json)
  }
  const connection = { ...configWithoutPassword(config), id: row.id, name: row.name, driver: row.driver }
  if (REMOTE_DRIVERS.has(row.driver) && row.password_ciphertext) connection.password = decryptPassword(row.password_ciphertext)
  return connection
}

function listConnections(workspacePath) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  return getDatabase().prepare(`
    SELECT c.id, c.name, c.driver, c.config_json, s.password_ciphertext
    FROM database_connections c
    LEFT JOIN database_connection_secrets s ON s.connection_id = c.id
    WHERE c.workspace_path = ? ORDER BY c.updated_at DESC, c.created_at DESC
  `).all(workspacePath).map(connectionFromRow)
}

function createConnection(workspacePath, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  ensureSchema()
  const connection = { id: crypto.randomUUID(), ...assertConnectionInput(input, { passwordRequired: input?.driver !== 'sqlite' }) }
  const passwordCiphertext = connection.password === null ? null : encryptPassword(connection.password)
  const now = Date.now()
  const database = getDatabase()
  database.transaction(() => {
    database.prepare(`
      INSERT INTO database_connections (id, workspace_path, name, driver, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(connection.id, workspacePath, connection.name, connection.driver, JSON.stringify(connection.config), now, now)
    if (passwordCiphertext) database.prepare(`
      INSERT INTO database_connection_secrets (connection_id, password_ciphertext, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(connection.id, passwordCiphertext, now, now)
  })()
  return { id: connection.id, name: connection.name, driver: connection.driver, ...connection.config, hasPassword: Boolean(passwordCiphertext) }
}

function updateConnection(workspacePath, connectionId, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  ensureSchema()
  const connection = assertConnectionInput(input)
  const database = getDatabase()
  const existing = connectionRow(workspacePath, connectionId)
  if (!existing) throw new Error('Connessione del workspace non trovata.')
  const existingConfig = parseConnectionConfig(existing.config_json)
  let passwordCiphertext = null
  let preservePassword = false
  if (REMOTE_DRIVERS.has(connection.driver)) {
    if (connection.password !== null) passwordCiphertext = encryptPassword(connection.password)
    else if (existing.password_ciphertext) preservePassword = true
    else if (typeof existingConfig.password === 'string' && existingConfig.password.length > 0) passwordCiphertext = encryptPassword(existingConfig.password)
    else throw new Error('Password non valida.')
  }
  const now = Date.now()
  database.transaction(() => {
    const result = database.prepare(`
      UPDATE database_connections SET name = ?, driver = ?, config_json = ?, updated_at = ?
      WHERE workspace_path = ? AND id = ?
    `).run(connection.name, connection.driver, JSON.stringify(connection.config), now, workspacePath, connectionId)
    if (result.changes === 0) throw new Error('Connessione del workspace non trovata.')
    if (connection.driver === 'sqlite') {
      database.prepare('DELETE FROM database_connection_secrets WHERE connection_id = ?').run(connectionId)
    } else if (passwordCiphertext) {
      database.prepare(`
        INSERT INTO database_connection_secrets (connection_id, password_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET password_ciphertext = excluded.password_ciphertext, updated_at = excluded.updated_at
      `).run(connectionId, passwordCiphertext, now, now)
    }
  })()
  return { id: connectionId, name: connection.name, driver: connection.driver, ...connection.config, hasPassword: preservePassword || Boolean(passwordCiphertext) }
}

function legacySecretCandidateWhere() {
  return `CASE WHEN json_valid(c.config_json) THEN json_type(c.config_json, '$.password') ELSE NULL END IS NOT NULL`
}

function migrateLegacyConnectionSecrets({ limit = LEGACY_SECRET_MIGRATION_BATCH, connectionId = null } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limite migrazione credenziali non valido.')
  if (connectionId !== null) connectionId = assertId(connectionId, 'Connessione')
  ensureSchema()
  const database = getDatabase()
  const idFilter = connectionId === null ? '' : 'AND c.id = ?'
  const parameters = connectionId === null ? [limit] : [connectionId, limit]
  const rows = database.prepare(`
    SELECT c.id, c.config_json, s.connection_id AS secret_connection_id
    FROM database_connections c
    LEFT JOIN database_connection_secrets s ON s.connection_id = c.id
    WHERE ${legacySecretCandidateWhere()} ${idFilter}
    ORDER BY c.created_at ASC
    LIMIT ?
  `).all(...parameters)
  const prepared = rows.map((row) => {
    const config = parseConnectionConfig(row.config_json)
    const password = typeof config.password === 'string' && config.password.length > 0 ? config.password : null
    return {
      ...row,
      configJson: JSON.stringify(configWithoutPassword(config)),
      passwordCiphertext: password && !row.secret_connection_id ? encryptPassword(password) : null,
    }
  })
  const now = Date.now()
  let migrated = 0
  let scrubbed = 0
  database.transaction(() => {
    for (const row of prepared) {
      // Il confronto sul JSON rende la migrazione sicura anche con due finestre:
      // una password aggiornata nel frattempo non viene rimpiazzata dal vecchio snapshot.
      const update = database.prepare(`
        UPDATE database_connections SET config_json = ?
        WHERE id = ? AND config_json = ?
      `).run(row.configJson, row.id, row.config_json)
      if (update.changes === 0) continue
      scrubbed += 1
      if (row.passwordCiphertext) {
        database.prepare(`
          INSERT INTO database_connection_secrets (connection_id, password_ciphertext, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(connection_id) DO NOTHING
        `).run(row.id, row.passwordCiphertext, now, now)
        migrated += 1
      }
    }
  })()
  const remainingParameters = connectionId === null ? [] : [connectionId]
  const remaining = Boolean(database.prepare(`
    SELECT 1 FROM database_connections c
    WHERE ${legacySecretCandidateWhere()} ${idFilter}
    LIMIT 1
  `).get(...remainingParameters))
  return { processed: rows.length, migrated, scrubbed, remaining }
}

function deleteConnection(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  ensureSchema()
  const result = getDatabase().prepare('DELETE FROM database_connections WHERE workspace_path = ? AND id = ?').run(workspacePath, connectionId)
  if (result.changes === 0) throw new Error('Connessione del workspace non trovata.')
}

function assertConnectionForWorkspace(workspacePath, connectionId) {
  const connection = getConnection(workspacePath, connectionId)
  if (!connection) throw new Error('Connessione del workspace non trovata.')
  return connection
}

function listSavedQueries(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  return getDatabase().prepare(`
    SELECT id, connection_id AS connectionId, name, sql, updated_at AS updatedAt
    FROM database_saved_queries WHERE workspace_path = ? AND connection_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `).all(workspacePath, connectionId)
}

function saveQuery(workspacePath, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Query salvata non valida.')
  const connectionId = assertId(input.connectionId, 'Connessione')
  assertConnectionForWorkspace(workspacePath, connectionId)
  const name = assertText(input.name, 'Nome query', 128).trim()
  const sql = assertText(input.sql, 'SQL', 65_536)
  const query = { id: crypto.randomUUID(), connectionId, name, sql }
  const now = Date.now()
  getDatabase().prepare(`
    INSERT INTO database_saved_queries (id, workspace_path, connection_id, name, sql, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(query.id, workspacePath, query.connectionId, query.name, query.sql, now, now)
  return { ...query, updatedAt: now }
}

function updateSavedQuery(workspacePath, queryId, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  queryId = assertId(queryId, 'Query salvata')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Query salvata non valida.')
  const name = assertText(input.name, 'Nome query', 128).trim()
  const sql = assertText(input.sql, 'SQL', 65_536)
  const result = getDatabase().prepare(`UPDATE database_saved_queries SET name = ?, sql = ?, updated_at = ? WHERE workspace_path = ? AND id = ?`).run(name, sql, Date.now(), workspacePath, queryId)
  if (result.changes === 0) throw new Error('Query salvata del workspace non trovata.')
  return { id: queryId, name, sql }
}

function deleteSavedQuery(workspacePath, queryId) {
  workspacePath = assertWorkspacePath(workspacePath)
  queryId = assertId(queryId, 'Query salvata')
  const result = getDatabase().prepare('DELETE FROM database_saved_queries WHERE workspace_path = ? AND id = ?').run(workspacePath, queryId)
  if (result.changes === 0) throw new Error('Query salvata del workspace non trovata.')
}

function recordHistory(workspacePath, input) {
  workspacePath = assertWorkspacePath(workspacePath)
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Cronologia query non valida.')
  const connectionId = assertId(input.connectionId, 'Connessione')
  assertConnectionForWorkspace(workspacePath, connectionId)
  const sql = assertText(input.sql, 'SQL', 65_536)
  if (!Number.isInteger(input.durationMs) || input.durationMs < 0) throw new Error('Durata query non valida.')
  const affectedRows = input.affectedRows === null || input.affectedRows === undefined ? null : input.affectedRows
  if (affectedRows !== null && (!Number.isInteger(affectedRows) || affectedRows < 0)) throw new Error('Righe coinvolte non valide.')
  const entry = { id: crypto.randomUUID(), connectionId, sql, executedAt: Date.now(), durationMs: input.durationMs, affectedRows }
  getDatabase().prepare(`
    INSERT INTO database_query_history (id, workspace_path, connection_id, sql, executed_at, duration_ms, affected_rows)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(entry.id, workspacePath, entry.connectionId, entry.sql, entry.executedAt, entry.durationMs, entry.affectedRows)
  return entry
}

function listHistory(workspacePath, connectionId, limit = 100) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limite cronologia non valido.')
  return getDatabase().prepare(`
    SELECT id, connection_id AS connectionId, sql, executed_at AS executedAt, duration_ms AS durationMs, affected_rows AS affectedRows
    FROM database_query_history WHERE workspace_path = ? AND connection_id = ?
    ORDER BY executed_at DESC LIMIT ?
  `).all(workspacePath, connectionId, limit)
}

function clearHistory(workspacePath, connectionId) {
  workspacePath = assertWorkspacePath(workspacePath)
  connectionId = assertId(connectionId, 'Connessione')
  assertConnectionForWorkspace(workspacePath, connectionId)
  const result = getDatabase().prepare('DELETE FROM database_query_history WHERE workspace_path = ? AND connection_id = ?').run(workspacePath, connectionId)
  return { deleted: result.changes }
}

module.exports = {
  clearHistory,
  configureDatabaseSecretStorage,
  createConnection,
  deleteConnection,
  deleteSavedQuery,
  getConnection,
  getConnectionWithSecrets,
  listConnections,
  listHistory,
  listSavedQueries,
  migrateLegacyConnectionSecrets,
  recordHistory,
  saveQuery,
  updateConnection,
  updateSavedQuery,
}
