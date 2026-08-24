const { getDatabase } = require('./workspace.repository.cjs')

const MAX_CACHE_BYTES = 2 * 1024 * 1024
const EXPIRED_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000

function ensureCacheSchema() {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS workspace_cache (
      workspace_path TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_path, resource_key)
    );
    CREATE INDEX IF NOT EXISTS workspace_cache_expires_at
      ON workspace_cache(expires_at);
  `)
}

function readCache(workspacePath, resourceKey, now = Date.now()) {
  ensureCacheSchema()
  const database = getDatabase()
  const row = database.prepare(`
    SELECT payload_json AS payloadJson, fetched_at AS fetchedAt, expires_at AS expiresAt
    FROM workspace_cache
    WHERE workspace_path = ? AND resource_key = ?
  `).get(workspacePath, resourceKey)
  if (!row) return null

  try {
    return {
      data: JSON.parse(row.payloadJson),
      cache: {
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
        stale: row.expiresAt <= now,
      },
    }
  } catch {
    // Una cache corrotta non deve impedire il caricamento remoto della risorsa.
    database.prepare('DELETE FROM workspace_cache WHERE workspace_path = ? AND resource_key = ?')
      .run(workspacePath, resourceKey)
    return null
  }
}

function purgeExpiredCache(now = Date.now()) {
  ensureCacheSchema()
  return getDatabase().prepare('DELETE FROM workspace_cache WHERE expires_at < ?')
    .run(now - EXPIRED_CACHE_RETENTION_MS).changes
}

function writeCache(workspacePath, resourceKey, payload, ttlMs, now = Date.now()) {
  const payloadJson = JSON.stringify(payload)
  if (payloadJson === undefined) throw new Error('Il payload della cache deve essere serializzabile in JSON.')
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_CACHE_BYTES) {
    throw new Error('Il payload della cache supera il limite consentito.')
  }

  ensureCacheSchema()
  const expiresAt = now + ttlMs
  const database = getDatabase()
  database.transaction(() => {
    purgeExpiredCache(now)
    database.prepare(`
      INSERT INTO workspace_cache (workspace_path, resource_key, payload_json, fetched_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_path, resource_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).run(workspacePath, resourceKey, payloadJson, now, expiresAt)
  })()

  return {
    data: payload,
    cache: { fetchedAt: now, expiresAt, stale: false },
  }
}

function invalidateCache(workspacePath, keys) {
  if (!Array.isArray(keys) || keys.length === 0) return
  ensureCacheSchema()
  const remove = getDatabase().prepare('DELETE FROM workspace_cache WHERE workspace_path = ? AND resource_key = ?')
  getDatabase().transaction(() => keys.forEach((key) => remove.run(workspacePath, key)))()
}

module.exports = {
  invalidateCache,
  purgeExpiredCache,
  readCache,
  writeCache,
}
