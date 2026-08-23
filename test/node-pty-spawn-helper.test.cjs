const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { DARWIN_HELPER_RELATIVE_PATHS, default: afterPack, ensureNodePtySpawnHelpers } = require('../scripts/ensure-node-pty-spawn-helper.cjs')

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-node-pty-helper-'))
  t.after(() => fs.rmSync(root, { force: true, recursive: true }))
  return root
}

test('rende eseguibili entrambi i Darwin spawn-helper ed è idempotente', (t) => {
  const root = createFixture(t)
  const helperPaths = DARWIN_HELPER_RELATIVE_PATHS.map((relativePath) => path.join(root, relativePath))
  for (const helperPath of helperPaths) {
    fs.mkdirSync(path.dirname(helperPath), { recursive: true })
    fs.writeFileSync(helperPath, 'fixture')
    fs.chmodSync(helperPath, 0o644)
  }

  const firstRun = ensureNodePtySpawnHelpers(root)
  assert.equal(firstRun.found, 2)
  assert.equal(firstRun.changed, 2)
  assert.deepEqual(firstRun.helpers.map(({ modeBefore, modeAfter, changed }) => ({ modeBefore, modeAfter, changed })), [
    { modeBefore: 0o644, modeAfter: 0o755, changed: true },
    { modeBefore: 0o644, modeAfter: 0o755, changed: true },
  ])
  for (const helperPath of helperPaths) assert.equal(fs.statSync(helperPath).mode & 0o777, 0o755)

  const secondRun = ensureNodePtySpawnHelpers(root)
  assert.equal(secondRun.found, 2)
  assert.equal(secondRun.changed, 0)
  assert.ok(secondRun.helpers.every(({ changed, modeBefore, modeAfter }) => !changed && modeBefore === 0o755 && modeAfter === 0o755))
})

test('ignora senza errore gli helper non installati', (t) => {
  const result = ensureNodePtySpawnHelpers(createFixture(t))
  assert.deepEqual(result, { changed: 0, found: 0, helpers: [] })
})

test('in modalità strict rifiuta un bundle Darwin privo di helper', (t) => {
  const root = createFixture(t)
  assert.throws(
    () => ensureNodePtySpawnHelpers(root, { strict: true }),
    /Nessun node-pty spawn-helper trovato/,
  )
})

test('afterPack corregge l’helper nel bundle prima della firma', (t) => {
  const root = createFixture(t)
  const appOutDir = path.join(root, 'mac-arm64')
  const unpackedRoot = path.join(appOutDir, 'Fixture.app', 'Contents', 'Resources', 'app.asar.unpacked')
  const helperPath = path.join(unpackedRoot, DARWIN_HELPER_RELATIVE_PATHS[0])
  fs.mkdirSync(path.dirname(helperPath), { recursive: true })
  fs.writeFileSync(helperPath, 'fixture')
  fs.chmodSync(helperPath, 0o644)

  afterPack({
    appOutDir,
    electronPlatformName: 'darwin',
    packager: { appInfo: { productFilename: 'Fixture' } },
  })

  assert.equal(fs.statSync(helperPath).mode & 0o777, 0o755)
  assert.doesNotThrow(() => fs.accessSync(helperPath, fs.constants.X_OK))
})

test('fallisce con un messaggio utile se il percorso helper non è un file', (t) => {
  const root = createFixture(t)
  fs.mkdirSync(path.join(root, DARWIN_HELPER_RELATIVE_PATHS[0]), { recursive: true })

  assert.throws(
    () => ensureNodePtySpawnHelpers(root),
    /node-pty spawn-helper .* non è un file regolare/,
  )
})

test('il manifest applica il controllo dopo i rebuild e al bundle afterPack', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'))
  const command = 'node scripts/ensure-node-pty-spawn-helper.cjs'

  assert.match(manifest.scripts.postinstall, new RegExp(`install-app-deps && ${command}`))
  assert.equal(manifest.scripts.prebuild, command)
  assert.match(manifest.scripts['rebuild:native'], new RegExp(`install-app-deps && ${command}`))
  assert.equal(manifest.build.afterPack, './scripts/ensure-node-pty-spawn-helper.cjs')
})
