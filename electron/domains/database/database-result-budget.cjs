const RESULT_BYTE_LIMIT = 4 * 1024 * 1024
const RESULT_CELL_BYTE_LIMIT = 1024 * 1024

function valueByteLength(value, remaining, seen = new WeakSet()) {
  if (value === null || value === undefined) return 1
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (typeof value === 'number' || typeof value === 'bigint') return 8
  if (typeof value === 'boolean') return 1
  if (Buffer.isBuffer(value)) return value.length
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (value instanceof Date) return 24
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

function measureResultRows(rows, { byteLimit = RESULT_BYTE_LIMIT, cellByteLimit = RESULT_CELL_BYTE_LIMIT } = {}) {
  const budget = createResultBudget({ byteLimit, cellByteLimit, retainRows: false })
  for (const row of rows) budget.add(row)
  return budget.bytes
}

function createResultBudget({ byteLimit = RESULT_BYTE_LIMIT, cellByteLimit = RESULT_CELL_BYTE_LIMIT, retainRows = true } = {}) {
  if (!Number.isInteger(byteLimit) || byteLimit < 1 || !Number.isInteger(cellByteLimit) || cellByteLimit < 1) throw new TypeError('database_result_budget_invalid')
  let bytes = 0
  const rows = []
  return {
    add(row) {
      let rowBytes = 0
      for (const [column, value] of Object.entries(row ?? {})) {
        const cellBytes = valueByteLength(value, cellByteLimit)
        if (cellBytes > cellByteLimit) throw new Error('database_result_cell_too_large')
        rowBytes += Buffer.byteLength(column) + cellBytes
        if (bytes + rowBytes > byteLimit) throw new Error('database_result_too_large')
      }
      bytes += rowBytes
      if (retainRows) rows.push(row)
      return row
    },
    get bytes() { return bytes },
    get rows() { return rows },
  }
}

module.exports = { createResultBudget, measureResultRows, RESULT_BYTE_LIMIT, RESULT_CELL_BYTE_LIMIT, valueByteLength }
