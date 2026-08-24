const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('l’editor espone comandi chiari per esplorare e controllare i file aperti', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/editor.ts'), 'utf8')
  const bridge = fs.readFileSync(path.join(__dirname, '../src/styles/views/editor.css'), 'utf8')

  assert.match(editor, /aria-label="Aggiorna explorer"/)
  assert.match(editor, /aria-label="Comprimi cartelle"/)
  assert.match(editor, /<IconButton tooltip="Aggiorna explorer"/)
  assert.match(editor, /<IconButton tooltip="Comprimi cartelle"/)
  assert.match(editor, /editorStyles\.fileBreadcrumb/)
  assert.match(editor, /editorStyles\.languageBadge/)
  assert.match(editor, /editorStyles\.(?:savedStatus|saveStatus)/)
  assert.match(editor, /createPanel: createEditorSearchPanel/)
  assert.match(editor, /className = 'editor-search-panel'/)
  for (const folder of ['api', 'services', 'database', 'redis', 'websocket', 'config', 'security', 'logs', 'scripts', 'coverage', '.agents', '.worktrees']) assert.match(editor, new RegExp(folder.replace('.', '\\.')))
  assert.match(editor, /defaultFolderOpenedIcon : defaultFolderIcon/)
  assert.match(bridge, /\.editor-search-panel/)
  assert.match(styles, /explorerActions:\s*compactRow/)
  assert.match(styles, /fileBreadcrumb:\s*css\(\{[\s\S]*?fontFamily:\s*'mono'/)
  assert.match(styles, /languageBadge:\s*css\(statusBadge/)
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b|rgba?\(|!important/i)
})

test('l’explorer rende leggibile lo stato Git dei file senza confonderlo con le modifiche non salvate', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/theme/styles/editor.ts'), 'utf8')

  assert.match(editor, /editorBridge\.github\.gitStatus\(\{ force: true \}\)/)
  assert.match(editor, /gitStatusByPath/)
  assert.match(editor, /gitStatusByDirectory/)
  assert.match(editor, /gitFileStatusLabel/)
  assert.match(editor, /refreshGitStatus/)
  assert.match(editor, /aria-label=\{gitFileStatusLabel/)
  for (const [key, token] of [
    ['gitStatusAdded', 'stateSuccess'],
    ['gitStatusDeleted', 'stateError'],
    ['gitStatusRenamed', 'stateInfo'],
    ['gitStatusModified', 'stateWarning'],
  ]) {
    assert.match(editor, new RegExp(`editorStyles\\.${key}`))
    assert.match(styles, new RegExp(`${key}:\\s*css\\(gitStatus, \\{ color:\\s*'${token}'`))
  }
  assert.match(styles, /const gitStatus = css\.raw\(\{[\s\S]*?fontFamily:\s*'mono'/)
  assert.match(editor, /editorStyles\.gitStatusModified/)
})

test('l’explorer è ridimensionabile senza compromettere la navigazione da tastiera', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const splitter = fs.readFileSync(path.join(__dirname, '../src/components/ui/splitter.tsx'), 'utf8')
  const recipes = fs.readFileSync(path.join(__dirname, '../src/theme/recipes.ts'), 'utf8')

  assert.match(editor, /<Splitter\.Root[^>]*storageKey=\{`vincodelab\.editor\.explorer-width:\$\{workspace\}`\}/)
  assert.match(editor, /<Splitter\.ResizeTrigger aria-label="Ridimensiona Explorer"/)
  assert.match(splitter, /ArkSplitter\.ResizeTrigger/)
  assert.match(recipes, /cursor:\s*'col-resize'/)
  assert.doesNotMatch(editor, /useResizablePanel|role="separator"|onPointerDown=/)
})

test('l’explorer delega gerarchia, espansione, selezione e tastiera al TreeView Ark', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')

  assert.match(editor, /createTreeCollection<EditorTreeNode>/)
  assert.match(editor, /<TreeView\.Root/)
  for (const attribute of [
    'collection={editorTreeCollection}',
    'expandedValue={editorExpandedValue}',
    'selectedValue={editorSelectedValue}',
    'selectionMode="single"',
  ]) assert.match(editor, new RegExp(attribute.replace(/[{}]/g, '\\$&')))
  assert.match(editor, /canRename=\{\(node\) => node\.kind === 'new-file' && !creatingFile\}/)
  assert.match(editor, /translations=\{\{ renameInputLabel: 'Nome del nuovo file', treeLabel: 'File del progetto' \}\}/)
  assert.match(editor, /typeahead onExpandedChange=/)
  assert.match(editor, /onSelectionChange=\{\(\{ selectedNodes \}\)/)
  for (const part of ['NodeProvider', 'Branch', 'BranchControl', 'BranchTrigger', 'BranchIndicator', 'BranchContent', 'Item', 'ItemText']) assert.match(editor, new RegExp(`TreeView\\.${part}`))
  assert.match(editor, /kind: 'new-file'/)
  assert.match(editor, /loadDirectory\(node\.id, node\.name\)/)
  assert.doesNotMatch(editor, /aria-expanded=|paddingLeft:|toggleDirectory|renderTree\(/)
})

test('l’editor usa estensioni CodeMirror per le anteprime di media e CSV', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')

  assert.match(editor, /WidgetType/)
  assert.match(editor, /Decoration\.replace/)
  assert.match(editor, /mediaPreviewExtension/)
  assert.match(editor, /editorBridge\.files\.preview/)
  assert.match(editor, /previewLabelFor/)
  assert.doesNotMatch(editor, /!selectedTab \|\| selectedTab\.preview\) return/)
})

test('l’editor CodeMirror visualizza i numeri di riga', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')

  assert.match(editor, /lineNumbers/)
  assert.match(editor, /lineNumbers\(\)/)
})

test('l’editor riconosce YAML, Shell, SQL e Python con i rispettivi linguaggi CodeMirror', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')

  for (const extension of ['yml', 'yaml', 'sh', 'bash', 'zsh', 'sql', 'py']) assert.match(editor, new RegExp(`'${extension}'`))
  for (const language of ['yaml()', 'sql()', 'python()', 'StreamLanguage.define(shell)']) assert.match(editor, new RegExp(language.replace(/[()]/g, '\\$&')))
})

test('l’editor rende Markdown in sicurezza tramite una widget extension CodeMirror', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const styles = fs.readFileSync(path.join(__dirname, '../src/styles/views/editor.css'), 'utf8')

  assert.match(editor, /renderMarkdownPreview/)
  assert.match(editor, /cm-markdown-preview/)
  assert.match(editor, /preview === 'markdown'/)
  assert.match(editor, /Mostra sorgente/)
  assert.match(styles, /\.cm-markdown-preview/)
})

test('l’editor usa Graphite e conserva stato e viewport per file in una sola EditorView', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const database = fs.readFileSync(path.join(__dirname, '../src/features/database/components/database-workspace.tsx'), 'utf8')
  const packageJson = fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
  const packageLock = fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8')

  assert.equal((editor.match(/new EditorView/g) ?? []).length, 1)
  assert.equal((database.match(/new EditorView/g) ?? []).length, 1)
  assert.match(editor, /graphiteCodeMirrorTheme/)
  assert.match(database, /graphiteCodeMirrorTheme/)
  assert.match(editor, /new Map<string, EditorState>/)
  assert.match(editor, /editorStateKey\(tab\)/)
  assert.match(editor, /view\.setState\(nextState\)/)
  assert.match(editor, /editorScrollPositions/)
  assert.match(editor, /view\.requestMeasure/)
  assert.match(editor, /foldGutter\(\)/)
  assert.match(editor, /editorHistory\(\)/)
  assert.match(editor, /documentMode\.reconfigure/)
  assert.match(editor, /className=\{cx\('codemirror-host', editorStyles\.codeMirrorHost\)\} hidden=/)
  assert.match(database, /sqlLanguageCompartment\.current\.reconfigure/)
  assert.doesNotMatch(`${editor}\n${database}\n${packageJson}\n${packageLock}`, /@codemirror\/theme-one-dark|\boneDark\b/)
})
