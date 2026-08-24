const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_FILES = 20_000
const MAX_CONFIGURABLE_FILES = 100_000
const DEFAULT_PROGRESS_EVERY = 128
const DEFAULT_YIELD_EVERY = 256
const DEFAULT_EXCLUDED_DIRECTORIES = Object.freeze([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  'styled-system',
])

function assertPositiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${label} non valido.`)
  }
  return resolved
}

function normalizeExclusions(excludedDirectories) {
  const values = excludedDirectories === undefined
    ? DEFAULT_EXCLUDED_DIRECTORIES
    : excludedDirectories
  if (!values || typeof values[Symbol.iterator] !== 'function' || typeof values === 'string') {
    throw new Error('Le directory escluse non sono valide.')
  }

  const normalized = new Set()
  for (const value of values) {
    if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
      throw new Error('Le directory escluse non sono valide.')
    }
    normalized.add(value.toLowerCase())
  }
  return normalized
}

function validateWorkspacePath(workspacePath) {
  if (typeof workspacePath !== 'string' || !workspacePath || workspacePath.includes('\0') || !path.isAbsolute(workspacePath)) {
    throw new Error('Percorso workspace non valido.')
  }
  return path.resolve(workspacePath)
}

async function canonicalWorkspacePath(workspacePath) {
  const requestedPath = validateWorkspacePath(workspacePath)
  const root = await fs.promises.realpath(requestedPath)
  const stats = await fs.promises.lstat(root)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Il workspace non è una directory valida.')
  return { requestedPath, root: path.resolve(root) }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function assertPathInside(root, candidate) {
  if (!isPathInside(root, candidate)) throw new Error('Il percorso indicizzato esce dal workspace.')
}

function compareText(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function toFileId(root, filePath) {
  assertPathInside(root, filePath)
  const relativePath = path.relative(root, filePath)
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Percorso file indicizzato non valido.')
  return relativePath.split(path.sep).join('/')
}

function createAbortError() {
  const error = new Error('Indicizzazione workspace annullata.')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function throwIfAborted(signal) {
  if (signal.aborted) throw createAbortError()
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

function frozenSkipped(skipped) {
  return Object.freeze({
    excludedDirectories: skipped.excludedDirectories,
    symbolicLinks: skipped.symbolicLinks,
    unsupportedEntries: skipped.unsupportedEntries,
    inaccessibleEntries: skipped.inaccessibleEntries,
  })
}

function publicStatus(job, state, extra = {}) {
  return Object.freeze({
    state,
    workspacePath: job.root,
    generation: job.generation,
    filesIndexed: job.files.length,
    directoriesVisited: job.directoriesVisited,
    entriesScanned: job.entriesScanned,
    skipped: frozenSkipped(job.skipped),
    truncated: job.truncated,
    maxFiles: job.maxFiles,
    startedAt: job.startedAt,
    updatedAt: Date.now(),
    ...extra,
  })
}

function isSkippableFileSystemError(error) {
  return error && typeof error === 'object' && ['EACCES', 'ENOENT', 'ENOTDIR', 'EPERM'].includes(error.code)
}

function freezeResult(job, completedAt) {
  const files = job.files
    .sort((left, right) => compareText(left.id, right.id))
    .map((file) => Object.freeze(file))
  return Object.freeze({
    state: 'ready',
    workspacePath: job.root,
    generation: job.generation,
    files: Object.freeze(files),
    fileCount: files.length,
    directoriesVisited: job.directoriesVisited,
    entriesScanned: job.entriesScanned,
    skipped: frozenSkipped(job.skipped),
    truncated: job.truncated,
    maxFiles: job.maxFiles,
    startedAt: job.startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - job.startedAt),
    cacheHit: false,
  })
}

function cachedResult(result) {
  return Object.freeze({ ...result, cacheHit: true })
}

function createProjectFileIndex(options = {}) {
  const maxFiles = assertPositiveInteger(options.maxFiles, DEFAULT_MAX_FILES, 'Limite file', MAX_CONFIGURABLE_FILES)
  const progressEvery = assertPositiveInteger(options.progressEvery, DEFAULT_PROGRESS_EVERY, 'Intervallo avanzamento')
  const yieldEvery = assertPositiveInteger(options.yieldEvery, DEFAULT_YIELD_EVERY, 'Intervallo asincrono')
  const excludedDirectories = normalizeExclusions(options.excludedDirectories)
  const cache = new Map()
  const statuses = new Map()
  const activeJobs = new Map()
  const aliases = new Map()
  const generations = new Map()

  function workspaceKey(workspacePath) {
    const requestedPath = validateWorkspacePath(workspacePath)
    return aliases.get(requestedPath) ?? requestedPath
  }

  function publish(job, state, extra, force = false) {
    if (job.invalidated || job.superseded) return
    if (!force && job.entriesScanned - job.lastPublishedAt < progressEvery) return
    job.lastPublishedAt = job.entriesScanned
    const status = publicStatus(job, state, extra)
    statuses.set(job.root, status)
    for (const listener of job.listeners) {
      try {
        listener(status)
      } catch {
        // Il reporting è osservativo: un listener non può interrompere l'indice.
      }
    }
  }

  function addSignal(job, signal) {
    if (!signal) return
    if (typeof signal.addEventListener !== 'function') throw new Error('Segnale di cancellazione non valido.')
    if (signal.aborted) {
      job.controller.abort()
      return
    }
    const abort = () => job.controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    job.signalCleanups.push(() => signal.removeEventListener('abort', abort))
  }

  async function readDirectory(job, directory) {
    throwIfAborted(job.controller.signal)
    assertPathInside(job.root, directory.absolutePath)

    let stats
    let realPath
    try {
      stats = await fs.promises.lstat(directory.absolutePath)
      if (stats.isSymbolicLink()) {
        job.skipped.symbolicLinks += 1
        return []
      }
      if (!stats.isDirectory()) {
        job.skipped.unsupportedEntries += 1
        return []
      }
      realPath = path.resolve(await fs.promises.realpath(directory.absolutePath))
    } catch (error) {
      if (directory.relativePath && isSkippableFileSystemError(error)) {
        job.skipped.inaccessibleEntries += 1
        return []
      }
      throw error
    }

    assertPathInside(job.root, realPath)
    if (realPath !== directory.absolutePath) {
      job.skipped.symbolicLinks += 1
      return []
    }

    let handle
    try {
      handle = await fs.promises.opendir(realPath)
      const entries = []
      for await (const entry of handle) entries.push(entry)
      job.directoriesVisited += 1
      return entries.sort((left, right) => compareText(left.name, right.name))
    } catch (error) {
      if (directory.relativePath && isSkippableFileSystemError(error)) {
        job.skipped.inaccessibleEntries += 1
        return []
      }
      throw error
    }
  }

  async function scan(job) {
    const directories = [{ absolutePath: job.root, relativePath: '' }]

    while (directories.length > 0 && !job.truncated) {
      throwIfAborted(job.controller.signal)
      const directory = directories.pop()
      const entries = await readDirectory(job, directory)
      const childDirectories = []

      for (const entry of entries) {
        throwIfAborted(job.controller.signal)
        job.entriesScanned += 1
        const entryPath = path.resolve(directory.absolutePath, entry.name)
        assertPathInside(job.root, entryPath)

        if (entry.isSymbolicLink()) {
          job.skipped.symbolicLinks += 1
        } else {
          let stats
          try {
            stats = await fs.promises.lstat(entryPath)
          } catch (error) {
            if (!isSkippableFileSystemError(error)) throw error
            job.skipped.inaccessibleEntries += 1
            publish(job, 'indexing')
            continue
          }

          if (stats.isSymbolicLink()) {
            job.skipped.symbolicLinks += 1
          } else if (stats.isDirectory()) {
            if (excludedDirectories.has(entry.name.toLowerCase())) {
              job.skipped.excludedDirectories += 1
            } else {
              const relativePath = path.relative(job.root, entryPath).split(path.sep).join('/')
              childDirectories.push({ absolutePath: entryPath, relativePath })
            }
          } else if (stats.isFile()) {
            if (job.files.length >= job.maxFiles) {
              job.truncated = true
              break
            }
            const id = toFileId(job.root, entryPath)
            job.files.push({
              id,
              name: entry.name,
              directory: path.posix.dirname(id) === '.' ? '' : path.posix.dirname(id),
              extension: path.extname(entry.name).slice(1).toLowerCase(),
              size: stats.size,
              modifiedAt: stats.mtimeMs,
            })
          } else {
            job.skipped.unsupportedEntries += 1
          }
        }

        publish(job, 'indexing')
        if (job.entriesScanned % yieldEvery === 0) await yieldToEventLoop()
      }

      for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
        directories.push(childDirectories[index])
      }
    }
  }

  async function run(job) {
    publish(job, 'indexing', {}, true)
    try {
      await scan(job)
      throwIfAborted(job.controller.signal)
      const completedAt = Date.now()
      const result = freezeResult(job, completedAt)
      if (!job.invalidated && !job.superseded) {
        cache.set(job.root, result)
        publish(job, 'ready', { completedAt, durationMs: result.durationMs }, true)
      }
      return result
    } catch (error) {
      if (error?.name === 'AbortError' || job.controller.signal.aborted) {
        const abortError = error?.name === 'AbortError' ? error : createAbortError()
        publish(job, 'cancelled', { completedAt: Date.now() }, true)
        throw abortError
      }
      publish(job, 'error', {
        completedAt: Date.now(),
        error: Object.freeze({ code: typeof error?.code === 'string' ? error.code : 'INDEX_FAILED' }),
      }, true)
      throw error
    } finally {
      for (const cleanup of job.signalCleanups) cleanup()
      if (activeJobs.get(job.root) === job) activeJobs.delete(job.root)
    }
  }

  async function build(workspacePath, buildOptions = {}) {
    if (buildOptions.signal?.aborted) throw createAbortError()
    if (buildOptions.onProgress !== undefined && typeof buildOptions.onProgress !== 'function') {
      throw new Error('Callback avanzamento non valida.')
    }

    const { requestedPath, root } = await canonicalWorkspacePath(workspacePath)
    aliases.set(requestedPath, root)
    aliases.set(root, root)

    const active = activeJobs.get(root)
    if (active && !active.invalidated && !active.superseded && !active.controller.signal.aborted && !buildOptions.force) {
      if (buildOptions.onProgress) active.listeners.add(buildOptions.onProgress)
      addSignal(active, buildOptions.signal)
      return active.promise
    }

    if (!buildOptions.force && cache.has(root)) return cachedResult(cache.get(root))

    if (active) {
      active.superseded = true
      active.controller.abort()
    }

    const generation = (generations.get(root) ?? 0) + 1
    generations.set(root, generation)
    const job = {
      root,
      generation,
      maxFiles,
      controller: new AbortController(),
      listeners: new Set(buildOptions.onProgress ? [buildOptions.onProgress] : []),
      signalCleanups: [],
      files: [],
      directoriesVisited: 0,
      entriesScanned: 0,
      skipped: {
        excludedDirectories: 0,
        symbolicLinks: 0,
        unsupportedEntries: 0,
        inaccessibleEntries: 0,
      },
      truncated: false,
      invalidated: false,
      superseded: false,
      lastPublishedAt: -progressEvery,
      startedAt: Date.now(),
      promise: null,
    }
    addSignal(job, buildOptions.signal)
    activeJobs.set(root, job)
    job.promise = run(job)
    return job.promise
  }

  function getStatus(workspacePath) {
    return statuses.get(workspaceKey(workspacePath)) ?? null
  }

  function getCached(workspacePath) {
    const result = cache.get(workspaceKey(workspacePath))
    return result ? cachedResult(result) : null
  }

  function cancel(workspacePath) {
    const job = activeJobs.get(workspaceKey(workspacePath))
    if (!job) return false
    job.controller.abort()
    return true
  }

  function invalidate(workspacePath) {
    const key = workspaceKey(workspacePath)
    const job = activeJobs.get(key)
    if (job) {
      job.invalidated = true
      job.controller.abort()
      activeJobs.delete(key)
    }
    const hadCache = cache.delete(key)
    const hadStatus = statuses.delete(key)
    generations.set(key, (generations.get(key) ?? 0) + 1)
    return Boolean(job) || hadCache || hadStatus
  }

  function clear() {
    const affected = new Set([...cache.keys(), ...statuses.keys(), ...activeJobs.keys()]).size
    for (const job of activeJobs.values()) {
      job.invalidated = true
      job.controller.abort()
    }
    activeJobs.clear()
    cache.clear()
    statuses.clear()
    aliases.clear()
    generations.clear()
    return affected
  }

  return Object.freeze({ build, cancel, clear, getCached, getStatus, invalidate })
}

module.exports = {
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_MAX_FILES,
  createProjectFileIndex,
}
