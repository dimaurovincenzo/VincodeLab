const assert = require('node:assert/strict')
const test = require('node:test')

const { createRedisService } = require('../electron/domains/redis/redis-service.cjs')
const { valueByteLength } = require('../electron/domains/redis/redis-result-budget.cjs')

const operationId = '11111111-1111-4111-8111-111111111111'

function performanceClient({ keyCount = 100, yieldCommands = false } = {}) {
  const keys = Array.from({ length: keyCount }, (_, index) => `key:${index}`)
  const calls = new Map()
  let active = 0
  let peak = 0

  async function command(name, value) {
    calls.set(name, (calls.get(name) ?? 0) + 1)
    active += 1
    peak = Math.max(peak, active)
    if (yieldCommands) await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    return value
  }

  return {
    calls,
    client: {
      isOpen: false,
      on() {},
      off() {},
      async connect() { this.isOpen = true },
      async quit() { this.isOpen = false },
      dbSize: () => command('dbSize', keyCount),
      scan: () => command('scan', { cursor: '0', keys }),
      type: () => command('type', 'string'),
      pTTL: () => command('pTTL', -1),
      memoryUsage: () => command('memoryUsage', 16),
      strLen: () => command('strLen', 12),
      getRange: () => command('getRange', Buffer.from('payload miss')),
    },
    get peak() { return peak },
  }
}

function serviceFor(client, options = {}) {
  return createRedisService({
    createClient: () => client,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
    ...options,
  })
}

test('SCAN raccoglie i metadati in parallelo con concorrenza bounded', async () => {
  const fixture = performanceClient({ keyCount: 200, yieldCommands: true })
  const api = serviceFor(fixture.client)

  const result = await api.scanKeys('/workspace', 'connection', { count: 200 })

  assert.equal(result.items.length, 200)
  assert.equal(fixture.calls.get('scan'), 1)
  assert.equal(fixture.calls.get('dbSize'), undefined)
  assert.equal(fixture.calls.get('type'), 200)
  assert.equal(fixture.calls.get('pTTL'), 200)
  assert.equal(fixture.calls.get('memoryUsage'), undefined)
  // Il default elabora al massimo 32 chiavi, ciascuna con TYPE/PTTL concorrenti.
  assert.equal(fixture.peak, 64)
  assert.throws(() => serviceFor(fixture.client, { metadataConcurrency: 33 }), /Concorrenza metadati Redis non valida/u)
  await api.closeWorkspaceSessions('/workspace')
})

test('SCAN TYPE riusa il tipo server-side e non richiede memoria non mostrata dal browser', async () => {
  const fixture = performanceClient({ keyCount: 32, yieldCommands: true })
  const api = serviceFor(fixture.client)

  const result = await api.scanKeys('/workspace', 'connection', { count: 32, type: 'string' })

  assert.equal(result.items.length, 32)
  assert.equal(fixture.calls.get('type'), undefined)
  assert.equal(fixture.calls.get('memoryUsage'), undefined)
  assert.equal(fixture.calls.get('pTTL'), 32)
  assert.equal(fixture.peak, 32)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca payload evita l enrichment SCAN e usa un batch bounded', async () => {
  const fixture = performanceClient({ keyCount: 100, yieldCommands: true })
  const api = serviceFor(fixture.client)

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 100,
    maxScanned: 100,
  })

  assert.equal(result.scanned, 100)
  assert.equal(result.matches.length, 0)
  assert.equal(fixture.calls.get('scan'), 1)
  assert.equal(fixture.calls.get('dbSize'), 1)
  assert.equal(fixture.calls.get('type'), 100)
  assert.equal(fixture.calls.get('pTTL'), undefined)
  assert.equal(fixture.calls.get('memoryUsage'), 100)
  assert.equal(fixture.calls.get('strLen'), 100)
  assert.equal(fixture.calls.get('getRange'), 100)
  assert.equal([...fixture.calls.values()].reduce((sum, count) => sum + count, 0), 402)
  // Dodici letture, ciascuna con TYPE/MEMORY USAGE concorrenti.
  assert.equal(fixture.peak, 24)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca usa una preview stringa di 32 KiB senza ridurre quella dell inspector', async () => {
  const fixture = performanceClient({ keyCount: 1 })
  const ranges = []
  fixture.client.strLen = async () => 2_000_000
  fixture.client.getRange = async (_key, start, stop) => {
    ranges.push({ start, stop })
    return Buffer.alloc(stop - start + 1, 97)
  }
  const api = serviceFor(fixture.client)

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 1,
  })

  assert.deepEqual(ranges[0], { start: 0, stop: 32 * 1_024 - 1 })
  assert.equal(result.scanned, 1)
  assert.equal(result.truncated, true)
  const inspection = await api.readKey('/workspace', 'connection', 'key:0')
  assert.deepEqual(ranges[1], { start: 0, stop: 256 * 1_024 - 1 })
  assert.equal(inspection.previewBytes, 256 * 1_024)
  await api.closeWorkspaceSessions('/workspace')
})

test('il budget cumulativo ferma la ricerca dopo il solo batch già in volo', async () => {
  const fixture = performanceClient({ keyCount: 100, yieldCommands: true })
  const api = serviceFor(fixture.client, { searchConcurrency: 3, searchReadByteLimit: 1 })

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 100,
    maxScanned: 100,
  })

  assert.equal(result.scanned, 3)
  assert.equal(result.truncated, true)
  assert.equal(fixture.calls.get('type'), 3)
  assert.equal(fixture.calls.get('getRange'), 3)
  assert.throws(() => serviceFor(fixture.client, { searchReadByteLimit: 0 }), /Budget ricerca Redis non valido/u)
  await api.closeWorkspaceSessions('/workspace')
})

test('il budget conta anche payload letti e poi scartati dal limite IPC', async () => {
  const fixture = performanceClient({ keyCount: 20 })
  let hashReads = 0
  fixture.client.type = async () => 'hash'
  fixture.client.memoryUsage = async () => 60
  fixture.client.hScan = async () => {
    hashReads += 1
    return { cursor: '0', entries: [{ field: 'field', value: 'x'.repeat(100) }] }
  }
  const api = serviceFor(fixture.client, {
    resultItemByteLimit: 64,
    searchConcurrency: 1,
    searchReadByteLimit: 100,
  })

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 20,
  })

  assert.equal(result.scanned, 2)
  assert.equal(result.truncated, true)
  assert.equal(hashReads, 2)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca non scarica collezioni oltre 512 KiB', async () => {
  const fixture = performanceClient({ keyCount: 1 })
  let hashReads = 0
  fixture.client.type = async () => 'hash'
  fixture.client.memoryUsage = async () => 512 * 1_024 + 1
  fixture.client.hScan = async () => { hashReads += 1; return { cursor: '0', entries: [] } }
  const api = serviceFor(fixture.client)

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 1,
  })

  assert.equal(result.scanned, 1)
  assert.equal(result.truncated, true)
  assert.equal(hashReads, 0)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca concorrente non supera mai maxScanned', async () => {
  const fixture = performanceClient({ keyCount: 20, yieldCommands: true })
  const api = serviceFor(fixture.client, { searchConcurrency: 8 })

  const progress = []
  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 20,
    maxScanned: 3,
  }, (snapshot) => progress.push(snapshot))

  assert.equal(result.scanned, 3)
  assert.equal(result.truncated, true)
  assert.equal(fixture.calls.get('type'), 3)
  assert.equal(fixture.calls.get('getRange'), 3)
  assert.equal(progress.at(-1).estimatedTotal, 3)
  await api.closeWorkspaceSessions('/workspace')
})

test('la ricerca conserva l ordine SCAN anche se i payload terminano fuori ordine', async () => {
  const keys = ['slow', 'fast', 'medium']
  const keyText = (value) => Buffer.isBuffer(value) ? value.toString() : String(value)
  const client = {
    isOpen: false,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    async dbSize() { return keys.length },
    async scan() { return { cursor: '0', keys } },
    async type() { return 'string' },
    async memoryUsage() { return 32 },
    async strLen(value) { return Buffer.byteLength(`match:${keyText(value)}`) },
    async getRange(value) {
      const key = keyText(value)
      await new Promise((resolve) => setTimeout(resolve, key === 'slow' ? 8 : key === 'medium' ? 4 : 0))
      return Buffer.from(`match:${key}`)
    },
  }
  const api = serviceFor(client)

  const result = await api.searchKeys('/workspace', 'connection', { operationId, query: 'match', count: 3 })

  assert.deepEqual(result.matches.map((match) => match.key.display), keys)
  await api.closeWorkspaceSessions('/workspace')
})

test('la cancellazione interrompe il batch e mantiene riutilizzabile la sessione', async () => {
  const keys = Array.from({ length: 20 }, (_, index) => `key:${index}`)
  let typeCalls = 0
  const abortable = (value, signal) => new Promise((resolve, reject) => {
    if (!signal) { resolve(value); return }
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }))
      return
    }
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }))
    }, { once: true })
  })
  const client = {
    isOpen: false,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    withCommandOptions({ abortSignal }) {
      return {
        async dbSize() { return keys.length },
        async scan() { return { cursor: '0', keys } },
        type() { typeCalls += 1; return abortable('string', abortSignal) },
        memoryUsage() { return abortable(32, abortSignal) },
        strLen() { return abortable(12, abortSignal) },
        getRange() { return abortable(Buffer.from('payload miss'), abortSignal) },
        async ping() { return 'PONG' },
      }
    },
  }
  const api = serviceFor(client)
  const controller = new AbortController()
  const pending = api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 20,
    signal: controller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))

  controller.abort()

  const result = await pending
  assert.equal(result.cancelled, true)
  assert.equal(result.scanned, 0)
  assert.equal(typeCalls, 12)
  assert.equal(client.isOpen, true)
  assert.equal((await api.testConnection('/workspace', 'connection')).ok, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('DBSIZE sospeso non blocca progress o completamento della ricerca', async () => {
  const client = {
    isOpen: false,
    on() {},
    off() {},
    async connect() { this.isOpen = true },
    async quit() { this.isOpen = false },
    withCommandOptions() {
      return {
        dbSize: () => new Promise(() => undefined),
        async scan() { return { cursor: '0', keys: [] } },
        async ping() { return 'PONG' },
      }
    },
  }
  const api = serviceFor(client)
  const progress = []
  const result = await Promise.race([
    api.searchKeys('/workspace', 'connection', {
      operationId,
      query: 'non-presente',
    }, (snapshot) => progress.push(snapshot)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('DBSIZE ha bloccato la ricerca')), 50)),
  ])

  assert.equal(result.cancelled, false)
  assert.equal(result.scanned, 0)
  assert.equal(progress.length, 1)
  assert.equal(Object.hasOwn(progress[0], 'estimatedTotal'), false)
  assert.equal(client.isOpen, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('la cancellazione durante un batch non attende la stima DBSIZE', async () => {
  const fixture = performanceClient({ keyCount: 20, yieldCommands: true })
  fixture.client.dbSize = () => new Promise(() => undefined)
  const api = serviceFor(fixture.client)
  const controller = new AbortController()
  const pending = api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 20,
    signal: controller.signal,
  })
  await new Promise((resolve) => setImmediate(resolve))

  controller.abort()

  const result = await pending
  assert.equal(result.cancelled, true)
  assert.equal(result.scanned, 0)
  assert.equal(fixture.client.isOpen, true)
  await api.closeWorkspaceSessions('/workspace')
})

test('un errore di rete nella ricerca invalida la sessione prima del retry', async () => {
  let created = 0
  let firstQuitCalls = 0
  const createClient = () => {
    created += 1
    const ordinal = created
    return {
      isOpen: false,
      on() {},
      off() {},
      async connect() { this.isOpen = true },
      async quit() {
        if (ordinal === 1) firstQuitCalls += 1
        this.isOpen = false
      },
      async dbSize() { return 1 },
      async scan() { return { cursor: '0', keys: ['key:0'] } },
      async type() { return 'string' },
      async memoryUsage() { return 32 },
      async strLen() { return 12 },
      async getRange() {
        if (ordinal === 1) throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
        return Buffer.from('payload miss')
      },
      async ping() { return 'PONG' },
    }
  }
  const api = createRedisService({
    createClient,
    getConnectionWithSecrets: () => ({ host: '127.0.0.1', port: 6379, database: 0 }),
  })

  await assert.rejects(() => api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
  }), (error) => error.publicCode === 'REDIS_CONNECTION_LOST')
  assert.equal(firstQuitCalls, 1)

  assert.equal((await api.testConnection('/workspace', 'connection')).ok, true)
  assert.equal(created, 2)
  await api.closeWorkspaceSessions('/workspace')
})

test('DBSIZE negato non impedisce ricerca e progress', async () => {
  const fixture = performanceClient({ keyCount: 4 })
  fixture.client.dbSize = async () => { throw new Error('NOPERM dbsize') }
  const api = serviceFor(fixture.client)
  const progress = []

  const result = await api.searchKeys('/workspace', 'connection', {
    operationId,
    query: 'non-presente',
    count: 4,
  }, (snapshot) => progress.push(snapshot))

  assert.equal(result.scanned, 4)
  assert.ok(progress.length > 0)
  assert.equal(Object.hasOwn(progress.at(-1), 'estimatedTotal'), false)
  await api.closeWorkspaceSessions('/workspace')
})

test('il budget si ferma senza materializzare proprietà oltre il limite', () => {
  let lateReads = 0
  const value = {}
  Object.defineProperty(value, 'first', { enumerable: true, value: 'x'.repeat(64) })
  Object.defineProperty(value, 'late', {
    enumerable: true,
    get() {
      lateReads += 1
      return 'non deve essere letto'
    },
  })

  assert.ok(valueByteLength(value, 8) > 8)
  assert.equal(lateReads, 0)
})
