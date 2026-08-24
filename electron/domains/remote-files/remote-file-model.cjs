async function toPublicTrackedFile(item, { stat } = {}) {
  if (!item) return null
  let cacheSize = Number.isFinite(item.cacheSize) ? item.cacheSize : 0
  if (!Number.isFinite(item.cacheSize) && item.localPath) {
    if (typeof stat !== 'function') throw new Error('Adapter filesystem remoto non configurato.')
    try {
      cacheSize = (await stat(item.localPath)).size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  const { localPath: _localPath, workspacePath: _workspacePath, ...publicItem } = item
  return { ...publicItem, cacheSize }
}

module.exports = { toPublicTrackedFile }
