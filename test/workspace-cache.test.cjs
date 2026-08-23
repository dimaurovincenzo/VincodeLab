const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getDatabase } = require('../electron/workspace-store.cjs')
const {
  invalidateCache,
  readCache,
  writeCache,
} = require('../electron/workspace-cache.cjs')

function withTemporaryDatabase(t) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-cache-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })
}

test('isola le risorse cache tra workspace e segnala la scadenza TTL', (t) => {
  withTemporaryDatabase(t)

  writeCache('/tmp/workspace-a', 'github:data', { issues: [] }, 60_000, 1_000)
  writeCache('/tmp/workspace-b', 'github:data', { issues: [{ number: 7 }] }, 60_000, 1_000)

  assert.equal(readCache('/tmp/workspace-a', 'github:data', 61_001).cache.stale, true)
  assert.deepEqual(readCache('/tmp/workspace-b', 'github:data', 1_001).data, { issues: [{ number: 7 }] })
})

test('invalida soltanto le chiavi richieste', (t) => {
  withTemporaryDatabase(t)

  writeCache('/tmp/workspace-a', 'git:status', { branch: 'main' }, 10_000, 1_000)
  writeCache('/tmp/workspace-a', 'github:data', { issues: [] }, 60_000, 1_000)
  invalidateCache('/tmp/workspace-a', ['git:status'])

  assert.equal(readCache('/tmp/workspace-a', 'git:status', 1_001), null)
  assert.deepEqual(readCache('/tmp/workspace-a', 'github:data', 1_001).data, { issues: [] })
})

test('elimina una voce con JSON corrotto senza compromettere altre risorse', (t) => {
  withTemporaryDatabase(t)

  writeCache('/tmp/workspace-a', 'github:data', { issues: [] }, 60_000, 1_000)
  getDatabase().prepare(`
    UPDATE workspace_cache SET payload_json = '{non-json}'
    WHERE workspace_path = ? AND resource_key = ?
  `).run('/tmp/workspace-a', 'github:data')

  assert.equal(readCache('/tmp/workspace-a', 'github:data', 1_001), null)
  assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_cache').get().count, 0)
})
