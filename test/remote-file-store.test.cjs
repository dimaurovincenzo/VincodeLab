const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')

const { createRemoteFileStore, toPublicTrackedFile } = require('../electron/remote-file-store.cjs')

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function createFixture(t, overrides = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-store-'))
  const database = new Database(':memory:')
  const logs = []
  const store = createRemoteFileStore({ dataRoot, database, log: (...entry) => logs.push(entry), ...overrides })
  t.after(() => {
    database.close()
    fs.rmSync(dataRoot, { recursive: true, force: true })
  })
  return { dataRoot, logs, store }
}

test('isola cache e manifesti per workspace con permessi privati', async (t) => {
  const { dataRoot, store } = createFixture(t)
  const localTempPath = path.join(dataRoot, 'download.tmp')
  fs.writeFileSync(localTempPath, 'TOKEN=example\n', { mode: 0o644 })
  const item = await store.trackDownload('/tmp/a', {
    connectionId: 'connection-a',
    remotePath: '/srv/app/.env',
    localTempPath,
    size: 14,
    modifiedAt: 1_777_000_000_000,
    mode: 0o640,
    baselineHash: hash('TOKEN=example\n'),
  })

  assert.equal(store.getTrackedFile('/tmp/a', item.id).localState, 'synced')
  assert.equal(store.getTrackedFile('/tmp/b', item.id), null)
  assert.equal(fs.statSync(path.dirname(item.localPath)).mode & 0o777, 0o700)
  assert.equal(fs.statSync(item.localPath).mode & 0o777, 0o600)
  assert.equal(fs.existsSync(localTempPath), false)
})

test('protegge le copie modificate e aggiorna gli hash locali', async (t) => {
  const { dataRoot, store } = createFixture(t)
  const localTempPath = path.join(dataRoot, 'download.tmp')
  fs.writeFileSync(localTempPath, 'prima')
  const item = await store.trackDownload('/tmp/a', {
    connectionId: 'connection-a', remotePath: '/srv/app/config.json', localTempPath,
    size: 5, modifiedAt: 10, mode: 0o640, baselineHash: hash('prima'),
  })
  fs.writeFileSync(item.localPath, 'locale')

  const modified = await store.markLocalSaved('/tmp/a', item.id)
  assert.equal(modified.localState, 'modified')
  assert.equal(modified.localHash, hash('locale'))
  await assert.rejects(() => store.removeTrackedFile('/tmp/a', item.id, { force: false }), /modifiche locali/)
  assert.deepEqual(await store.removeTrackedFile('/tmp/a', item.id, { force: true }), { removed: true })
  assert.equal(fs.existsSync(item.localPath), false)
})

test('non espone il percorso della cache nei DTO pubblici', async (t) => {
  const { dataRoot, store } = createFixture(t)
  const localTempPath = path.join(dataRoot, 'download.tmp')
  fs.writeFileSync(localTempPath, 'testo')
  const item = await store.trackDownload('/tmp/a', {
    connectionId: 'connection-a', remotePath: '/srv/app/readme.txt', localTempPath,
    size: 5, modifiedAt: 10, mode: 0o600, baselineHash: hash('testo'),
  })

  const dto = await toPublicTrackedFile(item)
  assert.equal('localPath' in dto, false)
  assert.equal(dto.remotePath, '/srv/app/readme.txt')
  assert.equal(dto.cacheSize, 5)
})

test('un cleanup temporaneo fallito non annulla il download e viene registrato senza segreti', async (t) => {
  let rejectedPath = null
  const removeFile = async (filePath, options) => {
    if (filePath === rejectedPath) throw new Error('secret=non-mostrare cleanup negato')
    return fs.promises.rm(filePath, options)
  }
  const { dataRoot, logs, store } = createFixture(t, { removeFile })
  const localTempPath = path.join(dataRoot, 'cleanup-source.tmp')
  rejectedPath = localTempPath
  fs.writeFileSync(localTempPath, 'contenuto')

  const item = await store.trackDownload('/tmp/a', {
    connectionId: 'connection-a', remotePath: '/srv/app/cleanup.txt', localTempPath,
    size: 9, modifiedAt: 10, mode: 0o600, baselineHash: hash('contenuto'),
  })

  assert.equal(store.getTrackedFile('/tmp/a', item.id).localState, 'synced')
  assert.equal(fs.existsSync(item.localPath), true)
  assert.equal(fs.existsSync(localTempPath), true)
  const cleanup = logs.find(([, event]) => event === 'remote_file_store_cleanup_failed')
  assert.ok(cleanup)
  assert.equal(cleanup[0], 'warning')
  assert.equal(cleanup[2].category, 'filesystem')
  assert.equal(cleanup[2].code, 'REMOTE_CACHE_CLEANUP_FAILED')
  assert.match(cleanup[2].correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.equal(JSON.stringify(cleanup).includes('non-mostrare'), false)
})

test('cleanup elimina temporanei e copie sincronizzate scadute ma conserva le modificate', async (t) => {
  const { dataRoot, store } = createFixture(t)
  const temporary = path.join(dataRoot, 'remote-files', 'abandoned.tmp')
  fs.mkdirSync(path.dirname(temporary), { recursive: true })
  fs.writeFileSync(temporary, 'parziale')
  const firstTemp = path.join(dataRoot, 'first.tmp')
  const secondTemp = path.join(dataRoot, 'second.tmp')
  fs.writeFileSync(firstTemp, 'sincronizzato')
  fs.writeFileSync(secondTemp, 'modificato')
  const synced = await store.trackDownload('/tmp/a', { connectionId: 'connection-a', remotePath: '/srv/a.txt', localTempPath: firstTemp, size: 13, modifiedAt: 1, mode: 0o600, baselineHash: hash('sincronizzato') })
  const modified = await store.trackDownload('/tmp/a', { connectionId: 'connection-a', remotePath: '/srv/b.txt', localTempPath: secondTemp, size: 10, modifiedAt: 1, mode: 0o600, baselineHash: hash('modificato') })
  fs.writeFileSync(modified.localPath, 'locale')
  await store.markLocalSaved('/tmp/a', modified.id)

  const result = await store.cleanup('/tmp/a', { olderThan: Date.now() + 1 })
  assert.equal(result.removed >= 1, true)
  assert.equal(store.getTrackedFile('/tmp/a', synced.id), null)
  assert.equal(store.getTrackedFile('/tmp/a', modified.id).localState, 'modified')
  assert.equal(fs.existsSync(temporary), false)
})

test('l hash asincrono di una copia grande lascia avanzare il ciclo eventi', async (t) => {
  const { dataRoot, store } = createFixture(t)
  const localTempPath = path.join(dataRoot, 'large-download.tmp')
  const largeContent = Buffer.alloc(32 * 1024 * 1024, 0x61)
  await fs.promises.writeFile(localTempPath, largeContent)
  const item = await store.trackDownload('/tmp/a', {
    connectionId: 'connection-a', remotePath: '/srv/large.log', localTempPath,
    size: largeContent.length, modifiedAt: 10, mode: 0o600, baselineHash: hash(largeContent),
  })
  await fs.promises.writeFile(item.localPath, Buffer.alloc(largeContent.length, 0x62))

  let heartbeatBeforeCompletion = 0
  let completed = false
  const heartbeat = setInterval(() => {
    if (!completed) heartbeatBeforeCompletion += 1
  }, 0)
  try {
    const modified = await store.markLocalSaved('/tmp/a', item.id)
    assert.equal(modified.localState, 'modified')
  } finally {
    completed = true
    clearInterval(heartbeat)
  }

  assert.ok(heartbeatBeforeCompletion > 0, 'l hashing non deve monopolizzare il ciclo eventi')
})
