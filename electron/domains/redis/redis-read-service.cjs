const { redisErrorKind, toRedisPublicError } = require('./redis-error-mapper.cjs')
const {
  cursorOption,
  encodedKey,
  integerOption,
  keyBytes,
  normalizeType,
  patternOption,
} = require('./redis-input-model.cjs')
const {
  abortError,
  budgetItems,
  commandClient,
  invoke,
  mapWithConcurrency,
  normalizeScanReply,
  valueForRenderer,
} = require('./redis-operation-utils.cjs')

const REDIS_SCAN_LIMIT = 500
const REDIS_READ_LIMIT = 500
const REDIS_STRING_PREVIEW_BYTE_LIMIT = 256 * 1_024
const REDIS_COLLECTION_PREFETCH_BYTE_LIMIT = 8 * 1_024 * 1_024
const KEY_TYPE_SET = new Set(['string', 'hash', 'list', 'set', 'zset', 'stream', 'json'])

function createRedisReadService({
  getSession,
  invalidateFailedSession,
  metadataConcurrency,
  resultByteLimit,
  resultItemByteLimit,
  resultItemLimit,
} = {}) {
  if (typeof getSession !== 'function' || typeof invalidateFailedSession !== 'function') throw new TypeError('Runtime sessioni Redis non valido.')

  async function metadata(client, key, signal, { includeSize = true, includeTtl = true } = {}) {
    const requests = []
    if (includeTtl) requests.push(invoke(client, ['pTTL', 'pttl'], [key], signal))
    if (includeSize) requests.push(invoke(client, ['memoryUsage'], [key], signal))
    const settled = await Promise.allSettled(requests)
    if (signal?.aborted || settled.some((result) => result.status === 'rejected' && redisErrorKind(result.reason) === 'cancelled')) throw abortError()
    const ttlResult = includeTtl ? settled[0] : undefined
    const sizeResult = includeSize ? settled[includeTtl ? 1 : 0] : undefined
    const ttlValue = ttlResult?.status === 'fulfilled' ? Number(ttlResult.value) : Number.NaN
    const ttlState = !Number.isFinite(ttlValue)
      ? 'unavailable'
      : ttlValue >= 0
        ? 'expires'
        : ttlValue === -1
          ? 'persistent'
          : ttlValue === -2
            ? 'missing'
            : 'unavailable'
    return {
      ...(includeTtl ? { ttlMs: ttlValue >= 0 ? ttlValue : null, ttlState } : {}),
      ...(sizeResult?.status === 'fulfilled' && Number.isFinite(Number(sizeResult.value)) ? { sizeBytes: Number(sizeResult.value) } : {}),
    }
  }

  async function scanRawKeys(client, { cursor, match, count, type, signal }) {
    const reply = await invoke(client, ['scan'], [cursor, {
      MATCH: match,
      COUNT: count,
      ...(type && type !== 'json' ? { TYPE: type } : {}),
    }], signal)
    const normalized = normalizeScanReply(reply, ['keys', 'items'])
    if (normalized.values.length > resultItemLimit) {
      throw Object.assign(new Error('redis_result_too_many_items'), { code: 'REDIS_RESULT_TOO_LARGE' })
    }
    return { rawKeys: normalized.values, nextCursor: normalized.cursor }
  }

  async function estimateSearchTotal(client, maxScanned, signal) {
    try {
      const value = Number(await invoke(client, ['dbSize', 'dbsize'], [], signal))
      return { estimatedTotal: Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maxScanned) : undefined }
    } catch {
      // DBSIZE può essere negato dalle ACL. È solo un aiuto visuale: la
      // ricerca SCAN resta valida e non deve fallire se la stima manca.
      return {}
    }
  }

  async function readKeyFromClient(client, key, {
    collectionPrefetchByteLimit = REDIS_COLLECTION_PREFETCH_BYTE_LIMIT,
    count,
    cursor,
    includeTtl = true,
    offset,
    signal,
    stringPreviewByteLimit = REDIS_STRING_PREVIEW_BYTE_LIMIT,
  }) {
    // TYPE, TTL e MEMORY USAGE sono indipendenti. Inviarli insieme permette a
    // node-redis di accodarli nello stesso ciclo di rete senza cambiare il
    // contratto o richiedere MULTI/EXEC sul server.
    const [typeValue, keyMetadata] = await Promise.all([
      invoke(client, ['type'], [key], signal),
      metadata(client, key, signal, { includeTtl }),
    ])
    const type = normalizeType(typeValue)
    if (type === 'none') throw Object.assign(new Error('redis_key_not_found'), { code: 'REDIS_KEY_NOT_FOUND' })
    if (!KEY_TYPE_SET.has(type)) throw Object.assign(new Error('redis_unsupported_type'), { code: 'REDIS_KEY_TYPE_UNSUPPORTED' })
    const base = { key: encodedKey(key), type, ...keyMetadata }
    let result

    if (type !== 'string') {
      if (!Number.isFinite(base.sizeBytes)) throw Object.assign(new Error('redis_result_size_unavailable'), { code: 'REDIS_SIZE_UNAVAILABLE' })
      const prefetchLimit = type === 'json' ? resultItemByteLimit : collectionPrefetchByteLimit
      if (base.sizeBytes > prefetchLimit) throw Object.assign(new Error('redis_prefetch_too_large'), { code: 'REDIS_PREFETCH_TOO_LARGE' })
    }

    if (type === 'string') {
      const previewLimit = Math.max(1, Math.min(resultItemByteLimit, stringPreviewByteLimit))
      const [totalValue, previewValue] = await Promise.all([
        invoke(client, ['strLen', 'strlen'], [key], signal),
        invoke(client, ['getRange', 'getrange'], [key, 0, previewLimit - 1], signal),
      ])
      const totalBytes = Number(totalValue)
      if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new Error('redis_invalid_string_length')
      const value = valueForRenderer(totalBytes === 0 ? Buffer.alloc(0) : previewValue)
      result = { ...base, value, previewBytes: Math.min(totalBytes, previewLimit), totalBytes, truncated: totalBytes > previewLimit }
    } else if (type === 'list') {
      const [values, totalValue] = await Promise.all([
        invoke(client, ['lRange', 'lrange'], [key, offset, offset + count - 1], signal),
        invoke(client, ['lLen', 'llen'], [key], signal),
      ])
      const total = Number(totalValue)
      const page = (Array.isArray(values) ? values : []).slice(0, count).map((value, index) => ({ index: offset + index, value: valueForRenderer(value) }))
      result = { ...base, items: page, nextOffset: offset + page.length, total, hasMore: offset + page.length < total }
    } else if (type === 'hash') {
      const reply = normalizeScanReply(await invoke(client, ['hScan', 'hscan'], [key, cursor, { COUNT: count }], signal), ['entries', 'tuples'])
      let entries = reply.values
      if (entries.length && !Array.isArray(entries[0]) && typeof entries[0] !== 'object') {
        const flat = entries; entries = []
        for (let index = 0; index < flat.length; index += 2) entries.push({ field: flat[index], value: flat[index + 1] })
      }
      entries = entries.map((entry) => Array.isArray(entry)
        ? { field: valueForRenderer(entry[0]), value: valueForRenderer(entry[1]) }
        : { field: valueForRenderer(entry.field), value: valueForRenderer(entry.value) })
      result = { ...base, entries, cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'set') {
      const reply = normalizeScanReply(await invoke(client, ['sScan', 'sscan'], [key, cursor, { COUNT: count }], signal), ['members', 'items'])
      result = { ...base, members: reply.values.map(valueForRenderer), cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'zset') {
      const reply = normalizeScanReply(await invoke(client, ['zScan', 'zscan'], [key, cursor, { COUNT: count }], signal), ['members', 'items'])
      let members = reply.values
      if (members.length && typeof members[0] !== 'object') {
        const flat = members; members = []
        for (let index = 0; index < flat.length; index += 2) members.push({ value: flat[index], score: flat[index + 1] })
      }
      members = members.map((member) => ({ value: valueForRenderer(member.value), score: Number(member.score) }))
      result = { ...base, members, cursor: reply.cursor, hasMore: reply.cursor !== '0' }
    } else if (type === 'stream') {
      const start = cursor !== '0' ? `(${cursor}` : '-'
      const values = await invoke(client, ['xRange', 'xrange'], [key, start, '+', { COUNT: count + 1 }], signal)
      const page = (Array.isArray(values) ? values : []).slice(0, count).map((entry) => ({
        id: valueForRenderer(entry.id ?? entry[0]),
        fields: Object.entries(entry.message ?? entry[1] ?? {}).map(([field, value]) => ({ field, value: valueForRenderer(value) })),
      }))
      const nextCursor = page.at(-1)?.id ?? cursor
      result = { ...base, entries: page, cursor: nextCursor, hasMore: Array.isArray(values) && values.length > count }
    } else {
      const jsonClient = commandClient(client, signal)
      if (!jsonClient.json || typeof jsonClient.json.get !== 'function') throw Object.assign(new Error('redis_json_unavailable'), { code: 'REDIS_READ_FAILED' })
      result = { ...base, value: await jsonClient.json.get(key) }
    }
    let measured
    try {
      measured = budgetItems([result], { byteLimit: resultByteLimit, itemByteLimit: resultItemByteLimit, itemLimit: 1 })
    } catch (error) {
      // Solo un contatore numerico, mai payload: consente alla ricerca di
      // contabilizzare anche una risposta già letta ma scartata dal budget IPC.
      const readBytes = type === 'string'
        ? result.previewBytes
        : Number.isFinite(base.sizeBytes) ? Math.max(1, Math.ceil(base.sizeBytes)) : resultItemByteLimit
      if (error && (typeof error === 'object' || typeof error === 'function')) {
        try { Object.defineProperty(error, 'redisReadBytes', { value: readBytes }) } catch { /* Contatore diagnostico best effort. */ }
      }
      throw error
    }
    return Object.freeze({ ...result, resultBytes: measured.bytes })
  }

  async function scanKeys(workspacePath, connectionId, input = {}) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('redis_input_invalid')
      const cursor = cursorOption(input.cursor)
      const match = patternOption(input.match)
      const count = integerOption(input.count, 100, 1, REDIS_SCAN_LIMIT)
      const type = input.type === undefined || input.type === 'all' ? null : normalizeType(input.type)
      if (type && !KEY_TYPE_SET.has(type)) throw new Error('redis_input_invalid')
      const { client } = await getSession(workspacePath, connectionId, { signal: input.signal })
      const { rawKeys, nextCursor } = await scanRawKeys(client, { cursor, match, count, type, signal: input.signal })
      const summaries = await mapWithConcurrency(rawKeys, metadataConcurrency, async (key) => {
        const [keyTypeValue, keyMetadata] = await Promise.all([
          type && type !== 'json' ? type : invoke(client, ['type'], [key], input.signal),
          metadata(client, key, input.signal, { includeSize: false }),
        ])
        const keyType = normalizeType(keyTypeValue)
        return { key: encodedKey(key), type: keyType, ...keyMetadata }
      })
      const filtered = summaries.filter((item) => KEY_TYPE_SET.has(item.type) && (!type || item.type === type))
      const { bytes, items } = budgetItems(filtered, { byteLimit: resultByteLimit, itemByteLimit: resultItemByteLimit, itemLimit: resultItemLimit })
      return Object.freeze({
        items, nextCursor, complete: nextCursor === '0', resultBytes: bytes, scanned: rawKeys.length,
        // Alias mantenuti per il renderer iniziale; non contengono mai il valore della chiave.
        cursor: nextCursor, keys: items, hasMore: nextCursor !== '0',
      })
    } catch (error) {
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  async function readKey(workspacePath, connectionId, keyRef, options = {}) {
    try {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('redis_input_invalid')
      const key = keyBytes(keyRef)
      const count = integerOption(options.count, 100, 1, REDIS_READ_LIMIT)
      const cursor = cursorOption(options.cursor)
      const offset = integerOption(options.offset, 0, 0, 2_147_483_647)
      const { client } = await getSession(workspacePath, connectionId, { signal: options.signal })
      return await readKeyFromClient(client, key, { count, cursor, offset, signal: options.signal })
    } catch (error) {
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  return Object.freeze({ estimateSearchTotal, readKey, readKeyFromClient, scanKeys, scanRawKeys })
}

module.exports = {
  createRedisReadService,
  KEY_TYPE_SET,
  REDIS_COLLECTION_PREFETCH_BYTE_LIMIT,
  REDIS_READ_LIMIT,
  REDIS_SCAN_LIMIT,
  REDIS_STRING_PREVIEW_BYTE_LIMIT,
}
