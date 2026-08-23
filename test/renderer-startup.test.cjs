const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const test = require('node:test')

const projectRoot = path.join(__dirname, '..')

test('Settings Skill e Istruzioni sono chunk differiti e conservano il mount dopo la prima visita', () => {
  const app = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8')

  for (const [component, moduleName] of [
    ['AppSettings', 'settings'],
    ['ProjectSkills', 'project-skills'],
    ['ProjectInstructions', 'project-instructions'],
  ]) {
    assert.match(app, new RegExp(`const ${component} = lazy\\(\\(\\) => import\\('@/components/${moduleName}'\\)`))
  }
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
  const main = fs.readFileSync(path.join(projectRoot, 'electron/main.cjs'), 'utf8')
  const readyBlock = main.slice(main.indexOf('app.whenReady().then(() => {'))
  assert.ok(readyBlock.indexOf('createWindow()') < readyBlock.indexOf('reconcileManagedPiPackages('))
  assert.match(main, /void projectFileIndex\.build\(normalizedWorkspacePath\)\.catch/)
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
