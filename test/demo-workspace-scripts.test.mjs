import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  DEMO_TEMPLATE_ROOT,
  DEMO_TEMPLATE_FILES,
  DEMO_MARKER_FILENAME,
  createDemoWorkspace,
  parseArguments as parseDemoArguments,
} from '../scripts/create-demo-workspace.mjs'
import {
  SCREENSHOT_MANIFEST,
  assertCleanRendererText,
  cleanCaptureSurfaceExpression,
  electronArguments,
  parseArguments as parseCaptureArguments,
  pngDimensions,
  shellGeometryExpression,
  screenshotPreparationExpression,
} from '../scripts/capture-app-screenshots.mjs'
import { OFFLINE_CHROMIUM_FLAGS } from '../scripts/smoke-packaged-macos.mjs'

test('il template demo supera davvero il comando mostrato nello screenshot', () => {
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  delete environment.NODE_TEST_WORKER_ID
  const output = execFileSync('npm', ['run', 'check'], {
    cwd: DEMO_TEMPLATE_ROOT,
    encoding: 'utf8',
    env: environment,
  })

  assert.match(output, /pass 1/)
})

test('la copia demo usa una allowlist e non include artefatti o configurazioni locali', () => {
  assert.deepEqual(DEMO_TEMPLATE_FILES, [
    '.gitignore',
    'AGENTS.md',
    'README.md',
    'data/schema.sql',
    'docs/product-notes.md',
    'package-lock.json',
    'package.json',
    'src/dashboard.ts',
    'src/theme.ts',
    'tests/dashboard.test.ts',
    'tsconfig.json',
  ])
  assert.equal(DEMO_TEMPLATE_FILES.some((file) => file.includes('node_modules') || file.startsWith('.env')), false)
})

test('crea una workspace demo locale, deterministica e pronta per Git e SQLite', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-demo-script-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const outputPath = path.join(root, 'workspace')
  const result = await createDemoWorkspace({ outputPath })

  assert.equal(result.workspacePath, fs.realpathSync(outputPath))
  assert.equal(result.git, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputPath, DEMO_MARKER_FILENAME), 'utf8')), {
    kind: 'vincodelab-demo-workspace',
    version: 1,
  })
  assert.match(fs.readFileSync(path.join(outputPath, 'src', 'dashboard.ts'), 'utf8'), /dashboardFilters/)
  assert.equal(fs.existsSync(path.join(outputPath, 'notes', 'release-checklist.md')), true)
  assert.equal(fs.existsSync(path.join(outputPath, 'node_modules')), false)
  assert.equal(fs.existsSync(path.join(outputPath, '.env')), false)

  const database = new Database(result.databasePath, { readonly: true })
  try {
    assert.deepEqual(database.prepare('SELECT name, status FROM services ORDER BY id').all(), [
      { name: 'API Gateway', status: 'Operational' },
      { name: 'Background Jobs', status: 'Operational' },
      { name: 'Search Index', status: 'Monitoring' },
    ])
  } finally {
    database.close()
  }

  const status = execFileSync('git', ['status', '--short'], { cwd: outputPath, encoding: 'utf8' })
  assert.match(status, /^ M src\/dashboard\.ts$/mu)
  assert.match(status, /^\?\? notes\/$/mu)
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: outputPath, encoding: 'utf8' }).trim(), 'main')
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: outputPath, encoding: 'utf8' }).trim(), 'feat: create Orbit Metrics dashboard')

  await assert.rejects(createDemoWorkspace({ outputPath }), /destinazione esiste gia/i)
  const regenerated = await createDemoWorkspace({ force: true, outputPath })
  assert.equal(regenerated.workspacePath, result.workspacePath)
})

test('la rigenerazione rifiuta cartelle non marcate e destinazioni protette', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-demo-safety-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const unrelated = path.join(root, 'unrelated')
  fs.mkdirSync(unrelated)
  fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'non eliminare')

  await assert.rejects(createDemoWorkspace({ force: true, outputPath: unrelated }), /marker VincodeLab/i)
  assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'non eliminare')
  await assert.rejects(createDemoWorkspace({ outputPath: path.parse(root).root }), /non sicura/i)
})

test('espone opzioni bounded e un manifesto stabile per gli screenshot reali', () => {
  assert.deepEqual(parseDemoArguments(['--output', './demo-out', '--force', '--no-git', '--json']), {
    force: true,
    help: false,
    initializeGit: false,
    json: true,
    outputPath: path.resolve('./demo-out'),
  })
  const capture = parseCaptureArguments([
    '--app', './release/Test.app',
    '--output', './screens',
    '--workspace', './workspace',
    '--timeout', '12000',
    '--keep-workspace',
    '--json',
  ])
  assert.equal(capture.appPath, path.resolve('./release/Test.app'))
  assert.equal(capture.outputPath, path.resolve('./screens'))
  assert.equal(capture.workspacePath, path.resolve('./workspace'))
  assert.equal(capture.timeoutMs, 12_000)
  assert.equal(capture.keepWorkspace, true)
  assert.equal(capture.json, true)
  assert.throws(() => parseCaptureArguments(['--timeout', '1000']), /Timeout non valido/)

  assert.deepEqual(SCREENSHOT_MANIFEST.map(({ id, fileName }) => [id, fileName]), [
    ['ai', 'ai-workbench.png'],
    ['editor', 'editor-workspace.png'],
    ['terminal', 'terminal-workspace.png'],
    ['git', 'git-workspace.png'],
    ['database', 'database-workspace.png'],
    ['settings', 'settings.png'],
  ])
  assert.equal(new Set(SCREENSHOT_MANIFEST.map((entry) => entry.fileName)).size, SCREENSHOT_MANIFEST.length)
  for (const { id } of SCREENSHOT_MANIFEST) {
    const expression = screenshotPreparationExpression(id)
    assert.doesNotThrow(() => new Function(`return ${expression}`))
  }
  const terminalPreparation = screenshotPreparationExpression('terminal')
  assert.ok(terminalPreparation.indexOf("includes('vincodelab-demo')") < terminalPreparation.indexOf("'npm run check\\r'"))
  const databasePreparation = screenshotPreparationExpression('database')
  assert.ok(databasePreparation.indexOf("=== 'Connetti'") < databasePreparation.indexOf("=== 'Disconnetti'"))
  const databaseAfterConnect = databasePreparation.slice(databasePreparation.indexOf('connect.click()'))
  assert.match(databaseAfterConnect, /aria-busy/u)
  assert.match(databaseAfterConnect, /=== 'Esegui'/u)
  assert.match(databaseAfterConnect, /connessione SQLite pronta/u)
  const captureSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'capture-app-screenshots.mjs'), 'utf8')
  const fixtureSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'lib', 'app-screenshots', 'runtime-fixture.mjs'), 'utf8')
  assert.match(fixtureSource, /1 test passed/)
  assert.match(captureSource, /lib\/app-screenshots\/runtime-fixture\.mjs/u)
  assert.doesNotMatch(captureSource, /better-sqlite3|node:os/u)
  assert.doesNotThrow(() => new Function(`return ${shellGeometryExpression()}`))
  assert.doesNotThrow(() => new Function(`return ${cleanCaptureSurfaceExpression()}`))
})

test('rifiuta dati privati e conserva soltanto identificatori demo neutri', () => {
  assert.doesNotThrow(() => assertCleanRendererText('vincodelab-demo · Orbit-Metrics · /tmp/VincodeLab-Demo'))
  assert.throws(() => assertCleanRendererText('/Users/example/private-project'), /dati non ammessi/i)
  assert.throws(() => assertCleanRendererText(`computer: ${os.hostname()}`), /identificatore/i)
})

test('avvia la cattura con inspector loopback e blocco rete', () => {
  const args = electronArguments({ port: 9_222, profile: '/tmp/profile', workspacePath: '/tmp/VincodeLab-Demo' })
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'))
  assert.ok(args.includes('--remote-debugging-port=9222'))
  assert.ok(args.includes('--reliability-benchmark'))
  assert.ok(args.includes('--screenshot-capture'))
  for (const flag of OFFLINE_CHROMIUM_FLAGS) assert.ok(args.includes(flag), flag)
  assert.deepEqual(args.slice(-2), ['--workspace', '/tmp/VincodeLab-Demo'])
})

test('verifica intestazione e dimensioni PNG prima di pubblicare una schermata', () => {
  const png = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
  png.writeUInt32BE(1440, 16)
  png.writeUInt32BE(900, 20)
  assert.deepEqual(pngDimensions(png), { width: 1440, height: 900 })
  assert.throws(() => pngDimensions(Buffer.from('not a png')), /PNG non valido/)
})
