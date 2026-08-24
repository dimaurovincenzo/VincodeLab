const { createRedisResultBudget } = require('./redis-result-budget.cjs')

const REDIS_COMMAND_TIMEOUT_MS = 10_000

function commandClient(client, signal) {
  if (signal?.aborted) throw abortError()
  return typeof client.withCommandOptions === 'function'
    ? client.withCommandOptions({ timeout: REDIS_COMMAND_TIMEOUT_MS, ...(signal ? { abortSignal: signal } : {}) })
    : client
}

function abortError() {
  return Object.assign(new Error('redis_operation_cancelled'), { name: 'AbortError', code: 'ABORT_ERR' })
}

function connectionErrorWithCause(error, session) {
  if (!session?.lastError) return error
  const wrapped = new Error('redis_connection_failed', { cause: session.lastError })
  if (typeof error?.code === 'string') wrapped.code = error.code
  return wrapped
}

function withAbort(promise, signal, onAbort = () => undefined) {
  if (!signal) return Promise.resolve(promise)
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      callback(value)
    }
    const handleAbort = () => {
      try { onAbort() } catch { /* La cancellazione resta deterministica. */ }
      finish(reject, abortError())
    }
    signal.addEventListener('abort', handleAbort, { once: true })
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

function withTimeout(promise, timeoutMs, onTimeout = () => undefined) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      try { onTimeout() } catch { /* La chiusura forzata resta best effort. */ }
      finish(reject, Object.assign(new Error('redis_connection_timeout'), { code: 'ETIMEDOUT' }))
    }, timeoutMs)
    timer.unref?.()
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

async function invoke(client, names, args, signal) {
  const target = commandClient(client, signal)
  for (const name of names) if (typeof target[name] === 'function') return target[name](...args)
  throw Object.assign(new Error('redis_client_command_unavailable'), { code: 'REDIS_CLIENT_UNAVAILABLE' })
}

function normalizeScanReply(reply, collectionNames) {
  if (Array.isArray(reply)) return { cursor: String(reply[0]), values: Array.isArray(reply[1]) ? reply[1] : [] }
  if (!reply || typeof reply !== 'object') throw new Error('redis_invalid_scan_reply')
  const values = collectionNames.map((name) => reply[name]).find(Array.isArray) ?? []
  return { cursor: String(reply.cursor ?? reply.nextCursor ?? '0'), values }
}

function valueForRenderer(value) {
  if (Buffer.isBuffer(value)) {
    const decoded = value.toString('utf8')
    return Buffer.from(decoded, 'utf8').equals(value) ? decoded : `base64:${value.toString('base64')}`
  }
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

function budgetItems(items, options = {}) {
  const budget = createRedisResultBudget(options)
  for (const item of items) budget.add(item)
  return { bytes: budget.bytes, items: budget.items }
}

module.exports = {
  abortError,
  budgetItems,
  commandClient,
  connectionErrorWithCause,
  invoke,
  mapWithConcurrency,
  normalizeScanReply,
  REDIS_COMMAND_TIMEOUT_MS,
  valueForRenderer,
  withAbort,
  withTimeout,
}
