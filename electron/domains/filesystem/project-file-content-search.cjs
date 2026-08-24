const DEFAULT_MAX_RESULTS = 100
const MAX_RESULTS = 500
const MAX_QUERY_LENGTH = 256
const MAX_SEARCHABLE_FILE_SIZE = 1_000_000
const BATCH_SIZE = 12
const BINARY_EXTENSIONS = new Set([
  '7z', 'avi', 'bmp', 'class', 'dmg', 'doc', 'docx', 'eot', 'exe', 'gif', 'gz',
  'ico', 'jar', 'jpeg', 'jpg', 'mov', 'mp3', 'mp4', 'otf', 'pdf', 'png', 'ppt',
  'pptx', 'rar', 'sqlite', 'sqlite3', 'tar', 'tiff', 'ttf', 'wav', 'webm', 'webp',
  'woff', 'woff2', 'xls', 'xlsx', 'zip',
])

function validateQuery(query) {
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH || query.includes('\0')) {
    throw new Error('Testo di ricerca non valido.')
  }
  return query.trim()
}

function validateMaxResults(value) {
  if (value === undefined) return DEFAULT_MAX_RESULTS
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error('Limite risultati non valido.')
  }
  return value
}

function lineMatch(content, normalizedQuery) {
  const index = content.toLocaleLowerCase('it-IT').indexOf(normalizedQuery)
  if (index < 0) return null
  const lineStart = content.lastIndexOf('\n', index - 1) + 1
  const lineEndCandidate = content.indexOf('\n', index)
  const lineEnd = lineEndCandidate < 0 ? content.length : lineEndCandidate
  const line = content.slice(0, index).split('\n').length
  const column = index - lineStart + 1
  const rawPreview = content.slice(lineStart, lineEnd).replace(/\s+/gu, ' ').trim()
  const preview = rawPreview.length <= 180 ? rawPreview : `${rawPreview.slice(0, 177)}…`
  return Object.freeze({ column, line, preview })
}

function emptyResult(cancelled = false) {
  return Object.freeze({ cancelled, filesSearched: 0, matches: Object.freeze([]), skippedFiles: 0, truncated: false })
}

function createProjectFileContentSearch({ projectFileIndex, readProjectFile }) {
  if (!projectFileIndex || typeof projectFileIndex.build !== 'function' || typeof readProjectFile !== 'function') {
    throw new TypeError('Dipendenze ricerca contenuti progetto non valide.')
  }
  const generations = new Map()

  function nextGeneration(workspacePath) {
    const generation = (generations.get(workspacePath) ?? 0) + 1
    generations.set(workspacePath, generation)
    return generation
  }

  function isCurrent(workspacePath, generation) {
    return generations.get(workspacePath) === generation
  }

  async function searchProjectFileContents(workspacePath, query, options = {}) {
    const normalized = validateQuery(query)
    const generation = nextGeneration(workspacePath)
    if (!normalized) return emptyResult(true)
    if (normalized.length < 2) throw new Error('Inserisci almeno 2 caratteri per cercare nei contenuti.')
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'maxResults')) {
      throw new Error('Opzioni ricerca contenuti non valide.')
    }
    const maxResults = validateMaxResults(options.maxResults)
    const index = await projectFileIndex.build(workspacePath)
    if (!isCurrent(workspacePath, generation)) return emptyResult(true)

    const candidates = index.files.filter((file) => file.size <= MAX_SEARCHABLE_FILE_SIZE && !BINARY_EXTENSIONS.has(file.extension))
    const matches = []
    let filesSearched = 0
    let skippedFiles = index.files.length - candidates.length
    let candidatesProcessed = 0
    let cursor = 0

    while (cursor < candidates.length && matches.length < maxResults) {
      if (!isCurrent(workspacePath, generation)) return emptyResult(true)
      const batch = candidates.slice(cursor, cursor + BATCH_SIZE)
      cursor += batch.length
      const results = await Promise.all(batch.map(async (file) => {
        try {
          const read = await readProjectFile(workspacePath, file.id)
          return { file, match: lineMatch(read.content, normalized.toLocaleLowerCase('it-IT')) }
        } catch {
          // Un file può sparire, diventare inaccessibile o risultare binario tra indice e lettura.
          // La ricerca resta utile sugli altri file e rende visibile il totale degli elementi saltati.
          return { file, skipped: true }
        }
      }))
      if (!isCurrent(workspacePath, generation)) return emptyResult(true)
      for (const result of results) {
        candidatesProcessed += 1
        if (result.skipped) {
          skippedFiles += 1
          continue
        }
        filesSearched += 1
        if (!result.match) continue
        matches.push(Object.freeze({
          column: result.match.column,
          directory: result.file.directory,
          fileId: result.file.id,
          fileName: result.file.name,
          line: result.match.line,
          preview: result.match.preview,
        }))
        if (matches.length >= maxResults) break
      }
    }

    return Object.freeze({
      cancelled: false,
      filesSearched,
      matches: Object.freeze(matches),
      skippedFiles,
      truncated: matches.length >= maxResults && candidatesProcessed < candidates.length,
    })
  }

  return Object.freeze({ searchProjectFileContents })
}

module.exports = {
  createProjectFileContentSearch,
  lineMatch,
}
