const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_QUEUE_BYTES = 256 * 1024
const DEFAULT_MAX_WRITE_ATTEMPTS = 3
const MAX_STRING_BYTES = 256
const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'warning', 'error'])
const ALLOWED_NUMBER_FIELDS = new Set(['errorCode', 'exitCode', 'failed', 'globalCount', 'line', 'pid', 'rows', 'scrubbed', 'size', 'total', 'workspaceCount'])
const ALLOWED_BOOLEAN_FIELDS = new Set(['isMainFrame'])
const ALLOWED_STRING_FIELDS = new Set([
  'category',
  'code',
  'component',
  'connectionId',
  'correlationId',
  'eventChannel',
  'fingerprint',
  'operation',
  'reason',
  'sessionId',
  'severity',
  'signal',
  'technicalCode',
  'technicalDetail',
  'technicalName',
])
const USER_ERROR_CATEGORIES = new Set([
  'validation',
  'not-found',
  'permission',
  'authentication',
  'network',
  'timeout',
  'cancelled',
  'conflict',
  'process',
  'database',
  'filesystem',
  'git',
  'github',
  'remote',
  'configuration',
  'persistence',
  'internal',
])
const USER_ERROR_SEVERITIES = new Set(['info', 'warning', 'error'])

function safeEvent(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_]{0,95}$/u.test(value) ? value : 'invalid_event'
}

function sanitizeString(value) {
  let sanitized = String(value)
    .replace(/\b(password|passwd|token|secret|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(/\/(?:Users|home)\/[^\s/]+(?:\/[^\s]*)?/gu, '[path]')
    .replace(/[A-Za-z]:\\[^\r\n\t ]+/gu, '[path]')
  while (Buffer.byteLength(sanitized, 'utf8') > MAX_STRING_BYTES) sanitized = sanitized.slice(0, -1)
  return sanitized
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {}
  const sanitized = {}
  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value
    else if (ALLOWED_BOOLEAN_FIELDS.has(key) && typeof value === 'boolean') sanitized[key] = value
    else if (ALLOWED_STRING_FIELDS.has(key) && typeof value === 'string') sanitized[key] = sanitizeString(value)
  }
  return sanitized
}

function parseRendererDiagnosticMessage(message) {
  if (typeof message !== 'string' || Buffer.byteLength(message, 'utf8') > 1_024) return null
  let value
  try {
    value = JSON.parse(message)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  if (value.event === 'renderer_app_error') {
    if (Object.keys(value).some((key) => !['event', 'reason', 'sessionId'].includes(key))) return null
    if (typeof value.sessionId !== 'string' || !/^renderer-[a-z0-9-]{1,64}$/iu.test(value.sessionId)) return null
    if (typeof value.reason !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(value.reason)) return null
    return { event: value.event, fields: { reason: value.reason, sessionId: value.sessionId } }
  }

  if (value.event !== 'renderer_user_error') return null
  const allowedKeys = ['category', 'code', 'component', 'correlationId', 'event', 'operation', 'severity']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return null
  if (!USER_ERROR_CATEGORIES.has(value.category)) return null
  if (!USER_ERROR_SEVERITIES.has(value.severity)) return null
  if (typeof value.correlationId !== 'string' || !/^ERR-[A-F0-9]{6}$/u.test(value.correlationId)) return null
  if (value.code !== undefined && (typeof value.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code))) return null
  for (const key of ['component', 'operation']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,96}$/u.test(value[key]))) return null
  }
  const fields = {
    category: value.category,
    correlationId: value.correlationId,
    severity: value.severity,
  }
  for (const key of ['code', 'component', 'operation']) {
    if (value[key] !== undefined) fields[key] = value[key]
  }
  return { event: value.event, fields, level: value.severity }
}

function defaultLogsDirectory() {
  return process.env.VINCODELAB_LOGS_DIR || require('electron').app.getPath('logs')
}

function createLogger({
  getLogsDirectory = defaultLogsDirectory,
  maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  maxQueueBytes = DEFAULT_MAX_QUEUE_BYTES,
  maxWriteAttempts = DEFAULT_MAX_WRITE_ATTEMPTS,
  now = () => new Date(),
  fileSystem = fs,
} = {}) {
  if (typeof getLogsDirectory !== 'function') throw new Error('Directory log non valida.')
  if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 1_024) throw new Error('Dimensione log non valida.')
  if (!Number.isSafeInteger(maxQueueBytes) || maxQueueBytes < 1_024) throw new Error('Dimensione coda log non valida.')
  if (!Number.isSafeInteger(maxWriteAttempts) || maxWriteAttempts < 1 || maxWriteAttempts > 10) throw new Error('Numero tentativi log non valido.')
  if (!fileSystem?.promises) throw new Error('Filesystem log non valido.')

  const queue = []
  let queueBytes = 0
  let droppedEntries = 0
  let draining = null
  let scheduled = false
  let logFile

  async function resolveLogFile() {
    if (logFile) return logFile
    const directory = path.join(getLogsDirectory(), 'VincodeLab')
    await fileSystem.promises.mkdir(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') await fileSystem.promises.chmod(directory, 0o700)
    logFile = path.join(directory, 'app.log')
    return logFile
  }

  async function rotateIfNeeded(filePath, incomingBytes) {
    let size = 0
    try {
      size = (await fileSystem.promises.stat(filePath)).size
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (size === 0 || size + incomingBytes <= maxLogBytes) return
    await fileSystem.promises.rm(`${filePath}.1`, { force: true })
    await fileSystem.promises.rename(filePath, `${filePath}.1`)
  }

  function enqueueLine(line, { attempt = 0, dropNotice = false, prepend = false } = {}) {
    const bytes = Buffer.byteLength(line, 'utf8')
    if (bytes > maxQueueBytes) {
      if (!dropNotice) droppedEntries += 1
      return
    }
    const entry = { attempt, bytes, dropNotice, line }
    if (prepend) queue.unshift(entry)
    else queue.push(entry)
    queueBytes += bytes
    while (queueBytes > maxQueueBytes && queue.length > 0) {
      const removed = queue.shift()
      queueBytes -= removed.bytes
      if (!removed.dropNotice) droppedEntries += 1
    }
  }

  function requeueFailedBatch(batch) {
    const retryable = []
    for (const entry of batch) {
      const attempt = entry.attempt + 1
      if (attempt < maxWriteAttempts) retryable.push({ ...entry, attempt })
    }
    for (let index = retryable.length - 1; index >= 0; index -= 1) {
      const entry = retryable[index]
      enqueueLine(entry.line, { attempt: entry.attempt, dropNotice: entry.dropNotice, prepend: true })
    }
  }

  async function drain() {
    if (draining) return draining
    draining = (async () => {
      while (queue.length > 0 || droppedEntries > 0) {
        const batch = queue.splice(0)
        queueBytes = 0
        const dropped = droppedEntries
        droppedEntries = 0
        if (dropped > 0) {
          const timestamp = now().toISOString()
          const line = `${JSON.stringify({ timestamp, level: 'warn', event: 'log_queue_entries_dropped', total: dropped })}\n`
          batch.unshift({ attempt: 0, bytes: Buffer.byteLength(line), dropNotice: true, line })
        }
        const body = batch.map((entry) => entry.line).join('')
        if (!body) continue
        try {
          const filePath = await resolveLogFile()
          await rotateIfNeeded(filePath, Buffer.byteLength(body))
          await fileSystem.promises.appendFile(filePath, body, { encoding: 'utf8', mode: 0o600 })
        } catch {
          // Il logging è osservativo e non può interrompere il lifecycle dell'app.
          // Il batch viene ritentato in modo bounded; dopo il limite viene scartato
          // senza generare un nuovo evento che fallirebbe sullo stesso sink.
          requeueFailedBatch(batch)
        }
      }
    })().finally(() => { draining = null })
    return draining
  }

  function scheduleDrain() {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      void drain()
    })
  }

  function log(level, event, fields = {}) {
    const entry = {
      timestamp: now().toISOString(),
      level: ALLOWED_LEVELS.has(level) ? level : 'info',
      event: safeEvent(event),
      ...sanitizeFields(fields),
    }
    enqueueLine(`${JSON.stringify(entry)}\n`)
    scheduleDrain()
  }

  async function flush() {
    await Promise.resolve()
    while (draining || queue.length > 0 || droppedEntries > 0) await (draining ?? drain())
  }

  return { flush, log }
}

const defaultLogger = createLogger()

function log(level, event, fields) {
  defaultLogger.log(level, event, fields)
}

function flushLogs() {
  return defaultLogger.flush()
}

module.exports = { createLogger, flushLogs, log, parseRendererDiagnosticMessage, sanitizeFields, sanitizeString }
