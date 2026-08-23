const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('la navigazione principale dichiara la sezione Impostazioni', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(source, /Impostazioni/)
  assert.match(source, /<Settings/)
})

test('le tab Impostazioni etichettano i rispettivi pannelli', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/components/settings.tsx'), 'utf8')

  assert.match(settings, /<Tabs\.Root asChild value=\{tab\}[^>]*onValueChange=/)
  assert.match(settings, /<Tabs\.List[^>]*aria-label="Sezioni Impostazioni"/)
  assert.match(settings, /<Tabs\.Indicator\s*\/>/)
  for (const tab of ['general', 'updates', 'runtime', 'packages', 'skills']) {
    assert.match(settings, new RegExp(`<Tabs\\.Trigger value="${tab}">`))
    assert.match(settings, new RegExp(`<Tabs\\.Content asChild value="${tab}">`))
  }
  assert.doesNotMatch(settings, /role="(?:tablist|tab)"|aria-labelledby="settings-tab-/)
})

test('la toolbar globale non duplica l apertura workspace e l aspetto vive nelle impostazioni', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const settings = fs.readFileSync(path.join(__dirname, '../src/components/settings.tsx'), 'utf8')
  const toolbar = app.match(/<header className=\{`window-toolbar \$\{shellStyles\.toolbar\}`\}>([\s\S]*?)<\/header>/)?.[1]

  assert.ok(toolbar, 'la toolbar applicativa deve usare il modulo Panda della shell')
  assert.doesNotMatch(toolbar, /Apri cartella/)
  assert.doesNotMatch(toolbar, /appearance-control/)
  assert.match(settings, /Aspetto dell’applicazione/)
  assert.match(settings, /<SelectField aria-label="Aspetto dell’applicazione"/)
  for (const [value, label] of [['system', 'Sistema'], ['dark', 'Scuro'], ['light', 'Chiaro']]) {
    assert.match(settings, new RegExp(`value: '${value}', label: '${label}'`))
  }
  assert.doesNotMatch(settings, /<select\b|<option\b/)
})

test('le tab AI adottano il medesimo indicatore di selezione delle tab GitHub', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const github = fs.readFileSync(path.join(__dirname, '../src/components/github-workspace.tsx'), 'utf8')
  const aiStyles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/ai.ts'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(app, /<Tabs\.List className=\{aiStyles\.tabsList\} aria-label="Sezioni AI">[\s\S]*?<Tabs\.Indicator\s*\/>/)
  assert.match(github, /<Tabs\.List className=\{gh\.tabsList\} aria-label="Sezioni GitHub">[\s\S]*?<Tabs\.Indicator\s*\/>/)
  assert.match(recipes, /indicator:\s*\{[^}]*bg:\s*'accentSolid'[^}]*h:\s*'0\.5'/)
  assert.match(aiStyles, /tabsList:\s*css\(\{[\s\S]*?overflowX:\s*'auto'/)
  assert.doesNotMatch(`${app}\n${github}\n${aiStyles}`, /ai-tab-active|github-tab-active|ui-tablist|className="ai-tabs"/)
})

test('Generali gestisce valori globali e personalizzazioni del workspace', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/components/settings.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/settings.ts'), 'utf8')

  assert.match(settings, /useAppPreferences\(\)/)
  assert.match(settings, /Valori globali/)
  assert.match(settings, /Workspace aperto/)
  for (const [key, section] of [['editor', 'Editor'], ['terminal', 'Terminale'], ['git', 'Git'], ['database', 'Database']]) assert.match(settings, new RegExp(`${key}: '${section}'`))
  assert.match(settings, /Personalizzato/)
  assert.match(settings, /Usa globale/)
  assert.match(settings, /Rimuovi tutte le personalizzazioni/)
  assert.match(settings, /<SegmentGroup\.Root aria-label="Ambito impostazioni" className=\{settingsStyles\.scopeSwitch\}/)
  assert.match(settings, /<Checkbox aria-label=\{definition\.label\}/)
  assert.match(settings, /<SelectField aria-label=\{definition\.label\}/)
  assert.match(settings, /<Field\.Input[\s\S]*?aria-label=\{definition\.label\}[\s\S]*?onBlur=\{\(\) => \{ void commit\(\) \}\}/)
  assert.match(settings, /onKeyDown=\{\(event\) => \{[\s\S]*?event\.key === 'Enter'/)
  assert.match(styles, /export const preferenceOriginStyle = cva\(/)
  assert.match(styles, /preferenceGrid:\s*css\(\{[\s\S]*?gridTemplateColumns:\s*'minmax\(0, 1fr\)'[\s\S]*?rowGap:\s*'0'/)
  assert.match(styles, /preferenceSection:\s*css\(\{[\s\S]*?bg:\s*'transparent'[\s\S]*?borderTopColor:\s*'borderDefault'[\s\S]*?_last:\s*\{ borderBottomColor:\s*'borderDefault', borderBottomWidth:\s*'1px' \}/)
  assert.match(styles, /preferenceRow:\s*css\(\{[\s\S]*?borderBottomColor:\s*'borderDefault'[\s\S]*?_last:\s*\{ borderBottomWidth:\s*'0' \}/)
  assert.match(styles, /customized:\s*\{[\s\S]*?true:\s*\{ color:\s*'accentText'/)
})

test('Generali espone diagnostica Terminale AI privacy-safe e solo su richiesta', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/components/settings.tsx'), 'utf8')
  const diagnostics = fs.readFileSync(path.join(__dirname, '../src/components/terminal-diagnostics.tsx'), 'utf8')

  assert.match(settings, /<TerminalDiagnostics/)
  assert.match(diagnostics, /Metriche tecniche senza contenuti della sessione/)
  assert.match(diagnostics, /terminal\.diagnostics\(\)/)
  assert.match(diagnostics, /terminal\.exportDiagnostics\(\)/)
  assert.doesNotMatch(diagnostics, /setInterval/)
})

test('Impostazioni presenta aggiornamenti con filtri stato pronto e rollback confermato', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/components/settings.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/settings.ts'), 'utf8')

  assert.match(settings, /type SettingsTab = .*'updates'/)
  assert.match(settings, /> Aggiornamenti/)
  for (const label of ['Skill', 'Estensioni Pi', 'Runtime Pi']) assert.match(settings, new RegExp(label))
  assert.match(settings, /Aggiornamenti pronti.*riavvia per attivarli/)
  assert.match(settings, /title: 'Ripristina versione precedente'/)
  assert.match(settings, /window\.vincodeLab\.updates\.downloadAll/)
  assert.match(settings, /<SegmentGroup\.Root aria-label="Filtra aggiornamenti" className=\{settingsStyles\.updateFilters\}/)
  assert.match(settings, /<Checkbox checked=\{update\.policy === 'automatic'\}/)
  assert.match(styles, /updateList:\s*css\(\{ display:\s*'grid', gap:\s*'0' \}\)/)
  assert.match(styles, /updateCard:\s*css\(\{[\s\S]*?bg:\s*'transparent'[\s\S]*?borderBottomColor:\s*'borderDefault'[\s\S]*?borderTopColor:\s*'borderDefault'[\s\S]*?gridTemplateColumns:\s*'minmax\(0, 1fr\) auto'/)
  assert.match(styles, /updateBanner:\s*css\(\{[\s\S]*?bg:\s*'stateWarningSoft'[\s\S]*?borderLeftColor:\s*'stateWarning'/)
})
