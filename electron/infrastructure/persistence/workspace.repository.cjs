// Repository SQLite condiviso dalle persistenze locali dell'applicazione.
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

let database

function protectDatabaseArtifacts(databasePath) {
  if (process.platform === 'win32') return
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(`${databasePath}${suffix}`, 0o600)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function getDataDirectory() {
  const dataDirectory = process.env.VINCODELAB_DATA_DIR || require('electron').app.getPath('userData')
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') fs.chmodSync(dataDirectory, 0o700)
  return dataDirectory
}

function getDatabase() {
  if (database) return database

  const dataDirectory = getDataDirectory()
  const databasePath = path.join(dataDirectory, 'vincodelab.sqlite')
  // SQLite crea WAL e SHM durante l'apertura: una umask locale impedisce una finestra con permessi troppo ampi.
  const previousUmask = process.platform === 'win32' ? null : process.umask(0o077)
  try {
    database = new Database(databasePath)
    database.pragma('busy_timeout = 5000')
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE IF NOT EXISTS recent_workspaces (
        path TEXT PRIMARY KEY NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recent_workspaces_last_opened_at
        ON recent_workspaces(last_opened_at DESC);
      CREATE TABLE IF NOT EXISTS app_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `)
    protectDatabaseArtifacts(databasePath)
  } catch (error) {
    database?.close()
    database = undefined
    throw error
  } finally {
    if (previousUmask !== null) process.umask(previousUmask)
  }
  return database
}

const APPEARANCE_VALUES = new Set(['system', 'light', 'dark'])

function getAppearance() {
  const value = getDatabase().prepare('SELECT value FROM app_preferences WHERE key = ?').get('appearance')?.value
  return APPEARANCE_VALUES.has(value) ? value : 'system'
}

function setAppearance(value) {
  if (!APPEARANCE_VALUES.has(value)) throw new Error('Aspetto non valido.')
  getDatabase().prepare(`
    INSERT INTO app_preferences (key, value) VALUES ('appearance', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(value)
  return value
}

function isDirectory(workspacePath) {
  try {
    return fs.statSync(workspacePath).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

const MAX_RECENT_WORKSPACES = 50

function recordWorkspace(workspacePath) {
  const db = getDatabase()
  db.transaction(() => {
    db.prepare(`
      INSERT INTO recent_workspaces (path, last_opened_at)
      VALUES (?, ?)
      ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at
    `).run(workspacePath, Date.now())
    // La cronologia è una comodità UI: limitarla evita crescita indefinita del database.
    db.prepare(`
      DELETE FROM recent_workspaces
      WHERE path NOT IN (
        SELECT path FROM recent_workspaces ORDER BY last_opened_at DESC LIMIT ?
      )
    `).run(MAX_RECENT_WORKSPACES)
  })()
}

function listRecentWorkspaces(limit = 8) {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT path, last_opened_at AS lastOpenedAt
    FROM recent_workspaces
    ORDER BY last_opened_at DESC
  `).all()

  const stalePaths = new Set(rows.filter((row) => !isDirectory(row.path)).map((row) => row.path))
  if (stalePaths.size > 0) {
    const remove = db.prepare('DELETE FROM recent_workspaces WHERE path = ?')
    db.transaction(() => stalePaths.forEach((workspacePath) => remove.run(workspacePath)))()
  }

  return rows.filter((row) => !stalePaths.has(row.path)).slice(0, limit)
}

function closeDatabase() {
  if (!database) return
  database.close()
  database = undefined
}

module.exports = {
  closeDatabase,
  getAppearance,
  getDataDirectory,
  getDatabase,
  isDirectory,
  listRecentWorkspaces,
  recordWorkspace,
  setAppearance,
}
