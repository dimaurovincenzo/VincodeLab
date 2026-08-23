const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const projectRoot = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(projectRoot, file), 'utf8')

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.(?:css|ts|tsx)$/.test(entry.name) ? [target] : []
  })
}

test('la shell usa solo classi Panda e conserva il marker tecnico Electron', () => {
  const app = read('src/App.tsx')

  assert.doesNotMatch(app, /\bapp-shell\b|\bapp-section-tabs(?:-root)?\b|\bapp-section-page\b/)
  assert.match(app, /className=\{`window-toolbar \$\{shellStyles\.toolbar\}`\}/)
  assert.match(app, /aria-label="Modalità di visualizzazione" orientation="horizontal"/)
})

test('i SegmentGroup visivamente orizzontali dichiarano la stessa semantica ad Ark', () => {
  const roots = ['src/App.tsx', 'src/components/settings.tsx', 'src/components/free-terminal.tsx']
    .flatMap((file) => read(file).split('\n').filter((line) => line.includes('<SegmentGroup.Root')))

  assert.equal(roots.length, 4)
  for (const root of roots) assert.match(root, /orientation="horizontal"/)
})

test('Spinner centralizza il caricamento Panda e si ferma con reduced motion', () => {
  const globalCss = read('src/theme/global-css.ts')
  const recipes = read('src/theme/recipes.ts')
  const spinner = read('src/components/ui/spinner.tsx')
  const uiIndex = read('src/components/ui/index.ts')
  const panda = read('panda.config.ts')
  const applicationSources = sourceFiles(path.join(projectRoot, 'src'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')

  assert.doesNotMatch(applicationSources, /animate-spin/)
  assert.doesNotMatch(globalCss, /'\.animate-spin'/)
  assert.match(recipes, /spinnerRecipe[\s\S]*?animation:\s*'uiSpin'[\s\S]*?_motionReduce:\s*\{\s*animation:\s*'none'\s*\}/)
  assert.match(spinner, /className=\{cx\(spinner\(\), className\)\}/)
  assert.match(spinner, /data-scope="spinner"/)
  assert.match(uiIndex, /export \{ Spinner \} from '\.\/spinner'/)
  assert.match(panda, /recipes:\s*\{\s*button:\s*buttonRecipe,\s*spinner:\s*spinnerRecipe\s*\}/)
  for (const declaration of [
    "animationDuration: '0.01ms !important'",
    "animationIterationCount: '1 !important'",
    "scrollBehavior: 'auto !important'",
    "transitionDuration: '0.01ms !important'",
  ]) assert.match(globalCss, new RegExp(declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('gli alias CSS globali restano un contratto centrale per bridge tecnici e motion', () => {
  const tokenFile = path.join(projectRoot, 'src/theme/tokens.ts')
  const tokens = fs.readFileSync(tokenFile, 'utf8')
  const variableSection = tokens.slice(tokens.indexOf('export const graphiteCssVariables'))
  const aliases = [...variableSection.matchAll(/^\s*'(--[^']+)'\s*:/gm)].map((match) => match[1])
  const consumers = sourceFiles(path.join(projectRoot, 'src'))
    .filter((file) => file !== tokenFile)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n')

  assert.ok(aliases.length > 0)
  const publicMotionAliases = new Set(['--motion-fast', '--motion-standard', '--ease-standard'])
  for (const alias of aliases) {
    assert.ok(consumers.includes(alias) || publicMotionAliases.has(alias), `${alias} deve avere almeno un bridge tecnico attivo o appartenere al contratto motion`)
  }
  for (const required of ['--code-surface', '--code-text', '--code-selection', '--surface-raised', '--text-primary']) {
    assert.ok(aliases.includes(required), `${required} deve restare disponibile alle integrazioni imperative`)
  }
  for (const required of publicMotionAliases) assert.ok(aliases.includes(required), `${required} deve restare nel contratto motion condiviso`)
  assert.match(consumers, /--motion-fast/)
  assert.match(consumers, /--ease-standard/)
})
