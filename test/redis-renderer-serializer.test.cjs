const assert = require('node:assert/strict')
const test = require('node:test')

const {
  redisInspectionForRenderer,
  redisKeyForRenderer,
  redisSearchForRenderer,
  redisSummaryForRenderer,
} = require('../electron/domains/redis/redis-renderer-serializer.cjs')

test('serializza chiavi testuali e binarie senza esporre il DTO interno', () => {
  assert.deepEqual(redisKeyForRenderer({ encoded: 'dXNlcjox', display: 'user:1' }), {
    binary: false,
    key: 'user:1',
    keyRef: 'dXNlcjox',
  })
  assert.deepEqual(redisKeyForRenderer({ encoded: 'A'.repeat(60), binary: true }), {
    binary: true,
    key: `base64:${'A'.repeat(48)}…`,
    keyRef: 'A'.repeat(60),
  })
})

test('usa un fallback esplicito per chiavi testuali vuote', () => {
  assert.deepEqual(redisKeyForRenderer({ encoded: '', display: '' }), {
    binary: false,
    key: '(chiave vuota)',
    keyRef: '',
  })
})

test('rifiuta riferimenti non strutturati prima della serializzazione', () => {
  for (const value of [null, 'key', [], {}, { encoded: 7 }]) {
    assert.throws(() => redisKeyForRenderer(value), /Riferimento chiave Redis non valido/)
  }
})

test('summary e inspection mantengono metadati pubblici ma scartano i byte interni', () => {
  assert.deepEqual(redisSummaryForRenderer({
    key: { encoded: 'dXNlcjox', display: 'user:1' },
    ttl: 120,
    type: 'hash',
  }), {
    binary: false,
    key: 'user:1',
    keyRef: 'dXNlcjox',
    ttl: 120,
    type: 'hash',
  })
  assert.deepEqual(redisInspectionForRenderer({
    key: { encoded: 'dXNlcjox', display: 'user:1' },
    resultBytes: 4_096,
    type: 'hash',
    value: { name: 'Ada' },
  }), {
    binary: false,
    key: 'user:1',
    keyRef: 'dXNlcjox',
    type: 'hash',
    value: { name: 'Ada' },
  })
})

test('search serializza solo match array e preserva il progresso', () => {
  assert.deepEqual(redisSearchForRenderer({
    complete: false,
    matches: [{ key: { encoded: 'azE=', display: 'k1' }, type: 'string' }],
    scanned: 42,
  }), {
    complete: false,
    matches: [{ binary: false, key: 'k1', keyRef: 'azE=', type: 'string' }],
    scanned: 42,
  })
  assert.deepEqual(redisSearchForRenderer({ matches: null, scanned: 0 }), { matches: [], scanned: 0 })
})
