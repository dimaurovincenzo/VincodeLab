function redisKeyForRenderer(keyRef) {
  if (!keyRef || typeof keyRef !== 'object' || Array.isArray(keyRef) || typeof keyRef.encoded !== 'string') {
    throw new Error('Riferimento chiave Redis non valido.')
  }
  const binary = keyRef.binary === true
  const display = binary
    ? `base64:${keyRef.encoded.slice(0, 48)}${keyRef.encoded.length > 48 ? '…' : ''}`
    : typeof keyRef.display === 'string' && keyRef.display ? keyRef.display : '(chiave vuota)'
  return { key: display, keyRef: keyRef.encoded, binary }
}

function redisSummaryForRenderer(summary) {
  const { key, ...metadata } = summary
  return { ...redisKeyForRenderer(key), ...metadata }
}

function redisInspectionForRenderer(inspection) {
  const { key, resultBytes: _resultBytes, ...value } = inspection
  return { ...value, ...redisKeyForRenderer(key) }
}

function redisSearchForRenderer(result) {
  return {
    ...result,
    matches: Array.isArray(result?.matches) ? result.matches.map(redisSummaryForRenderer) : [],
  }
}

module.exports = {
  redisInspectionForRenderer,
  redisKeyForRenderer,
  redisSearchForRenderer,
  redisSummaryForRenderer,
}
