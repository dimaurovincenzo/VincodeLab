const fs = require('node:fs')
const path = require('node:path')
const {
  assertEditorAccessiblePath,
  EXCLUDED_DIRECTORIES,
  resolveProjectPath,
  toId,
  workspaceRoot,
} = require('./project-path-model.cjs')

const MAX_DIRECTORY_ENTRIES = 1_000
const DIRECTORY_SCAN_YIELD_INTERVAL = 256

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
    scannedEntries += 1
    const isDirectory = entry.isDirectory()
    if (!(isDirectory && EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()))
      && (isDirectory || entry.isFile() || entry.isSymbolicLink())) {
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

async function listDirectoryEntries(workspacePath, directoryId = '') {
  const root = workspaceRoot(workspacePath)
  if (directoryId) assertEditorAccessiblePath(directoryId)
  const directory = resolveProjectPath(workspacePath, directoryId, 'directory')
  const directoryHandle = await fs.promises.opendir(directory)
  const result = await collectDirectoryEntries(directoryHandle)
  return {
    entries: result.entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      // I symlink restano elencati per rendere il workspace completo, ma resolveProjectPath
      // continua a rifiutarli: l'editor non segue file esterni attraverso un collegamento.
      return { id: toId(path.relative(root, entryPath)), name: entry.name, kind: entry.isDirectory ? 'directory' : 'file' }
    }),
    truncated: result.truncated,
  }
}

async function listProjectFiles(workspacePath) {
  return listDirectoryEntries(workspacePath)
}

module.exports = { collectDirectoryEntries, listDirectoryEntries, listProjectFiles }
