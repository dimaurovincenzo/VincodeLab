function hasControlCharacter(value) {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function validateConnectionConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  const mode = config.mode === undefined ? 'standalone' : config.mode
  if (mode !== 'standalone' && mode !== 'sentinel') throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (typeof config.host !== 'string' || !config.host.trim() || config.host.length > 255) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (!Number.isInteger(config.database) || config.database < 0 || config.database > 65_535) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.username !== undefined && (typeof config.username !== 'string' || !config.username || config.username.length > 255)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.password !== undefined && (typeof config.password !== 'string' || !config.password || config.password.length > 4_096)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (mode === 'sentinel' && (typeof config.sentinelMasterName !== 'string' || !config.sentinelMasterName.trim() || config.sentinelMasterName.length > 255 || hasControlCharacter(config.sentinelMasterName))) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.sentinelUsername !== undefined && (mode !== 'sentinel' || typeof config.sentinelUsername !== 'string' || !config.sentinelUsername || config.sentinelUsername.length > 255)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  if (config.sentinelPassword !== undefined && (mode !== 'sentinel' || typeof config.sentinelPassword !== 'string' || !config.sentinelPassword || config.sentinelPassword.length > 4_096)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return {
    mode, host: config.host.trim(), port: config.port, database: config.database,
    ...(mode === 'sentinel' ? { sentinelMasterName: config.sentinelMasterName.trim() } : {}),
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
    ...(mode === 'sentinel' && config.sentinelUsername ? { sentinelUsername: config.sentinelUsername } : {}),
    ...(mode === 'sentinel' && config.sentinelPassword ? { sentinelPassword: config.sentinelPassword } : {}),
    tls: Boolean(config.tls),
  }
}

function sessionKey(workspacePath, connectionId) {
  if (typeof workspacePath !== 'string' || !workspacePath || typeof connectionId !== 'string' || !connectionId) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return `${workspacePath}\u0000${connectionId}`
}

function encodedKey(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  if (bytes.length > 16_384) throw Object.assign(new Error('redis_result_item_too_large'), { code: 'REDIS_RESULT_TOO_LARGE' })
  const decoded = bytes.toString('utf8')
  const binary = !Buffer.from(decoded, 'utf8').equals(bytes)
  const display = binary
    ? `0x${bytes.toString('hex')}`
    : (decoded ? [...decoded].map((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 ? `\\x${code.toString(16).padStart(2, '0')}` : character
      }).join('') : '(chiave vuota)')
  return Object.freeze({ encoded: bytes.toString('base64'), display, binary })
}

function keyBytes(keyRef) {
  if (Buffer.isBuffer(keyRef)) return keyRef
  if (typeof keyRef === 'string' && keyRef.length && keyRef.length <= 16_384 && !hasControlCharacter(keyRef)) return Buffer.from(keyRef, 'utf8')
  if (!keyRef || typeof keyRef !== 'object' || Array.isArray(keyRef) || typeof keyRef.encoded !== 'string'
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(keyRef.encoded)
    || keyRef.encoded.length > 21_848) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  const bytes = Buffer.from(keyRef.encoded, 'base64')
  if (bytes.length > 16_384 || bytes.toString('base64') !== keyRef.encoded) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return bytes
}

function integerOption(value, fallback, min, max, code = 'redis_input_invalid') {
  value = value === undefined ? fallback : value
  if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error(code), { code: 'REDIS_INPUT_INVALID' })
  return value
}

function cursorOption(value = '0') {
  const cursor = String(value)
  if (!/^\d{1,40}$/u.test(cursor)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return cursor
}

function patternOption(value = '*') {
  if (typeof value !== 'string' || !value || value.length > 512 || hasControlCharacter(value)) throw Object.assign(new Error('redis_input_invalid'), { code: 'REDIS_INPUT_INVALID' })
  return value
}

function normalizeType(value) {
  const normalized = String(value).toLowerCase()
  if (normalized === 'rejson-rl' || normalized === 'json') return 'json'
  return normalized
}

module.exports = {
  cursorOption,
  encodedKey,
  hasControlCharacter,
  integerOption,
  keyBytes,
  normalizeType,
  patternOption,
  sessionKey,
  validateConnectionConfig,
}
