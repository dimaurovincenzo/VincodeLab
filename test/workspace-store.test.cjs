const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { closeDatabase, getAppearance, getDatabase, getDataDirectory, isDirectory, listRecentWorkspaces, recordWorkspace, setAppearance } = require('../electron/infrastructure/persistence/workspace.repository.cjs')

test('espone la directory dati privata condivisa dai servizi main', (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-store-root-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  assert.equal(getDataDirectory(), dataDirectory)
  if (process.platform !== 'win32') assert.equal(fs.statSync(dataDirectory).mode & 0o777, 0o700)
})

test('persists system light e dark e rejects invalid appearance values', (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-store-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  assert.equal(getAppearance(), 'system')
  for (const appearance of ['light', 'dark', 'system']) {
    assert.equal(setAppearance(appearance), appearance)
    closeDatabase()
    assert.equal(getAppearance(), appearance)
  }

  assert.throws(() => setAppearance('night'), /Aspetto non valido/)
  closeDatabase()
  assert.equal(getAppearance(), 'system')
})

test('protegge database e sidecar SQLite da accessi di gruppo o altri utenti', (t) => {
  if (process.platform === 'win32') return
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-store-mode-'))
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  getDatabase().exec("CREATE TABLE permission_probe(value TEXT); INSERT INTO permission_probe VALUES ('ok')")
  const artifacts = fs.readdirSync(dataDirectory).filter((name) => name.startsWith('vincodelab.sqlite'))

  assert.ok(artifacts.includes('vincodelab.sqlite'))
  for (const artifact of artifacts) {
    assert.equal(fs.statSync(path.join(dataDirectory, artifact)).mode & 0o077, 0, `${artifact} non deve essere accessibile a gruppo o altri utenti`)
  }
})

test('elimina recenti realmente mancanti ma conserva quelli temporaneamente inaccessibili', (t) => {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-store-recent-'))
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-workspace-recent-'))
  const unavailablePath = path.join(workspaceRoot, 'permission-denied')
  const missingPath = path.join(workspaceRoot, 'missing')
  fs.mkdirSync(unavailablePath)
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  const originalStatSync = fs.statSync
  closeDatabase()
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  t.after(() => {
    fs.statSync = originalStatSync
    closeDatabase()
    if (previousDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
    else process.env.VINCODELAB_DATA_DIR = previousDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  recordWorkspace(missingPath)
  recordWorkspace(unavailablePath)
  fs.statSync = (candidate, ...args) => {
    if (candidate === unavailablePath) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    return originalStatSync(candidate, ...args)
  }

  assert.throws(() => isDirectory(unavailablePath), (error) => error?.code === 'EACCES')
  assert.throws(() => listRecentWorkspaces(), (error) => error?.code === 'EACCES')
  assert.deepEqual(
    getDatabase().prepare('SELECT path FROM recent_workspaces ORDER BY path').all().map((row) => row.path),
    [missingPath, unavailablePath].sort(),
  )

  fs.statSync = originalStatSync
  assert.deepEqual(listRecentWorkspaces().map((row) => row.path), [unavailablePath])
  assert.deepEqual(getDatabase().prepare('SELECT path FROM recent_workspaces').all(), [{ path: unavailablePath }])
})
