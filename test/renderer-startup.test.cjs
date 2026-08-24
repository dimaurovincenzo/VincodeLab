const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')
const { readAppSource } = require('./helpers/app-source.cjs')

const projectRoot = path.join(__dirname, '..')

test('Settings Skill e Istruzioni sono chunk differiti e conservano il mount dopo la prima visita', () => {
  const app = readAppSource()

  assert.match(app, /const AppSettings = lazy\(\(\) => import\('@\/features\/settings'\)/)
  assert.match(app, /const ProjectSkills = lazy\(\(\) => loadProjectSkills\(\)/)
  assert.match(app, /const ProjectInstructions = lazy\(\(\) => loadProjectInstructions\(\)/)
  assert.doesNotMatch(app, /import \{ ProjectSkills \} from|import \{ ProjectInstructions \} from|import \{ Settings as AppSettings \} from/)
  for (const [view, active] of [
    ['settings', "appSection === 'settings'"],
    ['skills', "aiTab === 'skills'"],
    ['instructions', "aiTab === 'instructions'"],
  ]) {
    assert.match(app, new RegExp(`shouldMountPersistentView\\(loadedSections, '${view}', ${active.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\)`))
  }
  assert.match(app, /if \(section !== 'ai'\) setLoadedSections\(\(current\) => visitPersistentView\(current, section\)\)/)
  assert.match(app, /if \(tab !== 'terminal'\) setLoadedSections\(\(current\) => visitPersistentView\(current, tab\)\)/)
})

test('la finestra precede i controlli aggiornamento e l’indice workspace non blocca l’apertura', () => {
  const startupRuntime = fs.readFileSync(path.join(projectRoot, 'electron/app/application-startup-runtime.cjs'), 'utf8')
  const workspaceOpener = fs.readFileSync(path.join(projectRoot, 'electron/domains/workspace/workspace-opener.cjs'), 'utf8')
  assert.ok(startupRuntime.indexOf('createWindow()') < startupRuntime.indexOf('reconcileManagedPiPackages('))
  assert.match(workspaceOpener, /void projectFileIndex\.build\(normalizedWorkspacePath\)\.catch/)
})

test('la misura startup include import statici e preload ma esclude i chunk dinamici', async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-renderer-startup-'))
  t.after(() => fs.rmSync(fixture, { force: true, recursive: true }))
  const assets = path.join(fixture, 'assets')
  fs.mkdirSync(assets)
  fs.writeFileSync(path.join(fixture, 'index.html'), '<script type="module" src="./assets/index.js"></script><link rel="modulepreload" href="./assets/runtime.js"><link rel="stylesheet" href="./assets/index.css">')
  fs.writeFileSync(path.join(assets, 'index.js'), 'import { runtime } from "./runtime.js"; export const load = () => import("./deferred.js"); runtime();')
  fs.writeFileSync(path.join(assets, 'runtime.js'), 'import "./shared.js"; export const runtime = () => true;')
  fs.writeFileSync(path.join(assets, 'shared.js'), 'export const shared = true;')
  fs.writeFileSync(path.join(assets, 'deferred.js'), 'throw new Error("non eager");')
  fs.writeFileSync(path.join(assets, 'index.css'), ':root { color-scheme: light dark; }')

  const scriptUrl = pathToFileURL(path.join(projectRoot, 'scripts/measure-renderer-startup.mjs')).href
  const { measureRendererStartup } = await import(scriptUrl)
  const result = await measureRendererStartup(fixture)
  const eagerFiles = result.javascript.files.map((entry) => entry.file)

  assert.deepEqual(eagerFiles, ['assets/index.js', 'assets/runtime.js', 'assets/shared.js'])
  assert.equal(eagerFiles.includes('assets/deferred.js'), false)
  assert.equal(result.css.count, 1)
  assert.equal(result.total.bytes, result.javascript.bytes + result.css.bytes)
})
