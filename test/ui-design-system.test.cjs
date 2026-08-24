const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { readAppSource } = require('./helpers/app-source.cjs')
const { readDatabaseModule, readDatabaseSource } = require('./helpers/database-source.cjs')
const { readGitHubModule, readGitHubSource } = require('./helpers/github-source.cjs')
const { readRemoteFilesSource } = require('./helpers/remote-files-source.cjs')
const { readSettingsSource } = require('./helpers/settings-source.cjs')
const { readTerminalSource } = require('./helpers/terminal-source.cjs')

test('design system definisce token e focus condivisi', () => {
  const tokens = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  const globalCss = fs.readFileSync(path.join(__dirname, '../src/theme/global-css.ts'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  for (const token of ['surfaceCanvas', 'surfaceRaised', 'textPrimary', '--surface-raised', '--text-primary', '--space-3', '--radius-sm']) {
    assert.match(tokens, new RegExp(token))
  }
  assert.match(recipes, /_focusVisible:/)
  assert.match(recipes, /focusRing/)
  assert.match(globalCss, /_motionReduce/)
  assert.doesNotMatch([recipes, globalCss].join('\n'), /prefers-reduced-motion/)
})

test('i temi applicano la palette Graphite tecnica approvata', () => {
  const tokens = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  const lightTheme = tokens.slice(tokens.indexOf('light: {'), tokens.indexOf('dark: {'))
  const darkTheme = tokens.slice(tokens.indexOf('dark: {'), tokens.indexOf('\n    },\n  },\n  spacing:'))

  for (const token of [
    "surfaceCanvas: { value: '#F4F5F7' }",
    "surfaceRaised: { value: '#FFFFFF' }",
    "surfacePanel: { value: '#ECEEF2' }",
    "borderDefault: { value: '#D7DAE0' }",
    "accentSolid: { value: '#5B4FF5' }",
    "accentContrast: { value: '#FFFFFF' }",
    "stateSuccess: { value: '#147A5F' }",
    "stateWarning: { value: '#9A5C14' }",
    "textPrimary: { value: '#17191D' }",
    "textTertiary: { value: '#61666F' }",
    "codeSurface: { value: '#FFFFFF' }",
  ]) assert.match(lightTheme, new RegExp(token))

  for (const token of [
    "surfaceCanvas: { value: '#090B10' }",
    "surfaceRaised: { value: '#11141B' }",
    "borderDefault: { value: '#292F3B' }",
    "accentSolid: { value: '#766CFF' }",
    "accentContrast: { value: '#11141B' }",
    "stateSuccess: { value: '#56D6C1' }",
    "stateWarning: { value: '#F3B55B' }",
    "textTertiary: { value: '#848E9D' }",
    "codeSurface: { value: '#090B10' }",
  ]) assert.match(darkTheme, new RegExp(token))
})

test('le tab condivise mantengono icona e testo sulla stessa riga', () => {
  const tabs = fs.readFileSync(path.join(__dirname, '../src/components/ui/tabs.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(tabs, /@ark-ui\/react\/tabs/)
  assert.match(tabs, /createStyleContext\(tabs\)/)
  assert.match(recipes, /trigger:\s*\{[^}]*alignItems:\s*'center'/)
  assert.match(recipes, /trigger:\s*\{[^}]*display:\s*'inline-flex'/)
  assert.match(recipes, /trigger:\s*\{[^}]*gap:\s*'1\.5'/)
  assert.match(recipes, /trigger:\s*\{[^}]*whiteSpace:\s*'nowrap'/)
  assert.doesNotMatch([tabs, recipes].join('\n'), /\.ui-tab\b/)
})

test('il design system espone ruoli Graphite per superficie, stato, elevazione, densità e motion', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  for (const token of ['surfaceSubtle', 'stateSuccess', 'elevation1', 'controlMd', 'durations:']) {
    assert.match(styles, new RegExp(token))
  }
  const globalCss = fs.readFileSync(path.join(__dirname, '../src/theme/global-css.ts'), 'utf8')
  assert.match(globalCss, /_motionReduce/)
})

test('i layer temporanei usano uno scrim semantico condiviso', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  const github = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')
  const panda = fs.readFileSync(path.join(__dirname, '../panda.config.ts'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(styles, /scrim:\s*themedColor\('scrim'\)/)
  assert.match(panda, /semanticTokens:\s*graphiteSemanticTokens/)
  assert.match(recipes, /backdrop:\s*\{[^}]*bg:\s*'scrim'/)
  assert.doesNotMatch(github, /\.github-item-modal-backdrop\b/)
})

test('il design system espone ruoli semantici per editor, codice e stato Git', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')

  for (const token of [
    '--code-surface', '--code-gutter', '--code-text', '--code-line', '--code-selection', '--code-caret', '--code-active-line',
    '--code-selection-match', '--code-selection-border', '--code-search-match', '--syntax-keyword', '--syntax-string', '--syntax-number',
    '--syntax-comment', '--syntax-function', '--syntax-type', '--syntax-operator', '--syntax-property', '--syntax-accent',
    'stateSuccess', 'stateWarning', 'stateError', 'stateInfo',
  ]) {
    assert.match(styles, new RegExp(token))
  }
})

test('l editor mappa gli stati Git sui ruoli condivisi', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/theme/styles/editor.ts'), 'utf8')

  for (const token of ['gitStatusAdded', 'gitStatusModified', 'gitStatusDeleted', 'gitStatusRenamed']) {
    assert.match(editor, new RegExp(token))
  }
})

test('la superficie CodeMirror riusa i ruoli semantici del codice', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/styles/views/editor.css'), 'utf8')

  assert.match(editor, /\.codemirror-host \.cm-editor\s*\{[^}]*background:\s*var\(--code-surface\)/)
  assert.match(editor, /\.codemirror-host \.cm-gutters\s*\{[^}]*color:\s*var\(--code-muted\)/)
  assert.match(editor, /\.codemirror-host \.cm-panels\s*\{[^}]*color:\s*var\(--code-text\)/)
})

test('l editor non conserva una palette locale fuori dal design system', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/styles/views/editor.css'), 'utf8')

  assert.doesNotMatch(editor, /#[0-9a-f]{3,8}\b|rgb\(/i)
})

test('le preview e la ricerca dell editor mantengono ruoli semantici ad alta densità', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/styles/views/editor.css'), 'utf8')

  assert.match(editor, /\.codemirror-host \.cm-media-preview\s*\{[^}]*background:\s*var\(--code-surface\)/)
  assert.match(editor, /\.codemirror-host \.cm-media-preview-csv table\s*\{[^}]*color:\s*var\(--code-text\)/)
  assert.match(editor, /\.codemirror-host \.cm-markdown-preview\s*\{[^}]*color:\s*var\(--code-text\)/)
  for (const token of ['--type-body', '--type-code', '--type-section', '--type-display']) assert.match(editor, new RegExp(token))
  assert.doesNotMatch(editor, /font(?:-size)?:\s*(?:12|13|15|29)px/)
  assert.match(editor, /\.editor-search-panel input\s*\{[^}]*border:[^;}]*var\(--line-strong\)/)
})

test('il design system definisce una scala tipografica per le superfici desktop', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')

  for (const token of ['graphiteDisplay', 'graphiteTitle', 'graphitePage', 'graphiteSection', 'graphiteBody', 'graphiteMeta', 'graphiteCode']) {
    assert.match(styles, new RegExp(token))
  }
})

test('la shell dell’app riusa i ruoli Graphite per canvas, toolbar e feedback', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')
  const terminal = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(shell, /root:\s*css\(\{[\s\S]*?bg:\s*'surfaceCanvas'/)
  assert.match(shell, /toolbar:\s*css\(\{[\s\S]*?bg:\s*'surfaceRaised'/)
  assert.match(terminal, /surface:\s*css\(\{[\s\S]*?bg:\s*'codeSurface'/)
  assert.match(terminal, /recovery:\s*css\(\{[\s\S]*?bg:\s*'stateErrorSoft'/)
  assert.match(terminal, /recovery:\s*css\(\{[\s\S]*?borderColor:\s*'stateError'/)
  assert.match(terminal, /recovery:\s*css\(\{[\s\S]*?color:\s*'stateError'/)
})

test('logo nome e workspace sono centrati sulla fascia dei controlli finestra macOS', () => {
  const shell = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')
  const home = fs.readFileSync(path.join(__dirname, '../src/theme/styles/home.ts'), 'utf8')

  assert.match(shell, /gridTemplateColumns:\s*'minmax\(0, 1fr\) auto minmax\(0, 1fr\)'/)
  assert.match(home, /root:\s*css\(\{[\s\S]*?gridColumn:\s*'2'/)
  assert.match(home, /justifySelf:\s*'center'/)
})

test('il selettore workspace è centrato e consente una seconda finestra controllata', () => {
  const app = readAppSource()
  const switcher = fs.readFileSync(
    path.join(__dirname, '../src/features/workspace/components/workspace-switcher.tsx'),
    'utf8',
  )
  const popover = fs.readFileSync(path.join(__dirname, '../src/components/ui/popover.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/home.ts'), 'utf8')
  const shellStyles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')
  const shell = fs.readFileSync(path.join(__dirname, '../src/styles/shell.css'), 'utf8')

  assert.match(app, /<WorkspaceSwitcher/)
  assert.match(switcher, /<Popover\.Root[^>]*open=\{open\}/)
  assert.match(switcher, /<Popover\.Trigger asChild>/)
  assert.match(switcher, /<Popover\.Portal><Popover\.Positioner><Popover\.Content[^>]*aria-label="Cambia workspace"/)
  assert.match(popover, /@ark-ui\/react\/popover/)
  assert.match(popover, /createStyleContext\(popover\)/)
  assert.doesNotMatch(switcher, /role="dialog"|aria-modal="true"/)
  assert.match(switcher, /Apri qui/)
  assert.match(switcher, /Nuova finestra/)
  assert.match(switcher, /Limite di due finestre raggiunto/)
  assert.match(switcher, /Progetto già aperto in un'altra finestra/)
  assert.match(shellStyles, /toolbar:\s*css\(\{[\s\S]*?display:\s*'grid'/)
  assert.match(shellStyles, /gridTemplateColumns:\s*'minmax\(0, 1fr\) auto minmax\(0, 1fr\)'/)
  assert.match(shell, /-webkit-app-region:\s*no-drag/)
  assert.match(recipes, /export const popoverRecipe = defineSlotRecipe/)
  assert.match(recipes, /positioner:\s*\{\s*zIndex:\s*'popover'/)
  assert.doesNotMatch(styles, /panel:\s*css\(\{[^}]*zIndex:/)
  assert.match(styles, /panel:\s*css\(\{[\s\S]*?w:\s*'min\(620px, calc\(100vw - 24px\)\)'/)
  assert.match(styles, /@media \(max-width: 900px\)/)
})

test('il pulsante di chiusura delle notifiche usa lo slot Ark Toast e la recipe Graphite', () => {
  const toast = fs.readFileSync(path.join(__dirname, '../src/components/ui/toast.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(toast, /withContext\(ArkToast\.CloseTrigger, 'closeTrigger'\)/)
  assert.match(toast, /<ToastCloseTrigger aria-label="Chiudi notifica">/)
  assert.match(recipes, /closeTrigger:\s*\{[^}]*borderRadius:\s*'l1'[^}]*h:\s*'6'[^}]*w:\s*'6'/)
  assert.doesNotMatch(toast, /<button\b|data-close-button/)
})

test('la shell dell’app non conserva una palette locale fuori dal design system', () => {
  const styles = [
    fs.readFileSync(path.join(__dirname, '../src/theme/styles/home.ts'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8'),
  ].join('\n')

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgb\(/i)
})

test('Ark Toast usa direttamente i ruoli Graphite senza alias shadcn o Sonner', () => {
  const globalCss = fs.readFileSync(path.join(__dirname, '../src/theme/global-css.ts'), 'utf8')
  const tokens = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  const styleEntry = fs.readFileSync(path.join(__dirname, '../src/styles/index.css'), 'utf8')
  const toast = fs.readFileSync(path.join(__dirname, '../src/components/ui/toast.tsx'), 'utf8')
  const toastStore = fs.readFileSync(path.join(__dirname, '../src/components/ui/toast-store.ts'), 'utf8')
  const app = readAppSource()
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  const packageManifest = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  const rendererSources = fs.readdirSync(path.join(__dirname, '../src'), { recursive: true })
    .filter((file) => typeof file === 'string' && /\.[cm]?[jt]sx?$/.test(file))
    .map((file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'))
    .join('\n')

  assert.doesNotMatch(globalCss, /oklch\(/i)
  assert.match(toast, /@ark-ui\/react\/toast/)
  assert.match(toast, /createStyleContext\(toastStyles\)/)
  assert.match(toastStore, /const toastStore = createToaster/)
  assert.doesNotMatch(toast, /position\?:/)
  assert.doesNotMatch(app, /<Toaster[^>]*position=/)
  assert.match(recipes, /export const toastRecipe = defineSlotRecipe/)
  assert.match(recipes, /root:\s*\{[\s\S]*?bg:\s*'surfaceRaised'[\s\S]*?color:\s*'textPrimary'/)
  assert.doesNotMatch(`${toast}\n${toastStore}\n${rendererSources}`, /from ['"]sonner['"]|data-sonner/)
  assert.doesNotMatch(packageManifest, /"sonner"\s*:/)
  assert.doesNotMatch(tokens, /--(?:background|foreground|card|popover|primary|secondary|muted|accent-foreground|destructive|border|input|ring):/)
  assert.doesNotMatch(styleEntry, /@import\s+["']\.\/(?:(?:base|tokens|themes)\.css|views\/github\.css)["']/)
  for (const bridge of ['./shell.css', './views/terminal.css', './views/editor.css', './views/database.css']) {
    assert.match(styleEntry, new RegExp(`@import "${bridge.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
  }
})

test('le superfici Graphite non mantengono override cromatici legacy', () => {
  const styleDirectory = path.join(__dirname, '../src/theme/styles')
  const styles = fs.readdirSync(styleDirectory)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => fs.readFileSync(path.join(styleDirectory, file), 'utf8'))
    .join('\n')

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i)
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient|!important/i)
})

test('xterm riceve il tema dal design system senza colori duplicati nei componenti', () => {
  const app = readAppSource()
  const freeTerminal = readTerminalSource()
  const xtermThemePath = path.join(__dirname, '../src/lib/xterm-theme.ts')
  const xtermTheme = fs.existsSync(xtermThemePath) ? fs.readFileSync(xtermThemePath, 'utf8') : ''

  assert.match(app, /readXtermTheme\(\)/)
  assert.match(freeTerminal, /readXtermTheme\(\)/)
  assert.doesNotMatch(app, /#[0-9a-f]{3,8}\b/i)
  assert.doesNotMatch(freeTerminal, /#[0-9a-f]{3,8}\b/i)
  assert.match(xtermTheme, /getComputedStyle\(document\.documentElement\)/)
  assert.match(xtermTheme, /export function observeXtermTheme/)
  assert.match(xtermTheme, /--code-surface/)
  assert.match(xtermTheme, /--code-text/)
  assert.match(xtermTheme, /--code-selection/)
  assert.match(app, /observeXtermTheme/)
  assert.match(freeTerminal, /observeXtermTheme/)
})

test('i dialog usano la Presence Ark mentre Motion 13 resta confinato alla presenza del workbench', () => {
  const packageJson = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  const packageLock = fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8')
  const confirmation = fs.readFileSync(path.join(__dirname, '../src/components/confirmation-dialog.tsx'), 'utf8')
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/ui/dialog.tsx'), 'utf8')
  const workbenchPresence = fs.readFileSync(path.join(__dirname, '../src/components/ui/workbench-presence.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  const tokens = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')

  assert.equal(fs.existsSync(path.join(__dirname, '../src/components/motion-presence.tsx')), false)
  assert.match(packageJson, /"motion"\s*:\s*"\^13\./)
  assert.match(packageLock, /node_modules\/motion"/)
  assert.doesNotMatch(packageJson, /"(?:framer-motion|motion-dom|motion-utils)"\s*:/)
  assert.match(dialog, /@ark-ui\/react\/dialog/)
  assert.match(workbenchPresence, /from 'motion\/react'/)
  assert.match(workbenchPresence, /AnimatePresence/)
  assert.match(workbenchPresence, /<motion\.div/)
  assert.match(workbenchPresence, /useReducedMotion\(\)/)
  assert.match(workbenchPresence, /--motion-fast/)
  assert.match(workbenchPresence, /--ease-standard/)
  assert.match(confirmation, /<Dialog\.Root[\s\S]*?finalFocusEl=\{\(\) => focusState\.opener\}[\s\S]*?initialFocusEl=\{\(\) => cancelButton\.current\}[\s\S]*?lazyMount[\s\S]*?open=\{request !== null\}[\s\S]*?unmountOnExit/)
  for (const keyframe of ['dialogBackdropIn', 'dialogBackdropOut', 'dialogContentIn', 'dialogContentOut']) {
    assert.match(tokens, new RegExp(`${keyframe}:`))
    assert.match(recipes, new RegExp(`animationName: '${keyframe}'`))
  }
  assert.ok((recipes.match(/_motionReduce:\s*\{\s*animationDuration:\s*'0ms'/g) ?? []).length >= 2)
})

test('la Presence Ark e WorkbenchPresence non avvolgono le viste operative persistenti', () => {
  const app = readAppSource()
  const confirmation = fs.readFileSync(path.join(__dirname, '../src/components/confirmation-dialog.tsx'), 'utf8')
  const settings = readSettingsSource()
  const github = [
    readGitHubModule('components/github-issue-dialogs.tsx'),
    readGitHubModule('components/github-project-item-dialog.tsx'),
  ].join('\n')

  assert.match(confirmation, /const renderedRequest = request \?\? lastRequest/)
  assert.match(confirmation, /onExitComplete=\{\(\) => \{/)
  assert.match(app, /<WorkbenchPresence[\s\S]*?presenceKey=\{filteredRecents\.length > 0 \? `recents-\$\{view\}` : search \? 'search-empty' : 'empty'\}[\s\S]*?<\/WorkbenchPresence>/)
  assert.doesNotMatch(app, /<WorkbenchPresence[\s\S]*?<ProjectEditor|<WorkbenchPresence[\s\S]*?<TerminalWorkspace|<WorkbenchPresence[\s\S]*?<GitHubWorkspace|<WorkbenchPresence[\s\S]*?<DatabaseWorkspace/)
  for (const tab of ['general', 'updates', 'runtime', 'packages', 'skills']) {
    assert.match(settings, new RegExp(`<Tabs\\.Content asChild value="${tab}">`))
  }
  assert.match(github, /\{state\.selectedIssue && <Dialog\.Root[^\n]* open=/)
  assert.match(github, /if \(!item\) return null[\s\S]*?return <Dialog\.Root[^\n]* open=/)
  assert.doesNotMatch([app, settings, github].join('\n'), /MotionPresence/)
})

test('la griglia Database reimposta le bozze al remount senza aggiornamenti sincroni in effect', () => {
  const grid = fs.readFileSync(path.join(__dirname, '../src/features/database/components/database-table-grid.tsx'), 'utf8')
  const workspace = readDatabaseSource()

  assert.doesNotMatch(grid, /useEffect\(\(\) => \{\s*setDrafts\(\{\}\)/)
  assert.match(grid, /useEffect\(\(\) => \{[\s\S]*onDraftGuardChange\(guard\)[\s\S]*onDraftGuardChange\(null\)/)
  assert.match(workspace, /<DatabaseTableGrid[\s\S]*?key=\{`\$\{selectedTableName\}:\$\{tableRevision\}`\}/)
})

test('la griglia Database usa ruoli semantici Graphite e viste locali accessibili', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')
  const workspace = readDatabaseSource()

  assert.match(styles, /stateSuccess/)
  assert.match(styles, /stateWarning/)
  assert.match(workspace, /<Tabs\.Root asChild value=\{databaseView\}[^>]*onValueChange=/)
  assert.match(workspace, /<Tabs\.List[^>]*aria-label="Viste Database"/)
  assert.match(workspace, /<Tabs\.Trigger value="sql">SQL<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Trigger value="data">Dati<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Content value="sql"/)
  assert.match(workspace, /<Tabs\.Content value="data"/)
  assert.doesNotMatch(workspace, /moveTabFocus|role="(?:tablist|tab)"|tabIndex=\{databaseView/)
})

test('la navigazione principale conserva tutte le tab senza overflow nei viewport stretti', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')

  assert.match(styles, /navigation:\s*css\(\{[\s\S]*?overflowX:\s*'auto'/)
  assert.match(styles, /@media \(max-width: 900px\)/)
  assert.match(styles, /gridColumn:\s*'1 \/ -1'/)
})

test('il caricamento della tabella Database parte nel task asincrono senza render a cascata', () => {
  const resources = readDatabaseModule('hooks/use-database-resources.ts')
  assert.match(resources, /if \(!connectionId \|\| !connectionReady \|\| !selectedTableName\)[\s\S]*?const timer = window\.setTimeout\([\s\S]*?\(\) => \{[\s\S]*?setTableLoading\(true\)/)
})

test('un errore di vista non sostituisce toolbar e navigazione globali', () => {
  const app = readAppSource()

  assert.doesNotMatch(app, /return\s*<AppErrorBoundary>/)
  assert.match(app, /<ViewErrorBoundary viewName="GitHub"[^>]*>/)
  assert.match(app, /<ViewErrorBoundary viewName="Database"[^>]*>/)
  assert.match(app, /onRetry=\{refreshWorkspaceSessionForRecovery\}/)
})

test('le sezioni operative consumano le preferenze effettive globali o del workspace', () => {
  const editor = [
    '../src/features/editor/components/project-editor.tsx',
    '../src/features/editor/hooks/use-editor-preferences.ts',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')
  const terminal = readTerminalSource()
  const github = readGitHubSource()
  const database = readDatabaseSource()

  for (const key of ['editor.fontSize', 'editor.tabSize', 'editor.wordWrap', 'editor.autoSave', 'editor.explorerWidth']) assert.match(editor, new RegExp(key.replace('.', '\\.')))
  for (const key of ['terminal.fontSize', 'terminal.fontFamily', 'terminal.cursorStyle', 'terminal.scrollback', 'terminal.commandsWidth']) assert.match(terminal, new RegExp(key.replace('.', '\\.')))
  for (const key of ['git.autoRefreshSeconds', 'git.projectSelectorWidth']) assert.match(github, new RegExp(key.replace('.', '\\.')))
  for (const key of ['database.rowLimit', 'database.confirmMutations', 'database.explorerWidth']) assert.match(database, new RegExp(key.replace('.', '\\.')))
})

test('il tema scuro espone solo token e non selettori di componente', () => {
  const themes = fs.readFileSync(path.join(__dirname, '../src/theme/tokens.ts'), 'utf8')
  const styleEntry = fs.readFileSync(path.join(__dirname, '../src/styles/index.css'), 'utf8')

  assert.match(themes, /explicitDark:\s*':root\[data-theme="dark"\] &'/)
  assert.match(themes, /systemTheme:\s*':where\(:root:not\(\[data-theme\]\), :root\[data-theme="system"\]\) &'/)
  assert.match(themes, /surfaceCanvas:\s*themedColor\('surfaceCanvas'\)/)
  assert.match(themes, /textPrimary:\s*themedColor\('textPrimary'\)/)
  assert.doesNotMatch(themes, /\.(app-shell|github-|terminal-|settings-)/)
  assert.doesNotMatch(styleEntry, /themes\.css/)
})

test('Impostazioni usa ruoli Graphite anche per l output tecnico di Pi', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../src/theme/styles/settings.ts'), 'utf8')

  assert.match(settings, /configTerminal:\s*css\(\{[\s\S]*?bg:\s*'surfaceInverse'/)
  assert.match(settings, /configTerminal:\s*css\(\{[\s\S]*?color:\s*'textInverse'/)
  assert.doesNotMatch(settings, /#[0-9a-f]{3,8}\b/i)
})

test('le Skill usano il testo secondario del tema negli stati di caricamento', () => {
  const skills = fs.readFileSync(path.join(__dirname, '../src/theme/styles/ai.ts'), 'utf8')

  assert.match(skills, /skillsPlaceholder:\s*css\(\{[\s\S]*?color:\s*'textSecondary'/)
})

test('la superficie Skill non introduce una palette locale', () => {
  const skills = fs.readFileSync(path.join(__dirname, '../src/theme/styles/ai.ts'), 'utf8')

  assert.doesNotMatch(skills, /#[0-9a-f]{3,8}\b|rgb\(/i)
})

test('Terminale e Istruzioni usano solo ruoli Graphite', () => {
  const terminal = [
    fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '../src/theme/styles/ai.ts'), 'utf8'),
  ].join('\n')

  assert.doesNotMatch(terminal, /#[0-9a-f]{3,8}\b|rgb\(/i)
})

test('impostazioni usa un unico scorrimento della pagina e una superficie operativa', () => {
  const app = readAppSource()
  const source = fs.readFileSync(path.join(__dirname, '../src/theme/styles/settings.ts'), 'utf8')
  const layout = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')
  const settings = readSettingsSource()
  const tabs = fs.readFileSync(path.join(__dirname, '../src/components/ui/tabs.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  assert.match(settings, /<Tabs\.List className=\{settingsStyles\.tabs\}/)
  assert.match(settings, /<Tabs\.Content asChild value="general"/)
  assert.match(tabs, /createStyleContext\(tabs\)/)
  assert.match(recipes, /list:\s*\{[^}]*display:\s*'flex'/)
  assert.match(source, /page:\s*css\(\{[\s\S]*?overflowY:\s*'auto'/)
  assert.doesNotMatch(source, /list:\s*css\(\{[^}]*maxH:/)
  assert.match(layout, /standalonePage:\s*css\(\{[\s\S]*?display:\s*'flex'[\s\S]*?flex:\s*'1'[\s\S]*?overflow:\s*'hidden'/)
  assert.match(app, /<section className=\{shellStyles\.standalonePage\}>\s*<ViewErrorBoundary viewName="Impostazioni">/)
  assert.doesNotMatch(app, /className=\{`\$\{shellStyles\.sectionPage\} \$\{shellStyles\.standalonePage\}`\}/)
})

test('i messaggi di sistema usano una terminologia italiana coerente', () => {
  const instructions = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-instructions.tsx'), 'utf8')
  const github = readGitHubSource()
  assert.doesNotMatch(instructions, /project-local/)
  assert.match(github, /Progetti GitHub del workspace/)
  assert.match(github, /'Board del Project'/)
  assert.doesNotMatch(github, /'Board Project'/)
})

test('i controlli icon-only espongono un tooltip operativo', () => {
  const iconButton = fs.readFileSync(path.join(__dirname, '../src/components/ui/icon-button.tsx'), 'utf8')
  const tooltip = fs.readFileSync(path.join(__dirname, '../src/components/ui/tooltip.tsx'), 'utf8')
  const skills = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-skills.tsx'), 'utf8')
  const settings = readSettingsSource()
  const app = readAppSource()
  const attachments = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/terminal-attachments.tsx'), 'utf8')
  const terminal = readTerminalSource()
  assert.match(tooltip, /@ark-ui\/react\/tooltip/)
  assert.match(iconButton, /<Tooltip\.Root/)
  assert.match(iconButton, /const button = <Button/)
  assert.match(iconButton, /<Tooltip\.Trigger asChild><span ref=\{triggerRef\} aria-disabled=\{disabled \? 'true' : undefined\}/)
  assert.match(iconButton, /role=\{disabled \? 'group' : undefined\} tabIndex=\{disabled \? 0 : undefined\}/)
  assert.match(iconButton, /if \(!disabled \|\| !buttonHadFocus\.current\) return[\s\S]*?triggerRef\.current\?\.focus\(\)/)
  assert.match(iconButton, /<Tooltip\.Portal><Tooltip\.Positioner><Tooltip\.Content><Tooltip\.Arrow><Tooltip\.ArrowTip \/><\/Tooltip\.Arrow>/)
  assert.match(iconButton, /'& > button:disabled': \{ pointerEvents: 'none' \}/)
  assert.match(skills, /<IconButton[^>]*tooltip="Elimina skill selezionata"/)
  assert.match(settings, /<IconButton[^>]*tooltip=\{`Elimina \$\{skill\.name\}`\}/)
  assert.match(app, /import \{[^}]*LayoutGrid[^}]*List[^}]*\} from 'lucide-react'/)
  assert.match(app, /<SegmentGroup\.Root className=\{homeStyles\.viewControls\} aria-label="Modalità di visualizzazione" orientation="horizontal"/)
  assert.match(app, /<SegmentGroup\.Item aria-label="Vista griglia" title="Vista griglia" value="grid">[\s\S]*?<LayoutGrid aria-hidden="true" size=\{16\}/)
  assert.match(app, /<SegmentGroup\.Item aria-label="Vista elenco" title="Vista elenco" value="list">[\s\S]*?<List aria-hidden="true" size=\{16\}/)
  assert.match(app, /<IconButton[^>]*tooltip="Risultato precedente"/)
  assert.match(attachments, /<IconButton[^>]*tooltip=\{`Rimuovi \$\{attachment\.name\}`\}/)
  assert.match(terminal, /<IconButton[^>]*tooltip="Chiudi comandi workspace"/)
  assert.match(terminal, /<IconButton[^>]*tooltip=\{`Modifica \$\{command\.title\}`\}/)
})

test('GitHub esplicita il prerequisito per le azioni remote disabilitate', () => {
  const github = readGitHubSource()
  assert.match(github, /Collega o crea un repository GitHub dalla scheda Modifiche per pubblicare e sincronizzare il branch\./)
})

test('GitHub distingue il branch del workspace dall’identità del repository', () => {
  const github = readGitHubSource()

  assert.match(github, /<h1 className=\{gh\.pageTitle\}><GitFork size=\{18\} \/> Git del workspace<\/h1>/)
  assert.match(github, /<strong>Branch attivo<\/strong> \{status\.branch\}/)
  assert.doesNotMatch(github, /> Repository del workspace<\/h1>/)
})

test('GitHub separa il grafo e presenta i Projects del workspace in una tabella raggruppata', () => {
  const github = [
    readGitHubModule('model/github-workspace.types.ts'),
    readGitHubModule('components/github-workspace.tsx'),
    readGitHubModule('components/github-graph-panel.tsx'),
    readGitHubModule('components/github-projects-panel.tsx'),
    readGitHubModule('components/github-project-board.tsx'),
    readGitHubModule('components/github-project-picker.tsx'),
  ].join('\n')

  assert.match(github, /type GitHubTab = 'changes' \| 'graph' \| 'issues' \| 'projects'/)
  assert.match(github, /<Tabs\.Root asChild value=\{state\.tab\}[^>]*onValueChange=/)
  assert.match(github, /<Tabs\.List[^>]*aria-label="Sezioni GitHub"/)
  assert.match(github, /<Tabs\.Trigger value="graph">Grafo/)
  assert.match(github, /<Tabs\.Content value="graph"/)
  assert.match(github, /<Tabs\.Content value="projects"/)
  assert.doesNotMatch(github, /id="github-tab-|role="(?:tablist|tab)"/)
  assert.match(github, /className=\{gh\.projectTable\} role="table"/)
  assert.match(github, /<Listbox\.Root[^>]*collection=\{derived\.projectCollection\}[^>]*selectionMode="single"/)
  assert.match(github, /<Listbox\.Item className=\{gh\.projectItem\}[^>]*item=\{project\}/)
  assert.doesNotMatch(github, /github-project-selected/)
  assert.match(github, /aria-label="Raggruppa per"/)
  for (const column of ['Titolo', 'Assegnatari', 'Stato', 'Priorità']) assert.match(github, new RegExp(`>${column}<`))
  assert.match(github, /Solo progetti collegati a <strong>\{state\.data\.repository\.nameWithOwner\}<\/strong>/)
})

test('la board Project rende le sub-issue nella gerarchia del rispettivo padre', () => {
  const component = readGitHubSource()
  const projectsModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-projects.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(projectsModel, /function orderProjectItemsByHierarchy\(items: GitHubProjectItem\[\]\)/)
  assert.match(component, /orderProjectItemsByHierarchy\(items\)\.map\(\(\{ item, depth \}\)/)
  assert.match(component, /gh\.projectTitle\(\{ subissue: depth > 0 \}\)/)
  assert.match(component, /Sub-issue di #\{item\.parent\.number\}/)
  assert.match(styles, /projectTitle:\s*cva\([\s\S]*?subissue:\s*\{\s*true:\s*\{\s*ps:\s*'10\.5'/)
})

test('Project GitHub comunica il caricamento e cerca le attività per numero issue', () => {
  const component = [
    readGitHubModule('hooks/use-github-workspace-state.ts'),
    readGitHubModule('components/github-project-board.tsx'),
  ].join('\n')
  const projectsModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-projects.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(projectsModel, /function matchesProjectItemSearch\(item: GitHubProjectItem, query: string\)/)
  assert.match(projectsModel, /item\.content\?\.number === Number\(numeric\)/)
  assert.match(component, /const \[loadingBoard, setLoadingBoard\] = useState\(false\)/)
  assert.match(component, /aria-busy=\{state\.loadingBoard\}/)
  assert.match(component, /Caricamento Project…/)
  assert.match(component, /placeholder="Cerca per numero, titolo o campo"/)
  assert.match(styles, /boardLoading:\s*css\(\{[\s\S]*?position:\s*'absolute'/)
})

test('i gruppi Project sono intestazioni comprimibili e riconoscibili', () => {
  const github = readGitHubSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(github, /const \[collapsedBoardGroups, setCollapsedBoardGroups\] = useState<Set<string>>\(new Set\(\)\)/)
  assert.match(github, /<Collapsible\.Root asChild key=\{group\} open=\{!collapsed\} onOpenChange=/)
  assert.match(github, /<Collapsible\.Trigger className=\{gh\.projectGroupTrigger\}>/)
  assert.match(github, /<Collapsible\.Content role="presentation">/)
  assert.match(github, /className=\{gh\.projectGroupTrigger\}/)
  assert.doesNotMatch(github, /<Button[^>]*aria-expanded=\{!collapsedBoardGroups\.has\(group\)\}/)
  assert.match(styles, /projectGroupHeadingCell:\s*css\(\{[^}]*borderLeftColor:\s*'accentSolid'/)
  assert.match(styles, /projectGroupTrigger:\s*css\(\{[^}]*justifyContent:\s*'flex-start'/)
})

test('la board Project espone una tabella ARIA completa senza mascherare i controlli interattivi', () => {
  const github = readGitHubSource()

  assert.match(github, /role="table" aria-colcount=/)
  assert.match(github, /role="rowgroup"/)
  assert.match(github, /role="columnheader"/)
  assert.match(github, /className=\{gh\.projectTitleCell\} role="cell"><Button/)
  assert.match(github, /className=\{cx\(gh\.projectCell, gh\.projectAssignees\)\} role="cell"/)
  assert.doesNotMatch(github, /<Button[^>]*role="cell"/)
})

test('la tabella Project riusa i colori del design system dell’app', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(styles, /projectTable:\s*css\(\{[^}]*bg:\s*'surfaceRaised'/)
  assert.match(styles, /projectTableHead:\s*css\(\{[\s\S]*?bg:\s*'surfaceSubtle'/)
  assert.match(styles, /projectGroupHeadingCell:\s*css\(\{[^}]*bg:\s*'accentSubtle'/)
  assert.match(styles, /projectTableRow:\s*cva\([\s\S]*?_hover:\s*\{\s*bg:\s*'surfaceHover'/)
  assert.match(styles, /projectTitleText:\s*css\(\{[^}]*color:\s*'textPrimary'/)
  assert.match(styles, /projectContent:\s*css\(\{[\s\S]*?alignItems:\s*'stretch'/)
  assert.match(styles, /projectListPanel:\s*css\(\{[^}]*h:\s*'full'[^}]*overflow:\s*'hidden'/)
  assert.match(styles, /board:\s*css\(\{[^}]*h:\s*'full'[^}]*overflow:\s*'auto'/)
  assert.match(styles, /boardPlaceholder:\s*css\(\{[^}]*flex:\s*'1'[^}]*h:\s*'full'/)
})

test('GitHub applica ruoli Graphite alle superfici operative e agli stati delle Issue', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(styles, /workspace:\s*css\(\{[\s\S]*?bg:\s*'surfaceCanvas'/)
  assert.match(styles, /header:\s*css\(\{[\s\S]*?bg:\s*'surfaceRaised'/)
  assert.match(styles, /panel:\s*css\(\{[\s\S]*?bg:\s*'surfaceRaised'/)
  assert.match(styles, /issueState:\s*cva\([\s\S]*?open:[\s\S]*?stateSuccess/)
  assert.match(styles, /issueState:\s*cva\([\s\S]*?closed:[\s\S]*?stateInfo/)
})

test('le tab GitHub usano un indicatore Graphite rettilineo senza arrotondare la selezione', () => {
  const github = readGitHubSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(github, /<Tabs\.List className=\{gh\.tabsList\}[^>]*aria-label="Sezioni GitHub"/)
  assert.match(github, /<Tabs\.Indicator\s*\/>/)
  const tabsRecipe = recipes.slice(recipes.indexOf('export const tabsRecipe'), recipes.indexOf('export const dialogRecipe'))
  assert.match(tabsRecipe, /_selected:\s*\{[^}]*bg:\s*'transparent'/)
  assert.doesNotMatch(tabsRecipe, /_selected:\s*\{[^}]*bg:\s*'accentSubtle'/)
  assert.match(tabsRecipe, /indicator:\s*\{[^}]*bg:\s*'accentSolid'[^}]*h:\s*'0\.5'/)
  assert.doesNotMatch(github, /github-tab-active/)
  assert.doesNotMatch(styles, /github-tab-active/)
})

test('GitHub non conserva una palette locale fuori dal design system', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgb\(/i)
})

test('la board Project apre il dettaglio dell’attività in un modal e non mostra azioni di aggiunta', () => {
  const github = readGitHubModule('components/github-project-item-dialog.tsx')

  assert.doesNotMatch(github, /Nuova bozza/)
  assert.doesNotMatch(github, /Aggiungi una issue del workspace/)
  assert.match(github, /if \(!item\) return null[\s\S]*?return <Dialog\.Root[^\n]* open=/)
  assert.match(github, /<Dialog\.Content className=\{cx\(gh\.modalContent, gh\.itemModal\)\}>/)
  assert.match(github, /<Dialog\.Title asChild><h3 className=\{gh\.modalTitle\} id="github-item-modal-title"/)
  assert.match(github, /<Dialog\.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio attività"/)
  assert.doesNotMatch(github, /aria-modal="true"|role="dialog"/)
  assert.match(github, /derived\.issueDetail\?\.body/)
})

test('la lista Issue apre un dettaglio consultabile senza esporre azioni remote', () => {
  const github = [
    readGitHubModule('hooks/use-github-workspace-state.ts'),
    readGitHubModule('components/github-issues-panel.tsx'),
    readGitHubModule('components/github-issue-dialogs.tsx'),
  ].join('\n')

  assert.match(github, /const \[selectedIssue, setSelectedIssue\] = useState<GitHubIssue \| null>\(null\)/)
  assert.match(github, /onClick=\{\(event\) => \{ issueDetailTrigger\.current = event\.currentTarget; state\.setSelectedIssue\(issue\); state\.setIssueDetailOpen\(true\) \}\}/)
  assert.match(github, /\{state\.selectedIssue && <Dialog\.Root[^\n]*open=\{state\.issueDetailOpen\}[^\n]*onOpenChange=/)
  assert.match(github, /onExitComplete=\{\(\) => \{ if \(!state\.issueDetailOpen\) state\.setSelectedIssue\(null\) \}\}/)
  assert.match(github, /<Dialog\.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio issue"/)
  assert.match(github, /state\.selectedIssue\.body/)
})

test('il dettaglio Issue rende la descrizione come anteprima Markdown', () => {
  const github = [
    readGitHubModule('components/github-issue-dialogs.tsx'),
    readGitHubModule('components/github-project-item-dialog.tsx'),
  ].join('\n')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(github, /<MarkdownPreview source=\{state\.selectedIssue\.body\}/)
  assert.match(github, /<MarkdownPreview source=\{derived\.issueDetail\.body\}/)
  assert.doesNotMatch(github, /<p>\{state\.selectedIssue\.body\}<\/p>/)
  assert.match(styles, /export const githubMarkdownStyles/)
})

test('il selettore Project si richiude e gli assegnatari restano compatti nella tabella', () => {
  const github = [
    readGitHubModule('hooks/use-github-workspace-state.ts'),
    readGitHubModule('components/github-project-picker.tsx'),
    readGitHubModule('components/github-project-board.tsx'),
  ].join('\n')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(github, /const \[projectPickerCollapsed, setProjectPickerCollapsed\] = useState\(false\)/)
  assert.match(github, /className=\{gh\.projectPickerContent\(\{ hidden: state\.projectPickerCollapsed \}\)\}/)
  assert.match(github, /className=\{gh\.projectAssignee\}/)
  assert.match(styles, /projectPickerContent:\s*cva\(\{[\s\S]*?variants:\s*\{\s*hidden:\s*\{\s*true:\s*\{\s*display:\s*'none'/)
  assert.match(styles, /projectAssignees:\s*css\(\{[^}]*overflow:\s*'hidden'/)
})

test('le superfici laterali condividono resize accessibile e persistente', () => {
  const editor = [
    '../src/features/editor/components/project-editor.tsx',
    '../src/features/editor/hooks/use-editor-preferences.ts',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')
  const skills = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-skills.tsx'), 'utf8')
  const database = readDatabaseModule('components/database-workspace.tsx')
  const terminal = readTerminalSource()
  const github = [
    readGitHubModule('components/github-projects-panel.tsx'),
    readGitHubModule('components/github-project-picker.tsx'),
    readGitHubModule('components/github-project-board.tsx'),
  ].join('\n')
  const remote = readRemoteFilesSource()
  const splitter = fs.readFileSync(path.join(__dirname, '../src/components/ui/splitter.tsx'), 'utf8')

  for (const component of [editor, skills, database, terminal, github, remote]) {
    assert.match(component, /<Splitter\.Root/)
    assert.match(component, /<Splitter\.Panel/)
    assert.match(component, /<Splitter\.ResizeTrigger[^>]*aria-label=/)
    assert.match(component, /storageKey=(?:"vincodelab\.|\{`vincodelab\.)/)
    assert.doesNotMatch(component, /useResizablePanel|role="separator"|onPointerDown=/)
  }
  assert.match(splitter, /ArkSplitter\.ResizeTrigger/)
  assert.match(splitter, /writeStorageSize\(window\.localStorage, storageKey, size\)/)
  assert.match(splitter, /resetToDefault/)
  assert.match(splitter, /setSize\(fixedPanelLayout\(panels\.length, fixedPanel, defaultFixedSize\)\)/)
})

test('la board GitHub tollera campi restituiti senza metadati testuali', () => {
  const projectsModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-projects.ts'), 'utf8')

  assert.match(projectsModel, /function projectFieldDataType\(field: GitHubProjectField\)/)
  assert.match(projectsModel, /typeof field\.dataType === 'string' \? field\.dataType\.toLowerCase\(\) : ''/)
  assert.match(projectsModel, /function projectFieldName\(field: GitHubProjectField\)/)
  assert.match(projectsModel, /typeof field\.name === 'string' \? field\.name\.toLocaleLowerCase\('it-IT'\) : ''/)
})

test('GitHub espone la freschezza cache e aggiorna senza bloccare dati disponibili', () => {
  const github = [
    readGitHubModule('hooks/use-github-data.ts'),
    readGitHubModule('hooks/use-github-workspace-controller.ts'),
    readGitHubModule('components/github-header.tsx'),
  ].join('\n')
  const displayModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-display.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(github, /gitBridge\.gitStatus\(\{ force \}\)/)
  assert.match(github, /githubBridge\.data\(\{ force \}\)/)
  assert.match(displayModel, /if \(cache\.stale\) return 'Dati non aggiornati'/)
  assert.match(github, /void refreshGitRef\.current\(true\)/)
  assert.match(styles, /cacheState:\s*cva\([\s\S]*?color:\s*'textSecondary'/)
  assert.match(styles, /stale:\s*\{\s*true:\s*\{\s*color:\s*'accentText'/)
})

test('GitHub comunica ogni limite bounded e riferisce le azioni di gruppo ai file visibili', () => {
  const github = readGitHubSource()
  const feedback = fs.readFileSync(path.join(__dirname, '../src/features/github/components/github-feedback.tsx'), 'utf8')
  const projectsModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-projects.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')
  const types = fs.readFileSync(path.join(__dirname, '../src/vincode-lab.d.ts'), 'utf8')
  const boundedSources = `${github}\n${projectsModel}`

  for (const flag of [
    'filesHasMore', 'filesTruncated', 'graphHasMore', 'graphTruncated',
    'issuesHasMore', 'issuesTruncated', 'bodyTruncated', 'labelsHasMore',
    'projectsHasMore', 'projectsTruncated', 'fieldsHasMore', 'fieldsTruncated',
    'fieldOptionsTruncated', 'itemsHasMore', 'itemsTruncated', 'itemValuesTruncated',
  ]) assert.match(boundedSources, new RegExp(flag))
  assert.match(github, /Aggiungi i \{derived\.stageable\.length\} file visibili consentiti/)
  assert.match(github, /Rimuovi i \{derived\.staged\.length\} file visibili/)
  assert.match(github, /Le azioni di gruppo agiscono solo sui file mostrati/)
  assert.match(feedback, /function LimitNotice/)
  assert.match(styles, /limitNotice:\s*css\(\{[\s\S]*?bg:\s*'stateWarningSoft'[\s\S]*?borderColor:\s*'stateWarning'/)
  assert.match(types, /interface GitBranchPage \{ branches: GitBranch\[\]; hasMore: boolean; truncated: boolean \}/)
  assert.match(types, /branches: \(\) => Promise<GitBranchPage>/)
})

test('l’apertura di una board Project riusa la cache fino al refresh esplicito', () => {
  const github = readGitHubSource()
  const loadBoard = github.slice(github.indexOf('  const loadBoard ='), github.indexOf('  const createProject ='))

  assert.match(loadBoard, /githubBridge\.projectBoard\(projectNumber\)/)
  assert.doesNotMatch(loadBoard, /force:\s*true/)
  assert.match(github, /refreshGitHub\(true\)/)
})

test('GitHub non conserva stili della precedente board a colonne', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  for (const selector of ['github-board-columns', 'github-board-column', 'github-board-card', 'github-card-open', 'github-card-status', 'github-item-detail', 'github-draft-form']) {
    assert.doesNotMatch(styles, new RegExp(`\\b${selector}\\b`))
  }
})

test('Impostazioni blocca il refresh ripetuto e mostra lo stato in corso', () => {
  const settings = readSettingsSource()
  assert.match(settings, /const \[refreshing, setRefreshing\] = useState\(false\)/)
  assert.match(settings, /disabled=\{refreshing\}/)
  assert.match(settings, /Aggiornamento…/)
})

test('Impostazioni mantiene un’uscita verso l’apertura workspace anche senza workspace attivo', () => {
  const app = readAppSource()
  assert.doesNotMatch(app, /\{workspace && <Button variant="outline" size="sm" onClick=\{openWorkspace\}/)
  assert.match(app, /<Button variant="outline" size="sm" onClick=\{openWorkspace\} disabled=\{status === 'launching'\}>/)
  assert.match(app, /!workspace && <Tabs\.Trigger value="home"/)
})

test('Ark UI gestisce tab e dialoghi critici mentre Park e Panda possiedono lo stile', () => {
  const packageJson = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  const app = readAppSource()
  const button = fs.readFileSync(path.join(__dirname, '../src/components/ui/button.tsx'), 'utf8')
  const confirmation = fs.readFileSync(path.join(__dirname, '../src/components/confirmation-dialog.tsx'), 'utf8')
  const panda = fs.readFileSync(path.join(__dirname, '../panda.config.ts'), 'utf8')

  assert.match(packageJson, /"@ark-ui\/react"/)
  assert.match(packageJson, /"@pandacss\/dev"/)
  assert.doesNotMatch(packageJson, /@base-ui|tailwindcss|shadcn|class-variance-authority/)
  assert.match(app, /<Tabs\.Root/)
  assert.match(confirmation, /<Dialog\.Root/)
  assert.match(button, /styled\(ark\.button, button\)/)
  assert.match(panda, /semanticTokens/)
})

test('il terminale AI espone copia e incolla anche senza scorciatoie da tastiera', () => {
  const app = readAppSource()
  const toolbar = fs.readFileSync(path.join(__dirname, '../src/components/terminal-toolbar.tsx'), 'utf8')
  assert.match(toolbar, /<IconButton tooltip="Copia selezione" onClick=\{onCopy\}>/)
  assert.match(toolbar, /<IconButton tooltip="Incolla nel terminale" onClick=\{onPaste\}>/)
  assert.match(app, /onPaste=\{\(\) => void pasteIntoTerminal\(\)\}/)
})

test('l’incolla nel Terminale AI segnala esplicitamente un contenuto rifiutato', () => {
  const app = readAppSource()
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/terminal-paste-status.tsx'), 'utf8')

  assert.match(app, /pasteController\.send\(text, setPasteProgress\)/)
  assert.match(dialog, /Contenuto non incollato/)
  assert.match(dialog, /progress\.reason === 'too-large'/)
  assert.match(dialog, /progress\.totalBytes/)
  assert.match(dialog, /progress\.limit/)
  assert.match(dialog, /<Progress\.Root max=\{100\} min=\{0\} value=\{percentage\}>/)
  assert.match(dialog, /<Progress\.Track[^>]*><Progress\.Range \/><\/Progress\.Track>/)
  assert.doesNotMatch(dialog, /role="progressbar"|terminal-paste-progress/)
})

test('i terminali riusano una toolbar con reset zoom e riavvio', () => {
  const app = readAppSource()
  const shell = readTerminalSource()
  const toolbar = fs.readFileSync(path.join(__dirname, '../src/components/terminal-toolbar.tsx'), 'utf8')

  assert.match(app, /<TerminalToolbar/)
  assert.match(shell, /<TerminalToolbar/)
  assert.match(toolbar, /aria-label="Reimposta zoom"/)
  assert.match(toolbar, /<IconButton tooltip="Riavvia sessione" onClick=\{onRestart\}>/)
})

test('il valore dello zoom conserva spazio proprio tra i controlli meno e più', () => {
  const toolbar = fs.readFileSync(path.join(__dirname, '../src/components/terminal-toolbar.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(toolbar, /className=\{terminalStyles\.zoomReset\} aria-label="Reimposta zoom"/)
  assert.match(styles, /zoomReset:\s*css\(\{[^}]*minW:\s*'9\.5'/)
  assert.match(styles, /zoomReset:\s*css\(\{[^}]*flex:\s*'0 0 auto'/)
})

test('la barra del Terminale AI resta piatta ma lascia respiro a testo e controlli', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')
  const iconButton = fs.readFileSync(path.join(__dirname, '../src/components/ui/icon-button.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')
  const controls = styles.slice(styles.indexOf('  controls: css({'), styles.indexOf('  streamStatus: css({'))

  assert.match(controls, /minH:\s*'11'/)
  assert.match(controls, /px:\s*'3\.5'/)
  assert.match(controls, /py:\s*'2'/)
  assert.match(controls, /bg:\s*'surfacePanel'/)
  assert.match(controls, /@media \(max-width: 800px\)/)
  assert.match(iconButton, /size = 'icon-sm'/)
  assert.match(recipes, /'icon-sm':\s*\{[^}]*h:\s*'7'[^}]*w:\s*'7'/)
  assert.doesNotMatch(styles, /button:not\(|\[data-slot="button"\]/)
})

test('il terminale libero offre ricerca xterm senza condividere la sessione Pi', () => {
  const shell = readTerminalSource()

  assert.match(shell, /@xterm\/addon-search/)
  assert.match(shell, /new SearchAddon\(\)/)
  assert.match(shell, /onSearch=/)
  assert.match(shell, /terminalStyles\.freeFind/)
})

test('i terminali non forzano lo scroll durante la lettura dello storico', () => {
  const app = readAppSource()
  const shell = readTerminalSource()

  assert.match(app, /shouldFollowTerminalOutput/)
  assert.match(shell, /shouldFollowTerminalOutput/)
  assert.match(app, /Nuovo output/)
  assert.match(shell, /Nuovo output/)
  assert.match(app, /readTerminalPreferences/)
  assert.match(app, /writeTerminalPreferences/)
  assert.match(shell, /readTerminalPreferences/)
  assert.match(shell, /writeTerminalPreferences/)
})

test('gli allegati sono esclusivi di Pi e non inviano Invio', () => {
  const app = readAppSource()
  const attachments = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/terminal-attachments.tsx'), 'utf8')
  const shell = readTerminalSource()

  assert.match(app, /<TerminalAttachments/)
  assert.match(attachments, /prepareDroppedAttachments/)
  assert.match(attachments, /attachment\.absolutePath/)
  assert.doesNotMatch(attachments, /\\r/)
  assert.doesNotMatch(shell, /TerminalAttachments/)
})

test('il Terminale AI parte a 11 px e le viste terminale ricevono lo stato di attivazione', () => {
  const app = readAppSource()
  const freeTerminal = readTerminalSource()
  const terminalWorkspace = fs.readFileSync(path.join(__dirname, '../src/features/terminal/components/terminal-workspace.tsx'), 'utf8')

  assert.match(app, /const \[fontSize, setFontSize\] = useState\(11\)/)
  assert.match(app, /<TerminalWorkspace\b[^>]*active=\{appSection === 'terminal'\}[^>]*workspace=\{workspace\}/)
  assert.match(terminalWorkspace, /active=\{active && tab === 'shell' && activeSessionId === session\.sessionId\}/)
  assert.match(terminalWorkspace, /sessionId=\{session\.sessionId\}/)
  assert.match(freeTerminal, /sessionId: string/)
  assert.match(freeTerminal, /export function FreeTerminal\(/)
  assert.match(freeTerminal, /scheduleVisibleTerminalRefit/)
})

test('il terminale AI viene rifatto al ritorno nella tab e non eccede orizzontalmente', () => {
  const app = readAppSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(app, /appSection !== 'ai' \|\| aiTab !== 'terminal'/)
  assert.match(app, /fitAddon\.current\?\.fit\(\)/)
  assert.match(app, /const xterm = getTerminal\(\)[\s\S]{0,180}appBridge\.terminal\.resize\(\{ cols: xterm\.cols, rows: xterm\.rows \}\)/)
  assert.match(styles, /workspace:\s*css\(\{[\s\S]*?minW:\s*'0'/)
  assert.match(styles, /surface:\s*css\(\{[\s\S]*?minW:\s*'0'/)
})

test('la Home usa una transizione breve solo per risultati ed empty state', () => {
  const app = readAppSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/home.ts'), 'utf8')

  assert.match(app, /<section className=\{homeStyles\.root\}[^>]*>\s*<div className=\{homeStyles\.content\}>/)
  assert.match(app, /className=\{view === 'grid' \? homeStyles\.grid : homeStyles\.list\}/)
  assert.match(app, /className=\{homeStyles\.card\(\{ layout: view \}\)\}/)
  assert.match(app, /<WorkbenchPresence[\s\S]*?className=\{homeStyles\.results\}[\s\S]*?presenceKey=\{filteredRecents\.length > 0 \? `recents-\$\{view\}` : search \? 'search-empty' : 'empty'\}/)
  assert.match(app, /<WorkbenchPresence[\s\S]*?\{filteredRecents\.length > 0 \? \([\s\S]*?homeStyles\.card\(\{ layout: view \}\)[\s\S]*?<\/WorkbenchPresence>/)
  assert.doesNotMatch(app, /workspace-home-\$\{view\}|MotionPresence/)
  assert.match(styles, /content:\s*css\(\{[\s\S]*?flex:\s*'1'[\s\S]*?minH:\s*'0'[\s\S]*?minW:\s*'0'/)
  assert.match(styles, /toolbar:\s*css\(\{[\s\S]*?bg:\s*'surfaceRaised'[\s\S]*?borderBottomColor:\s*'borderDefault'/)
  assert.match(styles, /card:\s*cva\(\{[\s\S]*?bg:\s*'transparent'[\s\S]*?_hover:\s*\{ bg:\s*'surfaceHover'/)
  assert.doesNotMatch(styles, /workspace-home-motion/)
})

test('il Terminale AI misura xterm dentro un host flessibile senza tagliare l ultima riga', () => {
  const app = readAppSource()
  const aiStyles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/ai.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')
  const bridge = fs.readFileSync(path.join(__dirname, '../src/styles/views/terminal.css'), 'utf8')

  assert.match(app, /className=\{terminalStyles\.xtermHost\} data-xterm-host="ai" key=\{workspace\}/)
  assert.match(aiStyles, /tabPanel:\s*css\(\{[\s\S]*?display:\s*'flex'[\s\S]*?flexDirection:\s*'column'/)
  assert.match(styles, /surface:\s*css\(\{[\s\S]*?display:\s*'flex'/)
  assert.match(styles, /xtermHost:\s*css\(\{[\s\S]*?flex:\s*'1'[\s\S]*?minH:\s*'0'/)
  assert.match(bridge, /\[data-xterm-host\] \.xterm\s*\{[^}]*flex:\s*1/)
})

test('il reload di Pi ripristina la geometria completa di xterm e non espone il viewport nero predefinito', () => {
  const app = readAppSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')
  const bridge = fs.readFileSync(path.join(__dirname, '../src/styles/views/terminal.css'), 'utf8')

  assert.match(app, /await appBridge\.pi\.reload\(\)[\s\S]*scheduleVisibleTerminalRefit/)
  assert.match(app, /window\.setTimeout\(refitAfterReload, 160\)/)
  assert.match(styles, /xtermHost:\s*css\(\{[\s\S]*?h:\s*'full'[\s\S]*?w:\s*'full'/)
  assert.match(bridge, /\[data-xterm-host\] \.xterm\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/)
  assert.match(bridge, /\[data-xterm-host\] \.xterm \.xterm-viewport\s*\{[^}]*background:\s*var\(--code-surface\)/)
  const layerClose = bridge.indexOf('\n}\n\n/* Il foglio distribuito da xterm')
  assert.ok(layerClose > 0)
  assert.ok(bridge.indexOf('[data-xterm-host] .xterm .xterm-viewport') > layerClose)
})

test('il terminale libero conserva margini laterali simmetrici', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(styles, /freePage:\s*css\(\{[\s\S]*?minW:\s*'0'/)
  assert.match(styles, /freePage:\s*css\(\{[\s\S]*?boxSizing:\s*'border-box'/)
})

test('il Terminale libero non espone una cornice chiara attorno al canvas', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')
  const surface = styles.slice(styles.indexOf('  freeSurface: css({'), styles.indexOf('  commandSplitter: css({'))

  assert.doesNotMatch(surface, /\bp:/)
  assert.match(surface, /bg:\s*'codeSurface'/)
})

test('il terminale libero apre una sidebar comandi senza ridimensionare il PTY', () => {
  const component = readTerminalSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(component, /aria-label="Apri comandi workspace"/)
  assert.match(component, /className=\{terminalStyles\.commandSidebar\}/)
  assert.match(component, /onConfirm: \(\) => void runCommand\(command\.id\)/)
  assert.match(component, /workspaceCommands\.run\(commandId\)/)
  assert.match(component, /ConfirmationDialog/)
  assert.match(component, /<Splitter\.Root[^>]*className=\{terminalStyles\.commandSplitter\}[^>]*fixedPanel="end"/)
  assert.match(component, /hidden=\{!state\.commandsOpen\}/)
  assert.match(component, /<Splitter\.Panel id="workspace-commands"><Dialog\.Content asChild unstyled><aside/)
  assert.match(styles, /commandSplitter:\s*css\(\{[\s\S]*?pointerEvents:\s*'none'/)
  assert.match(component, /requestAnimationFrame\(\(\) => commandsTrigger\.current\?\.focus\(\)\)/)
  assert.match(styles, /commandSplitter:\s*css\(\{[\s\S]*?position:\s*'absolute'/)
  assert.match(styles, /commandSplitter:\s*css\(\{[\s\S]*?insetInline:\s*'12px'/)
  assert.match(styles, /'--splitter-height':\s*'auto'/)
  assert.match(styles, /'--splitter-width':\s*'auto'/)
  assert.doesNotMatch(styles, /:has\(/)
})

test('i comandi workspace usano primitive Field Select Collapsible e IconButton senza fallback HTML', () => {
  const component = readTerminalSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  for (const primitive of ['Field', 'SelectField', 'Collapsible', 'IconButton']) assert.match(component, new RegExp(`<${primitive}`))
  assert.match(component, /<IconButton tooltip="Chiudi comandi workspace"/)
  assert.match(component, /<IconButton tooltip=\{`Modifica \$\{command\.title\}`\}/)
  assert.doesNotMatch(styles, /button:not\(|\.workspace-command-sidebar\s+(?:input|select|textarea)|\.workspace-command-list article select|\.workspace-category-edit input|\.workspace-command-sidebar header > div > \[data-slot="button"\]/)
})

test('la sidebar invoca le azioni di salvataggio al click', () => {
  const component = readTerminalSource()

  assert.match(component, /onClick=\{\(\) => void actions\.createCategory\(\)\}/)
  assert.match(component, /onClick=\{\(\) => void actions\.saveCommand\(\)\}/)
  assert.match(component, /onClick=\{\(\) => void actions\.saveCategory\(\)\}/)
})

test('la libreria comandi mostra categorie collassabili e feedback di caricamento', () => {
  const component = readTerminalSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(component, /workspaceCommandLibraryView\(categories, commandSearch\)/)
  assert.match(component, /const \[expandedCategoryIds, setExpandedCategoryIds\] = useState<Set<string>>/)
  assert.match(component, /<Collapsible\.Root asChild key=\{category\.id\} open=\{categoryExpanded\} onOpenChange=/)
  assert.match(component, /<Collapsible\.Trigger className=\{terminalStyles\.categoryToggle\}>/)
  assert.match(component, /<Collapsible\.Content>\{commands\.map/)
  assert.match(component, /className=\{terminalStyles\.categoryToggle\}/)
  assert.doesNotMatch(component, /aria-expanded=\{categoryExpanded\}|\{categoryExpanded && commands\.map/)
  assert.match(component, /commandsLoading && <div className=\{terminalStyles\.commandFeedback\} role="status"/)
  assert.match(component, /const \[commandsLoadError, setCommandsLoadError\] = useState<UserError \| null>\(null\)/)
  assert.match(component, /commandsLoadError && <ErrorNotice/)
  assert.match(component, /action=\{\{ label: 'Riprova', onClick:[\s\S]*?loadCommands\(\)/)
  assert.match(styles, /categoryToggle:\s*css\(\{[^}]*flex:\s*'1'/)
  assert.match(component, /<Collapsible\.Indicator><ChevronRight[^>]*aria-hidden="true"/)
  assert.doesNotMatch(styles, /categoryChevronOpen/)
})

test('Impostazioni e Home usano una navigazione orizzontale senza sidebar locale', () => {
  const settings = readSettingsSource()
  const app = readAppSource()
  assert.match(settings, /aria-label="Sezioni Impostazioni"/)
  for (const tab of ['Generali', 'Runtime Pi', 'Pacchetti Pi', 'Skill Pi']) assert.match(settings, new RegExp(`>${tab}<`))
  assert.match(settings, /settingsBridge\.piSystem\.listSkills\(\)/)
  assert.match(settings, />Manuali</)
  assert.match(settings, />Da pacchetti Pi</)
  assert.match(settings, /aria-label="Sorgente pacchetto Pi"/)
  assert.doesNotMatch(settings, /\.codex\/skills/)
  assert.doesNotMatch(settings, /<aside className="settings-context"/)
  assert.doesNotMatch(app, /<aside className="workspace-sidebar"/)
})

test('le tab Impostazioni usano tutta la larghezza disponibile', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/settings.ts'), 'utf8')
  const layout = fs.readFileSync(path.join(__dirname, '../src/theme/styles/shell.ts'), 'utf8')
  assert.match(styles, /panel:\s*css\(\{[\s\S]*?w:\s*'full'/)
  assert.match(styles, /page:\s*css\(\{[\s\S]*?px:\s*'5'[\s\S]*?pb:\s*'7'[\s\S]*?pt:\s*'4'/)
  assert.match(styles, /page:\s*css\(\{[\s\S]*?maxW:\s*'none'[\s\S]*?w:\s*'full'/)
  assert.match(styles, /tabs:\s*css\(\{[\s\S]*?position:\s*'sticky'[\s\S]*?top:\s*'0'[\s\S]*?w:\s*'full'/)
  assert.match(styles, /panel:\s*css\(\{[\s\S]*?maxW:\s*'none'[\s\S]*?w:\s*'full'/)
  assert.doesNotMatch(styles, /840px/)
  assert.match(layout, /standalonePage:\s*css\(\{[\s\S]*?maxW:\s*'none'[\s\S]*?minW:\s*'0'[\s\S]*?w:\s*'full'/)
})

test('Database offre tutti i driver, CRUD e paginazione nel layout dell’app', () => {
  const component = readDatabaseSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')

  assert.match(component, /databaseStyles as db/)
  assert.match(component, /<Splitter\.Root asChild[^>]*storageKey=\{`vincodelab\.database\.sidebar-width:\$\{workspace\}`\}/)
  assert.match(component, /className=\{db\.workspace\}/)
  assert.match(component, /schema: sqlSchema/)
  assert.match(component, /<SelectField[\s\S]*?label="Driver database"/)
  assert.match(component, /value=\{draft\.driver\}/)
  for (const [driver, label] of [['sqlite', 'SQLite'], ['postgres', 'PostgreSQL'], ['mysql', 'MySQL'], ['mssql', 'SQL Server']]) {
    assert.match(component, new RegExp(`value: '${driver}', label: '${label}'`))
  }
  assert.match(component, /updateConnection/)
  assert.match(component, /deleteConnection/)
  assert.match(component, /deleteSavedQuery/)
  assert.match(component, /Carica altre righe/)
  assert.match(component, /ConfirmationDialog/)
  assert.match(styles, /workspace:\s*css\(\{[\s\S]*?minW:\s*'0'/)
  assert.match(styles, /const compactLayout = '@media \(max-width: 800px\)'/)
  assert.match(styles, /\[compactLayout\]:\s*\{[\s\S]*?gridTemplateColumns:\s*'minmax\(0, 1fr\)'/)
})

test('Database usa un explorer con tab, albero schema e modifica della connessione in modal', () => {
  const component = readDatabaseSource()
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/ui/dialog.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')

  assert.match(component, /const \[connectionModalOpen, setConnectionModalOpen\] = useState\(false\)/)
  assert.match(component, /Nuova connessione/)
  assert.match(component, /<Dialog\.Root[\s\S]*?finalFocusEl=\{\(\) => openerRef\.current\}[\s\S]*?initialFocusEl=\{\(\) => nameInputRef\.current\}[\s\S]*?open=\{open\}[\s\S]*?unmountOnExit/)
  assert.doesNotMatch(component, /\{connectionModalOpen && <Dialog\.Root/)
  assert.match(component, /<Dialog\.Backdrop \/>[\s\S]*?<Dialog\.Positioner>[\s\S]*?<Dialog\.Content className=\{db\.dialogContent\}/)
  assert.match(component, /<Dialog\.Title className=\{db\.dialogTitle\}>/)
  assert.match(component, /<Dialog\.CloseTrigger asChild><IconButton tooltip="Chiudi connessione">/)
  assert.match(dialog, /@ark-ui\/react\/dialog/)
  assert.match(dialog, /createStyleContext\(dialog\)/)
  assert.doesNotMatch(component, /aria-modal="true"|role="dialog"|database-connection-modal-backdrop/)
  assert.match(component, /<Tabs\.List aria-label="Esplora database" className=\{db\.explorerTabs\}/)
  assert.match(component, /<TreeView\.Tree className=\{db\.schemaTree\}>/)
  assert.match(component, /<footer className=\{db\.connectionSwitcher\}>/)
  assert.match(styles, /sidebar:\s*css\(\{[\s\S]*?gridTemplateRows:\s*'auto minmax\(0, 1fr\) auto'/)
  assert.match(styles, /schemaTree:\s*css\(\{[^}]*overflow:\s*'auto'/)
  assert.match(styles, /explorerList:\s*css\(\{[\s\S]*?overflow:\s*'auto'/)
  assert.match(styles, /dialogContent:\s*css\(\{[\s\S]*?maxH:\s*'calc\(100vh - 40px\)'/)
  assert.doesNotMatch(component, /className="database-/)
})

test('Database mantiene compatta la connessione e il pannello comandi mostra il form solo su richiesta', () => {
  const databaseStyles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')
  const terminal = readTerminalSource()
  const terminalStyles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/terminal.ts'), 'utf8')

  assert.match(databaseStyles, /sidebar:\s*css\(\{[\s\S]*?gridTemplateRows:\s*'auto minmax\(0, 1fr\) auto'/)
  assert.match(databaseStyles, /explorerTabs:\s*css\(\{[\s\S]*?minH:\s*'10'/)
  assert.match(databaseStyles, /schemaTree:\s*css\(\{[^}]*overflow:\s*'auto'/)
  assert.match(databaseStyles, /explorerList:\s*css\(\{[\s\S]*?overflow:\s*'auto'/)
  assert.match(terminal, /const \[commandFormOpen, setCommandFormOpen\] = useState\(false\)/)
  assert.match(terminal, /Nuovo comando/)
  assert.match(terminal, /\{state\.commandFormOpen && <div className=\{terminalStyles\.commandForm\}/)
  assert.match(terminalStyles, /commandForm:\s*css\(\{[\s\S]*?display:\s*'grid'/)
  assert.match(terminalStyles, /commandFormTop:\s*css\(\{[\s\S]*?gridTemplateColumns:\s*'repeat\(2, minmax\(0, 1fr\)\)'/)
  assert.match(terminalStyles, /commandSidebar:\s*css\(\{[\s\S]*?display:\s*'flex'[\s\S]*?flexDirection:\s*'column'/)
})

test('Database distingue procedure e funzioni dalle tabelle nell explorer', () => {
  const component = readDatabaseSource()

  assert.match(component, /schema\.routines/)
  assert.match(component, /Array\.isArray\(schema\.routines\) \? schema\.routines : \[\]/)
  assert.match(component, /Procedure archiviate/)
  assert.match(component, /Funzioni/)
})

test('Database apre una griglia dati ricercabile e salva solo nella transazione', () => {
  const component = readDatabaseSource()
  const grid = fs.readFileSync(path.join(__dirname, '../src/features/database/components/database-table-grid.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')

  assert.match(component, /database\s*\.\s*tableRows/)
  assert.match(component, /database\s*\.\s*updateTableRows/)
  assert.match(component, /<DatabaseTableGrid/)
  assert.match(component, /Cerca nello schema/)
  assert.match(grid, /Modalità modifica attiva/)
  assert.match(grid, /Imposta NULL/)
  assert.match(grid, /<Editable\.Root activationMode="focus"/)
  assert.match(grid, /onValueChange=\{\(\{ value: nextValue \}\) => changeCell\(row, column, nextValue\)\}/)
  assert.match(grid, /onValueRevert=\{\(\) => changeCell\(row, column, row\[column\.name\]\)\}/)
  assert.match(grid, /submitMode="both"/)
  assert.match(grid, /<Editable\.Area><Editable\.Input[^>]*\/><Editable\.Preview/)
  assert.doesNotMatch(grid, /event\.key === ["']Escape["']|onDoubleClick=/)
  assert.match(grid, /className=\{db\.grid\}/)
  assert.match(grid, /className=\{db\.gridRow\(\{ changed: Object\.keys\(rowDraft\)\.length > 0 \}\)\}/)
  assert.match(grid, /className=\{db\.gridCell\(\{ changed: isChanged \}\)\}/)
  assert.match(styles, /grid:\s*css\(\{[\s\S]*?gridTemplateRows:\s*'auto auto minmax\(0, 1fr\) auto'/)
  assert.match(styles, /gridRow:\s*cva\(\{[\s\S]*?changed:\s*\{\s*true:\s*\{\s*boxShadow:/)
  assert.match(styles, /gridCell:\s*cva\(\{[\s\S]*?changed:\s*\{\s*true:\s*\{\s*bg:\s*'stateWarningSoft'/)
})

test('Database separa SQL e dati in sotto-tab locali e apre i dati dopo una query riuscita', () => {
  const workspace = readDatabaseModule('components/database-workspace.tsx')
  const query = readDatabaseModule('hooks/use-database-query.ts')
  const results = readDatabaseModule('components/database-results-panel.tsx')
  const grid = fs.readFileSync(path.join(__dirname, '../src/features/database/components/database-table-grid.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')

  assert.match(workspace, /<Tabs\.List[^>]*aria-label="Viste Database"/)
  assert.match(workspace, /<Tabs\.Trigger value="sql">SQL<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Trigger value="data">Dati<\/Tabs\.Trigger>/)
  assert.match(workspace, /<Tabs\.Indicator\s*\/>/)
  assert.match(workspace, /<Tabs\.Content value="sql"[^>]*>[\s\S]*?aria-label="Editor SQL"/)
  assert.match(results, /<Tabs\.Content value="data"[^>]*>[\s\S]*?<DatabaseTableGrid/)
  assert.doesNotMatch(workspace, /role="(?:tablist|tab)"|aria-controls="database-(?:sql|data)-panel"/)
  assert.match(query, /async function execute[\s\S]*?setDatabaseView\('sql'\)[\s\S]*?await databaseBridge\.database\.execute[\s\S]*?setSelectedTableName\(null\)[\s\S]*?setDatabaseView\('data'\)/)
  assert.match(query, /const pendingResultsFocus = useRef\(false\)/)
  assert.match(query, /pendingResultsFocus\.current = true[\s\S]*?setDatabaseView\('data'\)/)
  assert.match(query, /databaseView !== 'data'[\s\S]*?resultsRegion\.current[\s\S]*?region\.focus\(\)[\s\S]*?document\.activeElement === region/)
  assert.match(workspace, /function openSql[\s\S]*?executionGate\.invalidate\(\)[\s\S]*?setDatabaseView\('sql'\)/)
  assert.match(workspace, /function openTable[\s\S]*?executionGate\.invalidate\(\)/)
  assert.match(query, /catch \(error\) \{\s*if \(!isExecutionRequestCurrent\(request\) \|\| getSelectedConnectionId\(\) !== connectionId\) return/)
  assert.match(query, /setQueryError\(reportDatabaseFailure\(error, 'execute-query', 'Query non eseguita'/)
  assert.match(workspace, /query\.queryError && <ErrorNotice action=/)
  assert.doesNotMatch(query, /toast\.error\('Query non eseguita\.'/)
  assert.doesNotMatch(workspace, /database-splitter/)
  assert.match(styles, /viewTabs:\s*css\(\{[\s\S]*?borderBottomColor:\s*'borderDefault'/)
  assert.match(styles, /viewPanel:\s*css\(\{[\s\S]*?overflow:\s*'hidden'/)
  assert.match(styles, /resultsEmpty:\s*css\(\{[^}]*alignItems:\s*'center'[^}]*display:\s*'grid'/)
  assert.match(styles, /resultsEmpty:\s*css\(\{[^}]*h:\s*'full'[^}]*justifyItems:\s*'center'/)
  assert.doesNotMatch(styles, /database-splitter/)
  assert.match(grid, /<Editable\.Root activationMode="focus"/)
  assert.match(grid, /db\.gridRow\(\{ changed:/)
  assert.match(grid, /Modifiche da salvare/)
})

test('il workbench Modifiche GitHub riempie la vista e dimensiona correttamente il commit', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(styles, /changesContent:\s*css\(\{[\s\S]*?flex:\s*'1'[\s\S]*?gridTemplateRows:\s*'auto minmax\(0, 1fr\)'[\s\S]*?overflow:\s*'hidden'/)
  assert.match(styles, /changesWorkbench:\s*css\(\{[\s\S]*?h:\s*'full'[\s\S]*?minH:\s*'0'[\s\S]*?overflow:\s*'hidden'/)
  assert.match(styles, /commitForm:\s*css\(\{[\s\S]*?alignSelf:\s*'stretch'[\s\S]*?w:\s*'full'/)
  assert.doesNotMatch(styles, /commitForm:\s*css\(\{[^}]*alignSelf:\s*'start'/)
})

test('Modifiche GitHub usa un workbench master detail senza cronologia duplicata', () => {
  const github = readGitHubSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(github, /className=\{gh\.changesWorkbench\}/)
  assert.match(github, /className=\{gh\.changeSidebar\}/)
  assert.match(github, /className=\{gh\.diffWorkspace\}/)
  assert.match(github, /<Collapsible\.Root className=\{gh\.changeGroup\} defaultOpen>/)
  assert.match(github, /<Collapsible\.Trigger className=\{gh\.changeGroupTrigger\}>/)
  assert.match(github, /<Collapsible\.Content>/)
  assert.doesNotMatch(github, /<details\b|<summary\b/)
  assert.doesNotMatch(github, /github-history/)
  assert.match(styles, /changesWorkbench:\s*css\(\{[\s\S]*?gridTemplateColumns:/)
  assert.match(styles, /changesWorkbench:\s*css\(\{[\s\S]*?\[mobileWorkbench\]:\s*\{\s*gridTemplateColumns:\s*'1fr'/)
})

test('Issue GitHub usa ricerca numerica e compositore modale', () => {
  const github = readGitHubSource()
  const issuesModel = fs.readFileSync(path.join(__dirname, '../src/features/github/model/github-issues.ts'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(issuesModel, /function matchesIssueSearch\(issue: GitHubIssue, query: string\)/)
  assert.match(issuesModel, /normalized\.match\(\/\^#\?\(\\d\+\)\$\/\)/)
  assert.match(issuesModel, /issue\.number === Number\(numeric\)/)
  assert.match(github, /const \[issueComposerOpen, setIssueComposerOpen\] = useState\(false\)/)
  assert.match(github, /className=\{cx\(gh\.modalContent, gh\.issueModal\)\}/)
  assert.match(github, />Nuova issue<\/Button>/)
  assert.match(github, /placeholder="Cerca per numero, titolo o etichetta"/)
  assert.match(styles, /issuesContent:\s*css\(\{[^}]*gridTemplateColumns:\s*'minmax\(0, 1fr\)'/)
  assert.match(styles, /content:\s*css\(\{[\s\S]*?flex:\s*'1'[\s\S]*?overflow:\s*'auto'/)
  assert.match(styles, /issuesContent:\s*css\(\{[^}]*gridTemplateRows:\s*'minmax\(0, 1fr\)'/)
  assert.match(styles, /issueList:\s*css\(\{[^}]*display:\s*'flex'[^}]*flex:\s*'1'[^}]*flexDirection:\s*'column'[^}]*overflow:\s*'auto'/)
  assert.match(styles, /issueEmpty:\s*css\(\{[^}]*h:\s*'full'/)
  assert.match(github, /<section className=\{gh\.issueListPanel\}>/)
})

test('la schermata di recupero può ritentare la vista senza ricaricare l’intera app', () => {
  const boundary = fs.readFileSync(path.join(__dirname, '../src/components/app-error-boundary.tsx'), 'utf8')
  assert.match(boundary, /this\.setState\(\{ error: null \}\)/)
  assert.match(boundary, /action=\{\{ label: 'Riprova', onClick: this\.retry \}\}/)
  assert.match(boundary, /secondaryAction=\{\{ label: 'Ricarica app'/)
})

test('un errore di sezione mantiene disponibile la toolbar principale', () => {
  const app = readAppSource()
  const boundary = fs.readFileSync(path.join(__dirname, '../src/components/view-error-boundary.tsx'), 'utf8')

  const toolbar = app.indexOf('shellStyles.toolbar')
  const workspace = app.indexOf('shellStyles.sectionStack')
  assert.ok(toolbar >= 0 && workspace > toolbar, 'la toolbar deve vivere fuori dalle viste recuperabili')
  assert.match(app, /<header className=\{[^>]*shellStyles\.toolbar[^>]*\}>/)
  assert.match(app, /<div className=\{shellStyles\.sectionStack\}>/)
  for (const view of ['Editor', 'Terminale', 'GitHub', 'Database']) {
    assert.match(app, new RegExp(`<ViewErrorBoundary viewName="${view}"`))
  }
  assert.match(boundary, /className=\{errorBoundaryStyles\.view\}/)
  assert.match(boundary, /Le altre sezioni restano operative|lavoro nelle altre sezioni è rimasto disponibile/u)
  assert.match(boundary, /this\.setState\(\{ error: null \}\)/)
  assert.doesNotMatch(boundary, /window\.location\.reload/)
})

test('l’editor Skill ignora una risposta IPC superata da una selezione più recente', () => {
  const skills = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-skills.tsx'), 'utf8')

  assert.match(skills, /const selectionRequestId = useRef\(0\)/)
  assert.match(skills, /const requestId = \+\+selectionRequestId\.current/)
  assert.match(skills, /if \(requestId !== selectionRequestId\.current\) return/)
})

test('la configurazione Pi viene chiusa quando si lascia la relativa tab', () => {
  const settings = readSettingsSource()

  assert.match(settings, /const closeConfig = useCallback\(async \(\) =>/)
  assert.match(settings, /await settingsBridge\.piConfig\.close\(\)/)
  assert.match(settings, /if \(next !== 'runtime'\) void closeConfig\(\)/)
})

test('la configurazione Pi viene chiusa anche quando Impostazioni resta montata ma nascosta', () => {
  const app = readAppSource()
  const settings = readSettingsSource()

  assert.match(app, /<AppSettings active=\{appSection === 'settings'\}/)
  assert.match(settings, /if \(!active\) void closeConfig\(\)/)
  assert.match(settings, /configStartGeneration\.current \+= 1/)
  assert.match(settings, /if \(configOpenRef\.current\)[\s\S]*?piConfig\.close\(\)/)
})

test('la board Project ignora un caricamento superato da una selezione più recente', () => {
  const coordinator = readGitHubModule('hooks/use-request-coordinator.ts')
  const projectActions = readGitHubModule('hooks/use-github-project-actions.ts')
  assert.match(coordinator, /const sequence = useRef\(0\)/)
  assert.match(projectActions, /const requestId = boardRequests\.begin\(\)/)
  assert.match(projectActions, /if \(!boardRequests\.isCurrent\(requestId\)\) return/)
  assert.match(projectActions, /if \(getSelectedProject\(\) !== projectNumber\) return/)
})

test('le Impostazioni non smontano le sezioni persistenti del workspace', () => {
  const app = readAppSource()

  assert.match(app, /workspace \? <WorkspaceViews controller=\{controller\} \/> : <StandaloneViews controller=\{controller\} \/>/)
  assert.match(app, /shouldMountPersistentView\(loadedSections, 'settings', appSection === 'settings'\) && \(\s*<Tabs\.Content asChild[^>]*key="settings"[^>]*value="settings">/)
  assert.match(app, /<AppSettings active=\{appSection === 'settings'\} appearance=\{appearance\} openRuntimeRequest=\{settingsRuntimeRequest\} onAppearanceChange=\{changeAppearance\} onWorkspaceGuardChange=\{handleSettingsWorkspaceGuardChange\} \/>/)
  for (const section of ['editor', 'terminal', 'github', 'database']) {
    assert.match(app, new RegExp(`\\{\\(loadedSections\\.${section} \\|\\| appSection === '${section}'\\) && \\(\\s*<Tabs\\.Content asChild[^>]*key="${section}"[^>]*value="${section}">`))
  }
  assert.doesNotMatch(app, /\{appSection === 'settings' \? <section[^]*?\) : workspace \? \(/)
})

test('il grafo Git sfrutta tutta la larghezza della sezione GitHub', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')

  assert.match(styles, /graphPanel:\s*css\(\{[^}]*gridColumn:\s*'1 \/ -1'[^}]*w:\s*'full'/)
})

test('il grafo Git mantiene continui i rami e differenzia le corsie', () => {
  const component = readGitHubSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/github.ts'), 'utf8')
  const pathStyles = styles.slice(styles.indexOf('export const gitGraphPathStyles'), styles.indexOf('export const gitGraphNodeStyles'))
  const nodeStyles = styles.slice(styles.indexOf('export const gitGraphNodeStyles'), styles.indexOf('export const githubMarkdownStyles'))

  assert.match(component, /function gitGraphPathClass\(lane: number\)/)
  assert.match(component, /function gitGraphNodeClass\(lane: number\)/)
  assert.match(component, /const GIT_GRAPH_LANE_COUNT = 6/)
  assert.match(component, /className=\{gitGraphPathClass\(link\.from\)\}/)
  assert.match(component, /className=\{gitGraphNodeClass\(row\.lane\)\}/)
  assert.match(component, /const GIT_GRAPH_ROW_HEIGHT = 40/)
  assert.match(component, /height=\{GIT_GRAPH_ROW_HEIGHT\}/)
  assert.match(component, /L\$\{10 \+ link\.to \* 16\} \$\{GIT_GRAPH_ROW_HEIGHT\}/)
  assert.match(styles, /graphRow:\s*css\(\{[^}]*h:\s*'10'/)
  assert.doesNotMatch(styles, /graphRow:\s*css\(\{[^}]*borderTop/)
  assert.doesNotMatch(styles, /graphList:\s*css\(\{[^}]*borderTop/)
  assert.equal((pathStyles.match(/css\(\{/g) ?? []).length, 6)
  assert.equal((nodeStyles.match(/css\(\{/g) ?? []).length, 6)
  for (const token of ['accentSolid', 'stateSuccess', 'stateWarning', 'syntaxProperty', 'syntaxType', 'stateError']) {
    assert.match(pathStyles, new RegExp(`stroke: '${token}'`))
    assert.match(nodeStyles, new RegExp(`fill: '${token}'`))
  }
})

test('Database ignora il risultato di una query conclusa dopo il cambio connessione', () => {
  const connections = readDatabaseModule('hooks/use-database-connections.ts')
  const gate = readDatabaseModule('hooks/use-database-execution-gate.ts')
  const query = readDatabaseModule('hooks/use-database-query.ts')

  assert.match(gate, /const revision = useRef\(0\)/)
  assert.match(connections, /const selectedConnectionId = useRef<string \| null>\(null\)/)
  assert.match(gate, /const invalidate = useCallback\(\(\) => \{ revision\.current \+= 1 \}/)
  assert.match(query, /const request = beginExecutionRequest\(\)/)
  assert.match(query, /if \(!isExecutionRequestCurrent\(request\) \|\| getSelectedConnectionId\(\) !== connectionId\) return/)
})

test('Database mostra un recupero inline se non riesce a leggere le connessioni', () => {
  const component = readDatabaseSource()

  assert.match(component, /const \[connectionError, setConnectionError\] = useState<UserError \| null>\(null\)/)
  assert.match(component, /connectionError[\s\S]{0,120}\? <ErrorNotice/)
  assert.match(component, /action=\{\{ label: 'Riprova', onClick: onReloadConnections \}\}/)
})

test('Database resta passivo all’ingresso e comunica la connessione esplicita', () => {
  const component = readDatabaseSource()
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/database.ts'), 'utf8')

  assert.match(component, /const \[loadingResources, setLoadingResources\] = useState\(false\)/)
  assert.match(component, /const connect = useCallback/)
  assert.match(component, /databaseBridge\.database\.inspectSchema\(connectionId/)
  assert.match(component, /setLoadingResources\(true\)/)
  assert.match(component, /className=\{db\.loadingOverlay\}/)
  assert.match(component, /Connessione al database/)
  assert.match(component, /Nessun database viene aperto automaticamente/)
  assert.match(component, /role="status"/)
  assert.match(styles, /loadingOverlay:\s*css\(\{[\s\S]*?position:\s*'absolute'/)
})

test('Database mostra avanzamento e conferma per Schema e Inizia', () => {
  const component = readDatabaseSource()

  assert.match(component, /const \[toolbarAction, setToolbarAction\]\s*=\s*useState<DatabaseToolbarAction>\(null\)/)
  assert.match(component, /toolbarAction === ["']schema["']\s*\? ["']Aggiornamento…["']\s*: ["']Schema["']/)
  assert.match(component, /toolbarAction === ["']begin["']\s*\? ["']Avvio…["']\s*: ["']Inizia["']/)
  assert.match(component, /toast\.success\(['"]Schema aggiornato\./)
  assert.match(component, /toast\.success\(["']Transazione avviata\.["']/)
  assert.match(component, /aria-live="polite" className=\{db\.toolbarStatus\}/)
})

test('Database consente di pulire la cronologia della connessione attiva', () => {
  const component = readDatabaseSource()

  assert.match(component, /aria-label="Pulisci cronologia query"/)
  assert.match(component, /database\s*\.\s*clearHistory\(connectionId\)/)
  assert.match(component, /setHistory\(\[\]\)/)
  assert.match(component, /Pulisci cronologia/)
})

test('Skill progetto distingue il caricamento fallito da un elenco vuoto', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-skills.tsx'), 'utf8')

  assert.match(component, /const \[loadError, setLoadError\] = useState<UserError \| null>\(null\)/)
  assert.match(component, /loadError \? <div className=\{aiStyles\.skillsList\}><ErrorNotice/)
  assert.match(component, /action=\{\{ label: 'Riprova', onClick: loadSkills \}\}/)
})

test('Istruzioni progetto non consente modifiche prima della lettura iniziale e offre retry', () => {
  const component = fs.readFileSync(path.join(__dirname, '../src/features/ai/components/project-instructions.tsx'), 'utf8')

  assert.match(component, /const \[loadError, setLoadError\] = useState<UserError \| null>\(null\)/)
  assert.match(component, /disabled=\{loading \|\| Boolean\(loadError\)\}/)
  assert.match(component, /loadError && <ErrorNotice error=\{loadError\}/)
  assert.match(component, /action=\{\{ label: 'Riprova', onClick: loadInstructions \}\}/)
})

test('GitHub non confonde il caricamento remoto con un workspace non configurato', () => {
  const github = readGitHubModule('components/github-feedback.tsx')
  assert.match(github, /function GitHubDataState/)
  assert.match(github, /Caricamento dati GitHub…/)
  assert.match(github, /Riprova caricamento GitHub/)
})

test('il modal attività GitHub trattiene e ripristina il focus da tastiera', () => {
  const github = readGitHubModule('components/github-project-item-dialog.tsx')
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/ui/dialog.tsx'), 'utf8')
  assert.match(dialog, /Root:\s*withRootProvider\(ArkDialog\.Root\)/)
  assert.match(dialog, /Content:\s*withContext\(ArkDialog\.Content, 'content'\)/)
  assert.match(github, /if \(!item\) return null[\s\S]*?return <Dialog\.Root[^\n]*open=\{state\.boardItemDialogOpen\}[^\n]*onOpenChange=/)
  assert.match(github, /<Dialog\.Content className=\{cx\(gh\.modalContent, gh\.itemModal\)\}>/)
  assert.match(github, /<Dialog\.CloseTrigger asChild>/)
  assert.doesNotMatch(github, /boardItemModal|previousBoardItemFocus|event\.key !== 'Tab'/)
})
