const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'),
)

test('il packaging separa gli installer dagli asset renderer', () => {
  assert.equal(manifest.build?.directories?.output, 'release')
  assert.ok(manifest.build.files.includes('dist/index.html'))
  assert.ok(manifest.build.files.includes('dist/assets/**/*'))
  assert.ok(!manifest.build.files.includes('dist/**/*'))
  assert.ok(
    !manifest.build.files.some((entry) => entry.startsWith('release/')),
    'l’output di electron-builder non deve poter rientrare nel pacchetto',
  )
})

test('il pacchetto personale macOS non usa una firma applicativa', () => {
  assert.equal(manifest.build?.mac?.identity, null)
})

test('usa la nuova icona VincodeLab nel bundle macOS e nel renderer', () => {
  assert.equal(manifest.build?.mac?.icon, 'resources/icon.icns')
  assert.ok(!manifest.build.files.includes('dist/favicon.svg'))
  assert.ok(fs.existsSync(path.join(__dirname, '../resources/icon.icns')))
  assert.ok(fs.existsSync(path.join(__dirname, '../public/vincodelab-icon.png')))

  const icns = fs.readFileSync(path.join(__dirname, '../resources/icon.icns'))
  const png = fs.readFileSync(path.join(__dirname, '../public/vincodelab-icon.png'))
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns')
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(png.readUInt32BE(16), 1_024)
  assert.equal(png.readUInt32BE(20), 1_024)

  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
  assert.match(html, /rel="icon" type="image\/png" href="\/vincodelab-icon\.png"/u)
})

test('il bundle installabile include soltanto le dipendenze del main process', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    'better-sqlite3',
    'mysql2',
    'node-pty',
    'pg',
    'tedious',
    'yaml',
  ])
  for (const rendererDependency of ['@ark-ui/react', '@codemirror/view', '@xterm/xterm', 'react', 'react-dom', 'sql-formatter']) {
    assert.ok(manifest.devDependencies[rendererDependency], `${rendererDependency} deve essere bundle-only`)
  }
})

test('forza PostCSS alla versione diretta corretta anche dentro Panda', () => {
  assert.equal(manifest.overrides?.postcss, '$postcss')
})

test('dichiara una toolchain npm riproducibile e compatibile con la build locale', () => {
  assert.match(manifest.packageManager ?? '', /^npm@\d+\.\d+\.\d+$/u)
  assert.equal(manifest.engines?.node, '>=22.12.0 <27')
  assert.equal(manifest.engines?.npm, '>=10.9.0 <12')
})

test('espone metadati completi senza abilitare la pubblicazione accidentale su npm', () => {
  assert.equal(manifest.private, true)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.author, 'Vincenzo Di Mauro')
  assert.equal(manifest.repository?.url, 'git+https://github.com/dimaurovincenzo/VincodeLab.git')
  assert.equal(manifest.bugs?.url, 'https://github.com/dimaurovincenzo/VincodeLab/issues')
  assert.match(manifest.homepage ?? '', /^https:\/\/github\.com\/dimaurovincenzo\/VincodeLab/u)
  assert.ok(manifest.scripts?.['check:repo'])
})
