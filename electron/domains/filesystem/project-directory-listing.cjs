const { assertProjectDirectoryListingHostPort } = require('./project-directory-listing-host.port.cjs')
const { EXCLUDED_DIRECTORIES } = require('./project-access-policy.cjs')

const MAX_DIRECTORY_ENTRIES = 1_000
const DIRECTORY_SCAN_YIELD_INTERVAL = 256
const DIRECTORY_ENTRY_KINDS = new Set(['directory', 'file', 'symbolic-link', 'unsupported'])

function compareDirectoryEntries(left, right) {
  return Number(right.isDirectory) - Number(left.isDirectory)
    || left.name.localeCompare(right.name)
    || left.scanIndex - right.scanIndex
}

function pushBoundedDirectoryEntry(heap, entry, limit) {
  if (heap.length < limit) {
    heap.push(entry)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compareDirectoryEntries(heap[parent], heap[index]) >= 0) break
      ;[heap[parent], heap[index]] = [heap[index], heap[parent]]
      index = parent
    }
    return
  }

  if (compareDirectoryEntries(entry, heap[0]) >= 0) return
  heap[0] = entry
  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let worst = index
    if (left < heap.length && compareDirectoryEntries(heap[left], heap[worst]) > 0) worst = left
    if (right < heap.length && compareDirectoryEntries(heap[right], heap[worst]) > 0) worst = right
    if (worst === index) break
    ;[heap[index], heap[worst]] = [heap[worst], heap[index]]
    index = worst
  }
}

async function collectDirectoryEntries(directoryEntries, { limit = MAX_DIRECTORY_ENTRIES, yieldInterval = DIRECTORY_SCAN_YIELD_INTERVAL } = {}) {
  const retained = []
  let eligibleEntries = 0
  let scannedEntries = 0
  let peakRetainedEntries = 0

  for await (const entry of directoryEntries) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || !DIRECTORY_ENTRY_KINDS.has(entry.kind)) {
      throw new TypeError('Elemento host elenco directory non valido.')
    }
    scannedEntries += 1
    const isDirectory = entry.kind === 'directory'
    if (!(isDirectory && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
      && entry.kind !== 'unsupported') {
      pushBoundedDirectoryEntry(retained, {
        name: entry.name,
        isDirectory,
        scanIndex: scannedEntries,
      }, limit)
      eligibleEntries += 1
      peakRetainedEntries = Math.max(peakRetainedEntries, retained.length)
    }

    // Anche un async iterable in memoria può produrre soltanto microtask: il yield
    // esplicito mantiene reattivo il processo main durante directory molto grandi.
    if (yieldInterval > 0 && scannedEntries % yieldInterval === 0) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  retained.sort(compareDirectoryEntries)
  return {
    entries: retained,
    truncated: eligibleEntries > limit,
    peakRetainedEntries,
  }
}

function assertAccessibleDirectory(directoryId) {
  if (directoryId && String(directoryId).split('/').some((segment) => EXCLUDED_DIRECTORIES.has(segment.toLowerCase()))) {
    throw new Error('Questa cartella di sistema non è accessibile dall’editor.')
  }
}

function assertDirectorySource(source) {
  if (!source || typeof source.directoryId !== 'string'
    || !source.entries || typeof source.entries[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('Sorgente host elenco directory non valida.')
  }
  return source
}

function createProjectDirectoryListing(host) {
  const directoryListingHost = assertProjectDirectoryListingHostPort(host)

  async function listDirectoryEntries(workspacePath, directoryId = '') {
    assertAccessibleDirectory(directoryId)
    const source = assertDirectorySource(await directoryListingHost.openDirectory(workspacePath, directoryId))
    const result = await collectDirectoryEntries(source.entries)
    return {
      entries: result.entries.map((entry) => ({
        id: source.directoryId ? `${source.directoryId}/${entry.name}` : entry.name,
        name: entry.name,
        kind: entry.isDirectory ? 'directory' : 'file',
      })),
      truncated: result.truncated,
    }
  }

  async function listProjectFiles(workspacePath) {
    return listDirectoryEntries(workspacePath)
  }

  return Object.freeze({ listDirectoryEntries, listProjectFiles })
}

module.exports = { collectDirectoryEntries, createProjectDirectoryListing }
