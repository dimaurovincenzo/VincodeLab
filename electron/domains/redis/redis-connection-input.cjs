function mergeRedisTestConnectionSecrets(input, stored) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const merged = { ...input }
  if (!input.password && !input.clearPassword && stored?.password) merged.password = stored.password
  if (input.mode === 'sentinel' && !input.sentinelPassword && !input.clearSentinelPassword && stored?.sentinelPassword) {
    merged.sentinelPassword = stored.sentinelPassword
  }
  return merged
}

module.exports = { mergeRedisTestConnectionSecrets }
