const { invalidateCache, readCache, writeCache } = require('../persistence/workspace-cache.repository.cjs')
const { commandLifecycleError, isCommandInterruption, throwIfAborted } = require('../../domains/github/command-errors.cjs')

const CACHE_TTL = {
  gitStatus: 10_000,
  gitGraph: 300_000,
  githubData: 60_000,
  projectBoard: 60_000,
}
const inFlightCacheLoads = new Map()
const cacheGenerations = new Map()

function cacheLoadKey(workspacePath, resourceKey) {
  return `${workspacePath}\0${resourceKey}`
}

function invalidateTrackedCache(workspacePath, resourceKeys) {
  invalidateCache(workspacePath, resourceKeys)
  for (const resourceKey of resourceKeys) {
    const key = cacheLoadKey(workspacePath, resourceKey)
    cacheGenerations.set(key, (cacheGenerations.get(key) ?? 0) + 1)
  }
}

function projectBoardCacheKey(projectNumber) {
  return `github:project-board:${projectNumber}`
}

function invalidateGitCache(workspacePath) {
  invalidateTrackedCache(workspacePath, ['git:status', 'git:graph'])
}

function invalidateGitHubDataCache(workspacePath) {
  invalidateTrackedCache(workspacePath, ['github:data'])
}

function invalidateProjectBoardCache(workspacePath, projectNumber) {
  invalidateTrackedCache(workspacePath, [projectBoardCacheKey(projectNumber)])
}

function invalidateProjectMutationCache(workspacePath, projectNumber) {
  invalidateGitHubDataCache(workspacePath)
  invalidateProjectBoardCache(workspacePath, projectNumber)
}

async function getCachedResource(workspacePath, resourceKey, ttlMs, load, { force = false, now = Date.now(), signal } = {}) {
  const command = resourceKey.startsWith('git:') ? 'git' : 'gh'
  throwIfAborted(signal, command)
  const cached = readCache(workspacePath, resourceKey, now)
  if (cached && !cached.cache.stale && !force) return cached

  const inFlightKey = cacheLoadKey(workspacePath, resourceKey)
  let generation = cacheGenerations.get(inFlightKey) ?? 0
  const activeLoad = inFlightCacheLoads.get(inFlightKey)
  // Due renderer diversi non devono condividere il processo appartenente al
  // signal dell'altro: chiudere una finestra cancellerebbe anche il lettore sano.
  // Le letture senza signal e quelle dello stesso contesto conservano invece il
  // single-flight storico.
  if (activeLoad?.generation === generation && activeLoad.signal === signal && !activeLoad.signal?.aborted) return activeLoad.promise
  if (activeLoad?.generation === generation && activeLoad.signal?.aborted) {
    generation += 1
    cacheGenerations.set(inFlightKey, generation)
  }

  const pendingLoad = (async () => {
    try {
      const data = await load(signal)
      throwIfAborted(signal, command)
      if ((cacheGenerations.get(inFlightKey) ?? 0) !== generation) return getCachedResource(workspacePath, resourceKey, ttlMs, load, { force: true, now, signal })
      return writeCache(workspacePath, resourceKey, data, ttlMs, now)
    } catch (error) {
      if (isCommandInterruption(error) || signal?.aborted) throw (isCommandInterruption(error) ? error : commandLifecycleError(command, 'cancelled'))
      if ((cacheGenerations.get(inFlightKey) ?? 0) !== generation) return getCachedResource(workspacePath, resourceKey, ttlMs, load, { force: true, now, signal })
      if (cached) {
        return {
          ...cached,
          cache: { ...cached.cache, stale: true, refreshError: true },
        }
      }
      throw error
    }
  })()
  const activeEntry = { generation, promise: pendingLoad, signal }
  inFlightCacheLoads.set(inFlightKey, activeEntry)

  try {
    return await pendingLoad
  } finally {
    if (inFlightCacheLoads.get(inFlightKey) === activeEntry) inFlightCacheLoads.delete(inFlightKey)
  }
}

module.exports = {
  CACHE_TTL,
  getCachedResource,
  invalidateGitCache,
  invalidateGitHubDataCache,
  invalidateProjectBoardCache,
  invalidateProjectMutationCache,
  projectBoardCacheKey,
}
