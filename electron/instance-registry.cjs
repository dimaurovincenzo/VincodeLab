const fs = require('node:fs')
const path = require('node:path')

function normalizeWorkspacePath(workspacePath) {
  const resolvedPath = path.resolve(workspacePath)
  try {
    return fs.realpathSync.native(resolvedPath)
  } catch {
    return resolvedPath
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function createInstanceRegistry({
  database,
  now = Date.now,
  isProcessAlive = processIsAlive,
  maxInstances = 2,
  staleAfterMs = 15_000,
}) {
  database.pragma('busy_timeout = 5000')
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_instances (
      instance_id TEXT PRIMARY KEY NOT NULL,
      pid INTEGER NOT NULL,
      workspace_path TEXT UNIQUE,
      started_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL
    )
  `)

  const removeInstance = database.prepare('DELETE FROM app_instances WHERE instance_id = ?')
  const listStaleCandidates = database.prepare('SELECT instance_id, pid FROM app_instances WHERE heartbeat_at < ?')
  const countInstances = database.prepare('SELECT COUNT(*) AS count FROM app_instances')
  const findWorkspace = database.prepare('SELECT instance_id FROM app_instances WHERE workspace_path = ?')
  const findInstance = database.prepare('SELECT instance_id FROM app_instances WHERE instance_id = ?')
  const insertInstance = database.prepare(`
    INSERT INTO app_instances (instance_id, pid, workspace_path, started_at, heartbeat_at)
    VALUES (?, ?, NULL, ?, ?)
  `)
  const updateHeartbeat = database.prepare('UPDATE app_instances SET heartbeat_at = ? WHERE instance_id = ?')
  const updateWorkspace = database.prepare('UPDATE app_instances SET workspace_path = ? WHERE instance_id = ?')

  function pruneStale() {
    const threshold = now() - staleAfterMs
    for (const row of listStaleCandidates.all(threshold)) {
      if (!isProcessAlive(row.pid)) removeInstance.run(row.instance_id)
    }
  }

  const register = database.transaction(({ instanceId, pid }) => {
    pruneStale()
    const activeCount = countInstances.get().count
    if (activeCount >= maxInstances) return { accepted: false, reason: 'limit', activeCount }
    const timestamp = now()
    insertInstance.run(instanceId, pid, timestamp, timestamp)
    return { accepted: true, activeCount: activeCount + 1 }
  })

  const setWorkspace = database.transaction((instanceId, workspacePath) => {
    const normalizedPath = workspacePath === null ? null : normalizeWorkspacePath(workspacePath)
    const duplicate = normalizedPath ? findWorkspace.get(normalizedPath) : null
    if (duplicate && duplicate.instance_id !== instanceId) {
      return { accepted: false, reason: 'duplicate', workspacePath: normalizedPath }
    }
    if (!findInstance.get(instanceId)) {
      return { accepted: false, reason: 'not-registered', workspacePath: normalizedPath }
    }
    updateWorkspace.run(normalizedPath, instanceId)
    return { accepted: true, workspacePath: normalizedPath }
  })

  function status(workspacePath) {
    pruneStale()
    const activeCount = countInstances.get().count
    const normalizedPath = typeof workspacePath === 'string' ? normalizeWorkspacePath(workspacePath) : null
    const workspaceOpenElsewhere = Boolean(normalizedPath && findWorkspace.get(normalizedPath))
    const canOpenNew = activeCount < maxInstances && !workspaceOpenElsewhere
    return {
      activeCount,
      maxInstances,
      canOpenNew,
      workspaceOpenElsewhere,
      ...(workspaceOpenElsewhere ? { reason: 'duplicate' } : activeCount >= maxInstances ? { reason: 'limit' } : {}),
    }
  }

  return {
    register,
    heartbeat(instanceId) {
      return { updated: updateHeartbeat.run(now(), instanceId).changes > 0 }
    },
    setWorkspace,
    status,
    unregister(instanceId) {
      return { removed: removeInstance.run(instanceId).changes > 0 }
    },
  }
}

module.exports = { createInstanceRegistry, normalizeWorkspacePath }
