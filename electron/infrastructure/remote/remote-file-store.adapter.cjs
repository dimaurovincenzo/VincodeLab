const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { getApplicationErrorLogMetadata, toApplicationError } = require('../../domains/errors/application-error.cjs')

const MAX_CACHED_FILE_BYTES = 100 * 1024 * 1024

async function hashFile(filePath, maxBytes = MAX_CACHED_FILE_BYTES) {
  const stats = await fs.promises.stat(filePath)
  if (!stats.isFile() || stats.size > maxBytes) throw new Error('File cache non valido.')
  const hash = crypto.createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error('File cache non valido.')
    hash.update(chunk)
  }
  return { hash: hash.digest('hex'), size: bytes }
}

function assertWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.length > 4_096) throw new Error('Workspace non valido.')
  return workspacePath
}

function assertOpaqueId(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\0\r\n]/.test(value)) throw new Error(`${label} non valido.`)
  return value
}

function assertRemotePath(remotePath) {
  if (typeof remotePath !== 'string' || !remotePath.startsWith('/') || remotePath.length > 4_096 || /[\0\r\n]/.test(remotePath)) throw new Error('Percorso remoto non valido.')
  return remotePath
}

async function ensureDirectory(directoryPath) {
  await fs.promises.mkdir(directoryPath, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await fs.promises.chmod(directoryPath, 0o700)
}

async function pathExists(filePath) {
  try {
    await fs.promises.stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function syncFile(filePath) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directoryPath) {
  if (process.platform === 'win32') return
  let handle
  try {
    handle = await fs.promises.open(directoryPath, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error
  } finally {
    await handle?.close()
  }
}

function createRemoteFileStore({ dataRoot, database, log = () => undefined, removeFile = fs.promises.rm }) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('Directory dati non valida.')
  if (!database?.prepare || !database?.exec) throw new Error('Database non valido.')
  if (typeof log !== 'function' || typeof removeFile !== 'function') throw new Error('Dipendenze cache remota non valide.')
  const cacheRoot = path.join(dataRoot, 'remote-files')
  let cacheRootReady
  const mutations = new Map()

  function ensureCacheRoot() {
    cacheRootReady ??= ensureDirectory(cacheRoot)
    return cacheRootReady
  }

  async function removeBestEffort(filePath, operation) {
    try {
      await removeFile(filePath, { force: true })
    } catch (error) {
      const incident = toApplicationError(error, {
        category: 'filesystem',
        code: 'REMOTE_CACHE_CLEANUP_FAILED',
        domain: 'remote',
        message: 'La cache remota non è stata ripulita completamente.',
        operation,
        severity: 'warning',
      })
      log('warning', 'remote_file_store_cleanup_failed', getApplicationErrorLogMetadata(incident))
    }
  }

  function serializeMutation(key, operation) {
    const previous = mutations.get(key) ?? Promise.resolve()
    const pending = previous.catch(() => {
      // Il chiamante della write precedente ha già ricevuto il failure. La coda per
      // workspace viene riaperta affinché la recovery successiva possa proseguire.
    }).then(operation)
    mutations.set(key, pending)
    return pending.finally(() => {
      if (mutations.get(key) === pending) mutations.delete(key)
    })
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS remote_tracked_files (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_path TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      local_relative_path TEXT NOT NULL,
      baseline_hash TEXT NOT NULL,
      local_hash TEXT NOT NULL,
      remote_size INTEGER,
      remote_modified_at INTEGER,
      remote_mode INTEGER,
      local_state TEXT NOT NULL CHECK(local_state IN ('synced','modified','conflict','offline')),
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(workspace_path, connection_id, remote_path)
    );
    CREATE INDEX IF NOT EXISTS remote_tracked_files_workspace_state
      ON remote_tracked_files(workspace_path, local_state, updated_at);
  `)

  function fromRow(row) {
    if (!row) return null
    const localPath = path.resolve(cacheRoot, row.localRelativePath)
    if (!localPath.startsWith(`${path.resolve(cacheRoot)}${path.sep}`)) throw new Error('Percorso cache non valido.')
    return {
      id: row.id,
      workspacePath: row.workspacePath,
      connectionId: row.connectionId,
      name: path.posix.basename(row.remotePath),
      remotePath: row.remotePath,
      localPath,
      localState: row.localState,
      size: row.size,
      modifiedAt: row.modifiedAt,
      mode: row.mode,
      baselineHash: row.baselineHash,
      localHash: row.localHash,
      lastError: row.lastError,
      updatedAt: row.updatedAt,
    }
  }

  const selectFields = `
    SELECT id, workspace_path AS workspacePath, connection_id AS connectionId,
      remote_path AS remotePath, local_relative_path AS localRelativePath,
      baseline_hash AS baselineHash, local_hash AS localHash,
      remote_size AS size, remote_modified_at AS modifiedAt, remote_mode AS mode,
      local_state AS localState, last_error AS lastError, updated_at AS updatedAt
    FROM remote_tracked_files`

  function getTrackedFile(workspacePath, id) {
    workspacePath = assertWorkspacePath(workspacePath)
    id = assertOpaqueId(id, 'File remoto')
    return fromRow(database.prepare(`${selectFields} WHERE workspace_path = ? AND id = ?`).get(workspacePath, id))
  }

  function listTrackedFiles(workspacePath) {
    workspacePath = assertWorkspacePath(workspacePath)
    return database.prepare(`${selectFields} WHERE workspace_path = ? ORDER BY updated_at DESC`).all(workspacePath).map(fromRow)
  }

  function trackDownload(workspacePath, input) {
    workspacePath = assertWorkspacePath(workspacePath)
    if (!input || typeof input !== 'object') throw new Error('Download remoto non valido.')
    const connectionId = assertOpaqueId(input.connectionId, 'Connessione SSH')
    const remotePath = assertRemotePath(input.remotePath)
    if (typeof input.localTempPath !== 'string' || !path.isAbsolute(input.localTempPath)) throw new Error('File temporaneo non valido.')
    if (typeof input.baselineHash !== 'string' || !/^[0-9a-f]{64}$/i.test(input.baselineHash)) throw new Error('Hash remoto non valido.')
    const mutationKey = `${workspacePath}\0${connectionId}\0${remotePath}`
    return serializeMutation(mutationKey, async () => {
      await ensureCacheRoot()
      let sourceStats
      try {
        sourceStats = await fs.promises.stat(input.localTempPath)
      } catch (error) {
        if (error?.code === 'ENOENT') throw new Error('File temporaneo non valido.')
        throw error
      }
      if (!sourceStats.isFile() || sourceStats.size > MAX_CACHED_FILE_BYTES) throw new Error('File temporaneo non valido.')
      const existing = database.prepare(`${selectFields} WHERE workspace_path = ? AND connection_id = ? AND remote_path = ?`).get(workspacePath, connectionId, remotePath)
      if (existing && existing.localState !== 'synced') throw new Error('Esiste già una copia con modifiche locali.')
      const id = existing?.id ?? crypto.randomUUID()
      const workspaceDirectory = path.join(cacheRoot, crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 20))
      await ensureDirectory(workspaceDirectory)
      const extension = path.extname(path.posix.basename(remotePath)).slice(0, 32)
      const localPath = path.join(workspaceDirectory, `${id}${extension}`)
      const stagingPath = path.join(workspaceDirectory, `.${id}-${crypto.randomUUID()}.tmp`)
      const backupPath = path.join(workspaceDirectory, `.${id}-${crypto.randomUUID()}.tmp`)
      let backupCreated = false
      let installed = false
      let committed = false
      try {
        await fs.promises.copyFile(input.localTempPath, stagingPath)
        if (process.platform !== 'win32') await fs.promises.chmod(stagingPath, 0o600)
        await syncFile(stagingPath)
        const { hash: localHash } = await hashFile(stagingPath)
        if (await pathExists(localPath)) {
          await fs.promises.rename(localPath, backupPath)
          backupCreated = true
        }
        await fs.promises.rename(stagingPath, localPath)
        installed = true
        await syncDirectory(workspaceDirectory)
        const now = Date.now()
        database.prepare(`
          INSERT INTO remote_tracked_files (
            id, workspace_path, connection_id, remote_path, local_relative_path,
            baseline_hash, local_hash, remote_size, remote_modified_at, remote_mode,
            local_state, last_error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, ?, ?)
          ON CONFLICT(workspace_path, connection_id, remote_path) DO UPDATE SET
            local_relative_path = excluded.local_relative_path,
            baseline_hash = excluded.baseline_hash,
            local_hash = excluded.local_hash,
            remote_size = excluded.remote_size,
            remote_modified_at = excluded.remote_modified_at,
            remote_mode = excluded.remote_mode,
            local_state = 'synced', last_error = NULL, updated_at = excluded.updated_at
        `).run(
          id, workspacePath, connectionId, remotePath, path.relative(cacheRoot, localPath),
          input.baselineHash.toLowerCase(), localHash, input.size ?? null, input.modifiedAt ?? null,
          input.mode ?? null, now, now,
        )
        committed = true
        await removeBestEffort(input.localTempPath, 'remove-download-source')
        return getTrackedFile(workspacePath, id)
      } catch (error) {
        if (!committed) {
          const recoveryErrors = []
          if (installed) {
            try {
              await removeFile(localPath, { force: true })
            } catch (recoveryError) {
              recoveryErrors.push(recoveryError)
            }
          }
          if (backupCreated) {
            try {
              await fs.promises.rename(backupPath, localPath)
            } catch (rollbackError) {
              recoveryErrors.push(rollbackError)
            }
          }
          if (recoveryErrors.length > 0) throw new AggregateError([error, ...recoveryErrors], 'Impossibile ripristinare completamente la copia locale precedente.')
        }
        throw error
      } finally {
        await removeBestEffort(stagingPath, 'remove-download-staging')
        if (committed || !backupCreated) await removeBestEffort(backupPath, 'remove-download-backup')
      }
    })
  }

  function updateState(workspacePath, id, fields) {
    const current = getTrackedFile(workspacePath, id)
    if (!current) throw new Error('File remoto non trovato.')
    const next = { ...current, ...fields, updatedAt: Date.now() }
    database.prepare(`
      UPDATE remote_tracked_files
      SET baseline_hash = ?, local_hash = ?, remote_size = ?, remote_modified_at = ?, remote_mode = ?,
        local_state = ?, last_error = ?, updated_at = ?
      WHERE workspace_path = ? AND id = ?
    `).run(next.baselineHash, next.localHash, next.size, next.modifiedAt, next.mode, next.localState, next.lastError ?? null, next.updatedAt, workspacePath, id)
    return getTrackedFile(workspacePath, id)
  }

  async function markLocalSaved(workspacePath, id) {
    const current = getTrackedFile(workspacePath, id)
    if (!current) throw new Error('Copia locale non trovata.')
    let localHash
    try {
      localHash = (await hashFile(current.localPath)).hash
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('Copia locale non trovata.')
      throw error
    }
    return updateState(workspacePath, id, { localHash, localState: localHash === current.baselineHash ? 'synced' : 'modified', lastError: null })
  }

  function markConflict(workspacePath, id, message = 'Il file remoto è cambiato.') {
    return updateState(workspacePath, id, { localState: 'conflict', lastError: message })
  }

  async function markSynced(workspacePath, id, remote = {}) {
    const current = getTrackedFile(workspacePath, id)
    if (!current) throw new Error('File remoto non trovato.')
    const localHash = (await hashFile(current.localPath)).hash
    return updateState(workspacePath, id, {
      baselineHash: remote.baselineHash ?? localHash,
      localHash,
      size: remote.size ?? current.size,
      modifiedAt: remote.modifiedAt ?? current.modifiedAt,
      mode: remote.mode ?? current.mode,
      localState: 'synced',
      lastError: null,
    })
  }

  function markOffline(workspacePath, id, message) {
    return updateState(workspacePath, id, { localState: 'offline', lastError: message || 'Connessione non disponibile.' })
  }

  function updateRemotePath(workspacePath, id, remotePath) {
    remotePath = assertRemotePath(remotePath)
    if (!getTrackedFile(workspacePath, id)) throw new Error('File remoto non trovato.')
    database.prepare('UPDATE remote_tracked_files SET remote_path = ?, updated_at = ? WHERE workspace_path = ? AND id = ?').run(remotePath, Date.now(), workspacePath, id)
    return getTrackedFile(workspacePath, id)
  }

  async function removeTrackedFile(workspacePath, id, { force = false } = {}) {
    const current = getTrackedFile(workspacePath, id)
    if (!current) throw new Error('File remoto non trovato.')
    if (!force && current.localState !== 'synced') throw new Error('La copia contiene modifiche locali.')
    const quarantinePath = `${current.localPath}.${crypto.randomUUID()}.tmp`
    let moved = false
    try {
      await fs.promises.rename(current.localPath, quarantinePath)
      moved = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    try {
      database.prepare('DELETE FROM remote_tracked_files WHERE workspace_path = ? AND id = ?').run(workspacePath, id)
    } catch (error) {
      if (moved) {
        try {
          await fs.promises.rename(quarantinePath, current.localPath)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Impossibile ripristinare la copia locale dopo l’errore di archiviazione.')
        }
      }
      throw error
    }
    if (moved) await removeBestEffort(quarantinePath, 'remove-quarantined-copy')
    return { removed: true }
  }

  async function removeTemporaryFiles(directoryPath) {
    let removed = 0
    let entries
    try {
      entries = await fs.promises.readdir(directoryPath, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return removed
      throw error
    }
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) removed += await removeTemporaryFiles(entryPath)
      else if (entry.isFile() && entry.name.endsWith('.tmp')) {
        await fs.promises.rm(entryPath, { force: true })
        removed += 1
      }
    }
    return removed
  }

  async function cleanup(workspacePath, { olderThan = Date.now() - 30 * 24 * 60 * 60 * 1_000 } = {}) {
    workspacePath = assertWorkspacePath(workspacePath)
    if (!Number.isFinite(olderThan)) throw new Error('Limite pulizia non valido.')
    await ensureCacheRoot()
    let removed = await removeTemporaryFiles(cacheRoot)
    const stale = listTrackedFiles(workspacePath).filter((item) => item.localState === 'synced' && item.updatedAt < olderThan)
    for (const item of stale) {
      await removeTrackedFile(workspacePath, item.id, { force: true })
      removed += 1
    }
    return { removed }
  }

  return {
    cleanup,
    getTrackedFile,
    listTrackedFiles,
    markConflict,
    markLocalSaved,
    markOffline,
    markSynced,
    removeTrackedFile,
    trackDownload,
    updateRemotePath,
  }
}

module.exports = { createRemoteFileStore }
