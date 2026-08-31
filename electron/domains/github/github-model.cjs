const path = require('node:path')
const { createPublicError } = require('../errors/public-error.cjs')

const MAX_GIT_STATUS_FILES = 1_000
const MAX_GIT_GRAPH_COMMITS = 1_000
const MAX_GIT_BRANCHES = 1_000
const MAX_GIT_PATHS_PER_COMMAND = 128
const MAX_GIT_PATH_ARGUMENT_BYTES = 64 * 1024
const MAX_GITHUB_ISSUES = 500
const MAX_GITHUB_ISSUE_BODY_CHARS = 512
const MAX_GITHUB_ISSUE_LABELS = 3
const MAX_GITHUB_ISSUES_BYTES = 1_250_000
const MAX_STATUS_OUTPUT_BYTES = 512 * 1024
const MAX_GRAPH_OUTPUT_BYTES = 512 * 1024
const ISSUE_LIST_JQ = `map(.bodyTruncated = ((.body // "") | length > ${MAX_GITHUB_ISSUE_BODY_CHARS}) | .body = ((.body // "")[:${MAX_GITHUB_ISSUE_BODY_CHARS}]) | .labelsHasMore = ((.labels // []) | length > ${MAX_GITHUB_ISSUE_LABELS}) | .labels = [(.labels // [])[:${MAX_GITHUB_ISSUE_LABELS}][] | {name: .name}])`
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_FILE_NAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])

function parseStatusPage(output, { limit = MAX_GIT_STATUS_FILES, sourceTruncated = false } = {}) {
  const lastDelimiter = output.lastIndexOf('\0')
  const completeOutput = sourceTruncated && !output.endsWith('\0') ? output.slice(0, lastDelimiter + 1) : output
  const entries = completeOutput.split('\0').filter(Boolean)
  const files = []
  let incompleteRename = false
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const code = entry.slice(0, 2)
    const filePath = entry.slice(3)
    let previousPath
    // Nel formato -z una rinomina aggiunge il vecchio path come entry successiva.
    if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') {
      if (!entries[index + 1]) {
        incompleteRename = sourceTruncated
        break
      }
      previousPath = entries[index + 1]
      index += 1
    }
    files.push({ path: filePath, ...(previousPath ? { previousPath } : {}), ...(isSensitiveGitPath(filePath) ? { sensitive: true } : {}), index: code[0], workingTree: code[1] })
  }
  const hasMore = sourceTruncated || incompleteRename || files.length > limit
  return { files: files.slice(0, limit), hasMore, truncated: hasMore }
}

function parseStatus(output) {
  return parseStatusPage(output).files
}

function isSensitiveGitPath(filePath) {
  const fileName = path.posix.basename(String(filePath)).toLowerCase()
  if (SAFE_ENV_TEMPLATES.has(fileName)) return false
  return fileName.startsWith('.env') || SENSITIVE_FILE_NAMES.has(fileName) || /\.(pem|key|p12|pfx)$/i.test(fileName)
}

function parseHistory(output) {
  if (!output) return []
  return output.split('\x1e').map((record) => record.replace(/^[\r\n]+|[\r\n]+$/g, '')).filter(Boolean).map((record) => {
    const [sha, subject, author, date] = record.split('\x1f')
    return { sha, subject, author, date }
  })
}

function parseGraphPage(output, { limit = MAX_GIT_GRAPH_COMMITS, sourceTruncated = false } = {}) {
  if (!output) return { graph: [], hasMore: sourceTruncated, truncated: sourceTruncated }
  const lastDelimiter = output.lastIndexOf('\n')
  const completeOutput = sourceTruncated && !output.endsWith('\n') ? output.slice(0, lastDelimiter + 1) : output
  const graph = completeOutput.split('\n').filter(Boolean).map((row) => {
    const [sha, parents = '', refs = '', author = '', date = '', ...subjectParts] = row.split('\x1f')
    const subject = subjectParts.join('\x1f')
    return {
      sha,
      parents: parents ? parents.split(' ') : [],
      refs: refs ? refs.split(', ').filter(Boolean) : [],
      subject,
      ...(author ? { author } : {}),
      ...(date ? { date } : {}),
    }
  })
  const hasMore = sourceTruncated || graph.length > limit
  return { graph: graph.slice(0, limit), hasMore, truncated: hasMore }
}

function parseGraph(output) {
  return parseGraphPage(output).graph
}

function takeJsonBudget(items, { maxItems, maxBytes }) {
  const limited = []
  let bytes = 2
  for (const item of items) {
    if (limited.length >= maxItems) break
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + (limited.length > 0 ? 1 : 0)
    if (bytes + itemBytes > maxBytes) break
    limited.push(item)
    bytes += itemBytes
  }
  return { items: limited, hasMore: limited.length < items.length, bytes }
}

function parseIssuesPage(output, { sourceTruncated = false } = {}) {
  let payload
  try {
    payload = JSON.parse(output)
  } catch {
    throw createPublicError('GITHUB_RESPONSE_INVALID', 'Risposta GitHub non valida.')
  }
  if (!Array.isArray(payload)) throw new Error('Elenco issue GitHub non valido.')
  const page = takeJsonBudget(payload, { maxItems: MAX_GITHUB_ISSUES, maxBytes: MAX_GITHUB_ISSUES_BYTES })
  const hasMore = sourceTruncated || page.hasMore
  return { issues: page.items, hasMore, truncated: hasMore, resultBytes: page.bytes }
}

function assertBranchName(branchName) {
  if (typeof branchName !== 'string' || branchName.length === 0 || branchName.length > 255 || branchName.startsWith('-') || branchName.startsWith('/') || branchName.endsWith('/') || branchName.endsWith('.') || branchName.includes('..') || branchName.includes('@{') || !/^[A-Za-z0-9._/-]+$/.test(branchName)) throw new Error('Branch non valido.')
  return branchName
}

function assertGitHubRemoteUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2_048) throw new Error('Inserisci l’URL GitHub del repository.')
  const value = rawUrl.trim()
  const httpsMatch = /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(value)
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}/${httpsMatch[2].replace(/\.git$/i, '')}.git`
  const sshMatch = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(value)
  if (sshMatch) return `git@github.com:${sshMatch[1]}/${sshMatch[2].replace(/\.git$/i, '')}.git`
  throw new Error('Usa un URL GitHub HTTPS o SSH valido.')
}

function assertGitHubRepositoryName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0 || rawName.length > 200) throw new Error('Inserisci un nome repository valido.')
  const name = rawName.trim()
  if (!/^(?:[\w.-]+\/)?[\w.-]+$/.test(name) || name.startsWith('.') || name.endsWith('.git')) {
    throw new Error('Il nome repository può contenere lettere, numeri, punti, trattini e un owner opzionale.')
  }
  return name
}

function parseBranches(output) {
  return output.split('\0').map((entry) => entry.replace(/^[\r\n]+/, '')).filter(Boolean).map((entry) => {
    const current = entry.startsWith('* ')
    const name = entry.startsWith('* ') || entry.startsWith('  ') ? entry.slice(2) : entry.trim()
    return { name, current }
  }).filter((branch) => branch.name)
}

function assertFilePaths(filePaths, { allowSensitive = false } = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0 || filePaths.length > 1_000) throw new Error('Seleziona almeno un file valido.')
  return filePaths.map((filePath) => {
    if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4_096 || path.isAbsolute(filePath)) throw new Error('Percorso file non valido.')
    const normalized = path.posix.normalize(filePath)
    if (normalized === '..' || normalized.startsWith('../') || normalized === '.git' || normalized.startsWith('.git/')) throw new Error('Il percorso richiesto non è consentito.')
    if (!allowSensitive && isSensitiveGitPath(normalized)) throw new Error('Il file riservato non può essere aggiunto dallo strumento Git.')
    return normalized
  })
}

function chunkGitFilePaths(filePaths) {
  const chunks = []
  let current = []
  let currentBytes = 0
  for (const filePath of filePaths) {
    const pathBytes = Buffer.byteLength(filePath, 'utf8') + 1
    if (current.length > 0 && (current.length >= MAX_GIT_PATHS_PER_COMMAND || currentBytes + pathBytes > MAX_GIT_PATH_ARGUMENT_BYTES)) {
      chunks.push(current)
      current = []
      currentBytes = 0
    }
    current.push(filePath)
    currentBytes += pathBytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

module.exports = {
  ISSUE_LIST_JQ,
  MAX_GIT_BRANCHES,
  MAX_GIT_GRAPH_COMMITS,
  MAX_GIT_STATUS_FILES,
  MAX_GITHUB_ISSUES,
  MAX_GRAPH_OUTPUT_BYTES,
  MAX_STATUS_OUTPUT_BYTES,
  assertBranchName,
  assertFilePaths,
  assertGitHubRemoteUrl,
  assertGitHubRepositoryName,
  chunkGitFilePaths,
  isSensitiveGitPath,
  parseBranches,
  parseGraph,
  parseGraphPage,
  parseHistory,
  parseIssuesPage,
  parseStatus,
  parseStatusPage,
  takeJsonBudget,
}
