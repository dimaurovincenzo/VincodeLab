const { normalizeRedisError, toRedisPublicError } = require('./redis-error-mapper.cjs')
const {
  hasControlCharacter,
  integerOption,
  keyBytes,
  normalizeType,
  patternOption,
} = require('./redis-input-model.cjs')
const { abortError, budgetItems, mapWithConcurrency } = require('./redis-operation-utils.cjs')
const { KEY_TYPE_SET } = require('./redis-read-service.cjs')

const REDIS_SEARCH_KEY_LIMIT = 10_000
const REDIS_SEARCH_MATCH_LIMIT = 100
const REDIS_SEARCH_STRING_PREVIEW_BYTE_LIMIT = 32 * 1_024

function findSearchablePart(inspection, query) {
  const match = (value, path) => {
    if (typeof value !== 'string') return null
    const matchIndex = value.toLocaleLowerCase().indexOf(query)
    return matchIndex < 0 ? null : { matchIndex, path, value }
  }
  if (inspection.type === 'string') return match(inspection.value)
  if (inspection.type === 'hash') {
    for (const { field, value } of inspection.entries) {
      const found = match(field, field) ?? match(value, field)
      if (found) return found
    }
  } else if (inspection.type === 'list') {
    for (const { index, value } of inspection.items) {
      const found = match(value, `[${index}]`)
      if (found) return found
    }
  } else if (inspection.type === 'set' || inspection.type === 'zset') {
    for (const member of inspection.members) {
      const found = match(typeof member === 'string' ? member : member.value)
      if (found) return found
    }
  } else if (inspection.type === 'stream') {
    for (const entry of inspection.entries) {
      for (const { field, value } of entry.fields) {
        const found = match(value, `${entry.id}.${field}`)
        if (found) return found
      }
    }
  } else if (inspection.type === 'json') {
    return match(JSON.stringify(inspection.value), '$')
  }
  return null
}

function createRedisSearchService({
  estimateSearchTotal,
  getSession,
  invalidateFailedSession,
  readKeyFromClient,
  resultByteLimit,
  resultItemByteLimit,
  scanRawKeys,
  searchConcurrency,
  searchReadByteLimit,
} = {}) {
  if ([estimateSearchTotal, getSession, invalidateFailedSession, readKeyFromClient, scanRawKeys].some((dependency) => typeof dependency !== 'function')) {
    throw new TypeError('Servizio lettura Redis non valido.')
  }

  async function searchKeys(workspacePath, connectionId, input = {}, progress) {
    let operationId = typeof input?.operationId === 'string' ? input.operationId : ''
    let scanned = 0
    let truncated = false
    let partialPayloads = false
    let searchReadBytes = 0
    let searchReadBudgetExhausted = false
    let matches = []
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.operationId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.operationId)) throw new Error('redis_input_invalid')
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 256 || hasControlCharacter(input.query)) throw new Error('redis_input_invalid')
      if (progress !== undefined && typeof progress !== 'function') throw new Error('redis_input_invalid')
      operationId = input.operationId
      const query = input.query.toLocaleLowerCase()
      const count = integerOption(input.count, 100, 1, 200)
      const limit = integerOption(input.limit, 50, 1, REDIS_SEARCH_MATCH_LIMIT)
      const maxScanned = integerOption(input.maxScanned, REDIS_SEARCH_KEY_LIMIT, 1, REDIS_SEARCH_KEY_LIMIT)
      const exactKey = input.keyRef === undefined ? null : keyBytes({ encoded: input.keyRef })
      const keyPattern = exactKey ? null : patternOption(input.keyPattern)
      const typeFilter = input.type === undefined || input.type === 'all' ? null : normalizeType(input.type)
      if (typeFilter && !KEY_TYPE_SET.has(typeFilter)) throw new Error('redis_input_invalid')
      const { client } = await getSession(workspacePath, connectionId, { signal: input.signal })
      let estimateResult = exactKey ? { estimatedTotal: 1 } : null
      if (!exactKey) {
        // La stima è strettamente best-effort: non entra mai nel critical path
        // di SCAN, progress o risultato. Il timeout comando ne limita comunque
        // la durata e il segnale dell’operazione la interrompe in cancellazione.
        void estimateSearchTotal(client, maxScanned, input.signal).then((result) => { estimateResult = result })
      }
      let estimatedTotal
      let cursor = '0'
      do {
        if (input.signal?.aborted) return Object.freeze({ operationId, scanned, matches, truncated, cancelled: true })
        const page = exactKey
          ? { rawKeys: [exactKey], nextCursor: '0' }
          : await scanRawKeys(client, {
            cursor,
            match: keyPattern,
            count,
            type: typeFilter,
            signal: input.signal,
          })
        cursor = page.nextCursor
        let pageIndex = 0
        while (pageIndex < page.rawKeys.length && scanned < maxScanned && matches.length < limit && !searchReadBudgetExhausted) {
          const batchSize = Math.min(searchConcurrency, page.rawKeys.length - pageIndex, maxScanned - scanned)
          const batch = page.rawKeys.slice(pageIndex, pageIndex + batchSize)
          pageIndex += batch.length
          const outcomes = await mapWithConcurrency(batch, searchConcurrency, async (key) => {
            let inspection
            try {
              inspection = await readKeyFromClient(client, key, {
                collectionPrefetchByteLimit: resultItemByteLimit,
                count: Math.min(count, 50),
                cursor: '0',
                includeTtl: false,
                offset: 0,
                signal: input.signal,
                stringPreviewByteLimit: REDIS_SEARCH_STRING_PREVIEW_BYTE_LIMIT,
              })
            } catch (error) {
              const kind = normalizeRedisError(error).kind
              if (kind === 'size-unavailable' || kind === 'prefetch-too-large') return { partial: true }
              if (kind === 'result-too-large') {
                return {
                  partial: true,
                  readBytes: Number.isSafeInteger(error?.redisReadBytes) && error.redisReadBytes > 0
                    ? error.redisReadBytes
                    : resultItemByteLimit,
                }
              }
              if (kind === 'key-not-found' || kind === 'type-changed' || error?.code === 'REDIS_KEY_TYPE_UNSUPPORTED') return {}
              throw error
            }
            if (typeFilter && inspection.type !== typeFilter) return {}
            const part = findSearchablePart(inspection, query)
            return { inspection, part, partial: Boolean(inspection.truncated || inspection.hasMore) }
          })
          for (let index = 0; index < outcomes.length; index += 1) {
            scanned += 1
            const { inspection, part, partial, readBytes } = outcomes[index]
            if (partial) partialPayloads = true
            const accountedBytes = inspection?.resultBytes ?? readBytes
            if (Number.isSafeInteger(accountedBytes) && accountedBytes > 0) {
              // Tutte le letture del batch sono già in volo: vengono conteggiate
              // integralmente, ma nessun batch successivo parte dopo il limite.
              // L'overshoot massimo resta quindi il solo batch già in volo.
              searchReadBytes += accountedBytes
              if (searchReadBytes >= searchReadByteLimit) {
                searchReadBudgetExhausted = true
                partialPayloads = true
              }
            }
            if (!inspection) continue
            if (!part) continue
            if (matches.length >= limit) {
              truncated = true
              continue
            }
            const excerptStart = Math.max(0, part.matchIndex - 80)
            matches.push({
              key: inspection.key,
              type: inspection.type,
              excerpt: part.value.slice(excerptStart, excerptStart + 240),
              ...(part.path ? { path: part.path } : {}),
            })
            if (matches.length >= limit && index < outcomes.length - 1) truncated = true
          }
        }
        if (input.signal?.aborted) throw abortError()
        estimatedTotal ??= estimateResult?.estimatedTotal
        const snapshot = {
          operationId,
          scanned,
          matches: [...matches],
          ...(estimatedTotal !== undefined ? { estimatedTotal } : {}),
        }
        if (progress) await Promise.resolve(progress(Object.freeze(snapshot)))
        if (searchReadBudgetExhausted) {
          truncated = true
          break
        }
        if (matches.length >= limit || scanned >= maxScanned) {
          if (pageIndex < page.rawKeys.length || cursor !== '0') truncated = true
          break
        }
      } while (cursor !== '0')
      const bounded = budgetItems(matches, { byteLimit: resultByteLimit, itemByteLimit: 16 * 1024, itemLimit: limit })
      matches = bounded.items
      return Object.freeze({ operationId, scanned, matches: bounded.items, resultBytes: bounded.bytes, truncated: truncated || partialPayloads || cursor !== '0', cancelled: false })
    } catch (error) {
      if (input?.signal?.aborted) return Object.freeze({ operationId, scanned, matches, truncated, cancelled: true })
      await invalidateFailedSession(workspacePath, connectionId, error)
      throw toRedisPublicError(error)
    }
  }

  return Object.freeze({ searchKeys })
}

module.exports = {
  createRedisSearchService,
  findSearchablePart,
  REDIS_SEARCH_KEY_LIMIT,
  REDIS_SEARCH_MATCH_LIMIT,
  REDIS_SEARCH_STRING_PREVIEW_BYTE_LIMIT,
}
