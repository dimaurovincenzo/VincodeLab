const crypto = require('node:crypto')

const MAX_CACHED_ENTRIES = 10_000

function createRemoteEntryRegistry() {
  const entries = new Map()
  const entryIdsByKey = new Map()

  function entryKey(workspacePath, connectionId, remotePath) {
    return `${workspacePath}\0${connectionId}\0${remotePath}`
  }

  function cacheEntry(internal) {
    const key = entryKey(internal.workspacePath, internal.connectionId, internal.remotePath)
    const id = entryIdsByKey.get(key) ?? crypto.randomUUID()
    const cached = { ...internal, id, cacheKey: key }
    entryIdsByKey.set(key, id)
    entries.delete(id)
    entries.set(id, cached)
    while (entries.size > MAX_CACHED_ENTRIES) {
      const oldestId = entries.keys().next().value
      const oldest = entries.get(oldestId)
      entries.delete(oldestId)
      if (oldest) entryIdsByKey.delete(oldest.cacheKey)
    }
    return cached
  }

  function requireEntry(workspacePath, entryId, expectedKind) {
    const entry = entries.get(entryId)
    if (!entry || entry.workspacePath !== workspacePath) throw new Error('Elemento remoto non trovato nel workspace.')
    if (expectedKind && entry.kind !== expectedKind) throw new Error('Tipo di elemento remoto non valido.')
    entries.delete(entryId)
    entries.set(entryId, entry)
    return entry
  }

  function updateEntryPath(entry, nextPath) {
    entryIdsByKey.delete(entry.cacheKey)
    entry.remotePath = nextPath
    entry.cacheKey = entryKey(entry.workspacePath, entry.connectionId, nextPath)
    entryIdsByKey.set(entry.cacheKey, entry.id)
  }

  function updateEntryName(entry, nextName) {
    entry.name = nextName
  }

  function removeEntry(entry) {
    entries.delete(entry.id)
    entryIdsByKey.delete(entry.cacheKey)
  }

  function clearWorkspace(workspacePath) {
    for (const entry of entries.values()) {
      if (entry.workspacePath !== workspacePath) continue
      removeEntry(entry)
    }
  }

  function clear() {
    entries.clear()
    entryIdsByKey.clear()
  }

  return {
    cacheEntry,
    clear,
    clearWorkspace,
    getSize: () => entries.size,
    removeEntry,
    requireEntry,
    updateEntryName,
    updateEntryPath,
  }
}

module.exports = { createRemoteEntryRegistry }
