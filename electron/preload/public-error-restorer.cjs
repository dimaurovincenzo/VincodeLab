// BEGIN PRELOAD_PUBLIC_ERROR_RESTORER
const IPC_REJECTION_PATTERN = /^Error invoking remote method '([^']+)': Error:\s*(.+?)\s+\[([A-Z][A-Z0-9_]{2,63})\]\s+\[(ERR-[A-F0-9]{6})\]\s*$/u
const SAFE_CHANNEL_PATTERN = /^[a-zA-Z][a-zA-Z0-9:._-]{1,95}$/u
const MAX_PUBLIC_MESSAGE_LENGTH = 320
const GIT_OPERATIONS = new Set(['addRemote', 'branches', 'commit', 'createBranch', 'fetch', 'fileDiff', 'gitStatus', 'initRepository', 'pullRebase', 'push', 'revert', 'stage', 'switchBranch', 'unstage'])

function safePreloadProperty(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    return Reflect.get(value, key)
  } catch {
    return undefined
  }
}

function trustedPublicMessage(value) {
  if (typeof value !== 'string' || value.length > MAX_PUBLIC_MESSAGE_LENGTH) return null
  if (/\p{Cc}|\b(?:password|passwd|pwd|token|secret|authorization|cookie|api[-_ ]?key)\b\s*[:=]|\b(?:bearer|basic)\s+|[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\/(?:Users|home|tmp|private\/tmp|var\/folders|opt|etc|srv|mnt)\//iu.test(value)) return null
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized && normalized === value ? normalized : null
}

function fallbackPreloadCategory(channel) {
  const [namespace, operation = ''] = channel.split(':', 2)
  if (namespace === 'database' || namespace === 'redis') return 'database'
  if (namespace === 'github') return GIT_OPERATIONS.has(operation) ? 'git' : 'github'
  if (namespace === 'remoteFiles' || namespace === 'managedSsh') return 'remote'
  if (namespace === 'files' || namespace === 'instructions' || namespace === 'skills' || namespace === 'systemSkills') return 'filesystem'
  if (namespace === 'workspaceSession' || namespace === 'volatileDrafts') return 'persistence'
  if (namespace === 'workspace') return 'filesystem'
  if (namespace === 'piConfig' || namespace === 'piSystem' || namespace === 'runtime' || namespace === 'appearance' || namespace === 'preferences') return 'configuration'
  if (namespace === 'pi' || namespace === 'terminal' || namespace === 'shellSessions' || namespace === 'updates') return 'process'
  return 'internal'
}

function preloadCategoryFromCode(code, channel) {
  if (/(?:^|_)(?:CANCELLED|CANCELED|ABORTED)(?:_|$)/u.test(code)) return 'cancelled'
  if (/(?:AUTH|LOGIN|TOKEN_(?:EXPIRED|INVALID|MISSING)|CREDENTIALS?)/u.test(code)) return 'authentication'
  if (/(?:PERMISSION|FORBIDDEN|READ_ONLY|EACCES|EPERM)/u.test(code)) return 'permission'
  if (/(?:CONFIG|NOT_CONFIGURED|API_KEY|ENVIRONMENT)/u.test(code)) return 'configuration'
  if (/(?:TIMEOUT|TIMED_OUT|DEADLINE)/u.test(code)) return 'timeout'
  if (/(?:CONFLICT|STALE|ALREADY_EXISTS|NON_FAST_FORWARD)/u.test(code)) return 'conflict'
  if (/(?:RATE_LIMIT|TOO_MANY_REQUESTS|NETWORK|OFFLINE|CONNECTION|UNREACHABLE)/u.test(code)) return 'network'
  if (/(?:NOT_FOUND|MISSING|NO_SUCH)/u.test(code)) return 'not-found'
  if (/(?:INVALID|VALIDATION|MALFORMED|PARSE|SYNTAX|UNSUPPORTED)/u.test(code)) return 'validation'
  return fallbackPreloadCategory(channel)
}

function preloadSeverityFor(category) {
  if (category === 'cancelled') return 'info'
  if (category === 'configuration' || category === 'conflict' || category === 'validation') return 'warning'
  return 'error'
}

function restorePublicInvokeError(error, expectedChannel) {
  if (typeof expectedChannel !== 'string' || !SAFE_CHANNEL_PATTERN.test(expectedChannel)) return error
  const rawMessage = typeof error === 'string' ? error : safePreloadProperty(error, 'message')
  if (typeof rawMessage !== 'string') return error
  const match = rawMessage.match(IPC_REJECTION_PATTERN)
  if (!match || match[1] !== expectedChannel) return error
  const message = trustedPublicMessage(match[2])
  if (!message) return error
  const code = match[3]
  const correlationId = match[4]
  const category = preloadCategoryFromCode(code, expectedChannel)
  return Object.freeze({
    category,
    code,
    correlationId,
    message: `${message} [${code}] [${correlationId}]`,
    recoverable: category !== 'cancelled',
    severity: preloadSeverityFor(category),
  })
}
// END PRELOAD_PUBLIC_ERROR_RESTORER

module.exports = { restorePublicInvokeError }
