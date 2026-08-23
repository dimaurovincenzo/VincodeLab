const REDIS_RESULT_BYTE_LIMIT = 2 * 1024 * 1024
const REDIS_RESULT_ITEM_BYTE_LIMIT = 512 * 1024
const REDIS_RESULT_ITEM_LIMIT = 500

function valueByteLength(value, remaining, seen = new WeakSet()) {
  if (value === null || value === undefined) return 1
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (typeof value === 'number' || typeof value === 'bigint') return 8
  if (typeof value === 'boolean') return 1
  if (Buffer.isBuffer(value)) return value.length
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (typeof value !== 'object') return Buffer.byteLength(String(value))
  if (seen.has(value)) return Math.max(remaining, 0) + 1
  seen.add(value)
  let bytes = 0
  for (const [key, nested] of Object.entries(value)) {
    bytes += Buffer.byteLength(key) + valueByteLength(nested, remaining - bytes, seen)
    if (bytes > remaining) break
  }
  seen.delete(value)
  return bytes
}

function createRedisResultBudget({
  byteLimit = REDIS_RESULT_BYTE_LIMIT,
  itemByteLimit = REDIS_RESULT_ITEM_BYTE_LIMIT,
  itemLimit = REDIS_RESULT_ITEM_LIMIT,
  retainItems = true,
} = {}) {
  if (!Number.isInteger(byteLimit) || byteLimit < 1
    || !Number.isInteger(itemByteLimit) || itemByteLimit < 1
    || !Number.isInteger(itemLimit) || itemLimit < 1) {
    throw new TypeError('redis_result_budget_invalid')
  }
  let bytes = 0
  let count = 0
  const items = []
  return {
    add(item) {
      if (count >= itemLimit) throw Object.assign(new Error('redis_result_too_many_items'), { code: 'REDIS_RESULT_TOO_LARGE' })
      const itemBytes = valueByteLength(item, itemByteLimit)
      if (itemBytes > itemByteLimit) throw Object.assign(new Error('redis_result_item_too_large'), { code: 'REDIS_RESULT_TOO_LARGE' })
      if (bytes + itemBytes > byteLimit) throw Object.assign(new Error('redis_result_too_large'), { code: 'REDIS_RESULT_TOO_LARGE' })
      bytes += itemBytes
      count += 1
      if (retainItems) items.push(item)
      return item
    },
    get bytes() { return bytes },
    get count() { return count },
    get items() { return items },
  }
}

function measureRedisResult(items, options) {
  const budget = createRedisResultBudget({ ...options, retainItems: false })
  for (const item of items) budget.add(item)
  return budget.bytes
}

module.exports = {
  createRedisResultBudget,
  measureRedisResult,
  REDIS_RESULT_BYTE_LIMIT,
  REDIS_RESULT_ITEM_BYTE_LIMIT,
  REDIS_RESULT_ITEM_LIMIT,
  valueByteLength,
}
