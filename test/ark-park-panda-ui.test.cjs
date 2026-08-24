const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const { appSourceFiles, readAppSource } = require('./helpers/app-source.cjs')
const { readGitHubSource } = require('./helpers/github-source.cjs')
const { readRemoteFilesSource } = require('./helpers/remote-files-source.cjs')
const { readSettingsSource, settingsSourceFiles } = require('./helpers/settings-source.cjs')
const { readTerminalSource } = require('./helpers/terminal-source.cjs')

const projectRoot = path.join(__dirname, '..')
const read = (file) => file === 'src/features/github/components/github-workspace.tsx'
  ? readGitHubSource()
  : file === 'src/features/remote-files/components/remote-files.tsx'
    ? readRemoteFilesSource()
  : file === 'src/features/terminal/components/free-terminal.tsx'
    ? readTerminalSource()
  : fs.readFileSync(path.join(projectRoot, file), 'utf8')

function filesUnder(directory, predicate) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(absolutePath, predicate)
    return predicate(absolutePath) ? [absolutePath] : []
  })
}

const rendererTsxFiles = filesUnder(path.join(projectRoot, 'src'), (file) => file.endsWith('.tsx'))

function sourceRecord(absolutePath) {
  const source = fs.readFileSync(absolutePath, 'utf8')
  return {
    absolutePath,
    file: path.relative(projectRoot, absolutePath),
    source,
    ast: ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  }
}

const rendererRecords = rendererTsxFiles.map(sourceRecord)

function visit(node, callback) {
  callback(node)
  ts.forEachChild(node, (child) => visit(child, callback))
}

function jsxTagName(element) {
  if (ts.isJsxElement(element)) return element.openingElement.tagName.getText()
  if (ts.isJsxSelfClosingElement(element)) return element.tagName.getText()
  return null
}

function jsxAttributes(element) {
  if (ts.isJsxElement(element)) return element.openingElement.attributes
  if (ts.isJsxSelfClosingElement(element)) return element.attributes
  return null
}

function jsxElements(record, expectedTag) {
  const matches = []
  visit(record.ast, (node) => {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && (!expectedTag || jsxTagName(node) === expectedTag)) {
      matches.push(node)
    }
  })
  return matches
}

function jsxAttribute(element, expectedName) {
  const attributes = jsxAttributes(element)
  return attributes?.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === expectedName)
}

function staticJsxAttributeValue(element, name) {
  const attribute = jsxAttribute(element, name)
  if (!attribute || !ts.isJsxAttribute(attribute)) return undefined
  if (!attribute.initializer) return true
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined
  const expression = attribute.initializer.expression
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function jsxAttributeLiteralValues(element, name) {
  const attribute = jsxAttribute(element, name)
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return []
  if (ts.isStringLiteral(attribute.initializer)) return [attribute.initializer.text]
  const values = []
  visit(attribute.initializer, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) values.push(true)
    if (node.kind === ts.SyntaxKind.FalseKeyword) values.push(false)
  })
  return values
}

function subtreeHasJsxTag(node, tag) {
  let found = false
  visit(node, (child) => {
    if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && jsxTagName(child) === tag) found = true
  })
  return found
}

function stringUnionMembers(ast, aliasName) {
  let members = []
  visit(ast, (node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== aliasName || !ts.isUnionTypeNode(node.type)) return
    members = node.type.types
      .filter(ts.isLiteralTypeNode)
      .map((member) => member.literal)
      .filter(ts.isStringLiteral)
      .map((literal) => literal.text)
  })
  return members
}

function objectProperty(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return null
  const property = object.properties.find((candidate) => {
    if (!ts.isPropertyAssignment(candidate)) return false
    const propertyName = candidate.name
    return (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) && propertyName.text === name
  })
  return property?.initializer ?? null
}

function recipeVariantMembers(ast, declarationName, variantName) {
  let result = []
  visit(ast, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.name.text !== declarationName) return
    if (!node.initializer || !ts.isCallExpression(node.initializer)) return
    const recipe = node.initializer.arguments[0]
    const variants = objectProperty(recipe, 'variants')
    const variant = objectProperty(variants, variantName)
    if (!variant || !ts.isObjectLiteralExpression(variant)) return
    result = variant.properties.flatMap((property) => {
      if (!property.name || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) return []
      return [property.name.text]
    })
  })
  return result
}

function importedModuleSpecifiers(record) {
  const specifiers = []
  visit(record.ast, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
      return
    }
    if (!ts.isCallExpression(node) || node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) return
    if ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifiers.push(node.arguments[0].text)
    }
  })
  return specifiers
}

function jsxAttributeExpressionText(element, name, sourceFile) {
  const attribute = jsxAttribute(element, name)
  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return undefined
  return attribute.initializer.expression.getText(sourceFile)
}

function useEffectDependenciesContaining(record, sourceNeedle) {
  let dependencies
  visit(record.ast, (node) => {
    if (dependencies !== undefined || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'useEffect') return
    const effect = node.arguments[0]
    if (!effect || !effect.getText(record.ast).includes(sourceNeedle)) return
    dependencies = node.arguments[1]?.getText(record.ast)
  })
  return dependencies
}

test('le primitive interattive sono centralizzate su Ark con recipe Park e Panda', () => {
  const index = read('src/components/ui/index.ts')
  const panda = read('panda.config.ts')
  const recipes = read('src/theme/recipes.ts')
  const primitives = [
    ['tabs', 'tabs', 'Tabs'],
    ['dialog', 'dialog', 'Dialog'],
    ['field', 'field', 'Field'],
    ['select', 'select', 'Select'],
    ['checkbox', 'checkbox', 'Checkbox'],
    ['segment-group', 'segment-group', 'SegmentGroup'],
    ['popover', 'popover', 'Popover'],
    ['collapsible', 'collapsible', 'Collapsible'],
    ['tooltip', 'tooltip', 'Tooltip'],
    ['toast', 'toast', 'Toaster'],
    ['progress', 'progress', 'Progress'],
    ['editable', 'editable', 'Editable'],
    ['tree-view', 'tree-view', 'TreeView'],
    ['splitter', 'splitter', 'Splitter'],
    ['file-upload', 'file-upload', 'FileUpload'],
    ['listbox', 'listbox', 'Listbox'],
  ]

  for (const [file, arkModule, publicName] of primitives) {
    const source = read(`src/components/ui/${file}.tsx`)
    assert.match(source, new RegExp(`@ark-ui/react/${arkModule}`), `${publicName} deve delegare comportamento e semantica ad Ark`)
    assert.match(source, /createStyleContext\(/, `${publicName} deve ricevere lo stile dalla recipe Park/Panda`)
    assert.match(source, /styled-system\/recipes/, `${publicName} deve usare le recipe generate da Panda`)
    assert.match(index, new RegExp(`export \\{[^}]*${publicName}[^}]*\\} from './${file}'`), `${publicName} deve essere esportato dall’ingresso UI unico`)
  }

  assert.match(panda, /preflight:\s*true/)
  assert.match(panda, /semanticTokens:/)
  assert.match(panda, /slotRecipes:/)
  for (const recipe of ['tabs', 'dialog', 'field', 'select', 'checkbox', 'segmentGroup', 'popover', 'collapsible', 'tooltip', 'toast', 'progress', 'editable', 'treeView', 'splitter', 'fileUpload', 'listbox']) {
    assert.match(recipes, new RegExp(`export const ${recipe}Recipe = defineSlotRecipe`))
  }
})

test('system light e dark attraversano preferenza Electron, DOM e token senza rimontare le superfici tecniche', () => {
  const app = readAppSource()
  const settings = readSettingsSource()
  const tokens = read('src/theme/tokens.ts')
  const electron = read('electron/main.cjs')
  const startupRuntime = read('electron/app/application-startup-runtime.cjs')
  const appearanceIpc = read('electron/ipc/domains/appearance.ipc.cjs')
  const xtermTheme = read('src/lib/xterm-theme.ts')
  const freeTerminal = read('src/features/terminal/components/free-terminal.tsx')

  assert.match(app, /useState<'system' \| 'light' \| 'dark'>\('system'\)/)
  assert.match(app, /appBridge\.appearance\.get\(\)[\s\S]*?setAppearance\(value\)/)
  assert.match(app, /document\.documentElement\.dataset\.theme = appearance/)
  assert.match(app, /document\.documentElement\.style\.colorScheme = appearance === 'system' \? 'light dark' : appearance/)
  assert.match(app, /setAppearance\(await appBridge\.appearance\.set\(value\)\)/)
  for (const [value, label] of [['system', 'Sistema'], ['light', 'Chiaro'], ['dark', 'Scuro']]) {
    assert.match(settings, new RegExp(`value: '${value}', label: '${label}'`))
  }

  assert.match(tokens, /base:\s*graphiteColor\('light', role\)/)
  assert.match(tokens, /_explicitDark:\s*graphiteColor\('dark', role\)/)
  assert.match(tokens, /_osDark:\s*\{\s*_systemTheme:\s*graphiteColor\('dark', role\)\s*\}/)
  assert.match(tokens, /explicitDark:\s*':root\[data-theme="dark"\] &'/)
  assert.match(tokens, /systemTheme:\s*':where\(:root:not\(\[data-theme\]\), :root\[data-theme="system"\]\) &'/)

  assert.match(startupRuntime, /nativeTheme\.themeSource = getAppearance\(\)/)
  assert.match(appearanceIpc, /\['appearance:set', \(event, appearance\)[\s\S]*?applyAppearance\(value\)/)
  assert.match(electron, /registerAppearanceIpc\(\{[\s\S]*?nativeTheme\.themeSource = value/)
  assert.match(xtermTheme, /MutationObserver\(updateTheme\)/)
  assert.match(xtermTheme, /attributeFilter:\s*\['data-theme'\]/)
  assert.match(xtermTheme, /matchMedia\('\(prefers-color-scheme: dark\)'\)/)
  assert.match(app, /observeXtermTheme\(\(theme\) => \{[\s\S]*?const xterm = getTerminal\(\)[\s\S]*?xterm\.options\.theme = theme/)
  assert.match(freeTerminal, /observeXtermTheme\(\(theme\) => \{[\s\S]*?terminal\.current\.options\.theme = theme/)
})

test('prefers-reduced-motion limita globalmente animazioni scroll e transizioni tramite la condition Panda', () => {
  const globalCss = read('src/theme/global-css.ts')
  const recipes = read('src/theme/recipes.ts')
  const styleSources = [
    globalCss,
    recipes,
    ...filesUnder(path.join(projectRoot, 'src/theme/styles'), (file) => file.endsWith('.ts')).map((file) => fs.readFileSync(file, 'utf8')),
    ...filesUnder(path.join(projectRoot, 'src/styles'), (file) => file.endsWith('.css')).map((file) => fs.readFileSync(file, 'utf8')),
  ].join('\n')

  assert.match(globalCss, /'\*, \*::before, \*::after':\s*\{[\s\S]*?_motionReduce:\s*\{[\s\S]*?animationDuration:\s*'0\.01ms !important'/)
  assert.match(globalCss, /_motionReduce:\s*\{[\s\S]*?animationIterationCount:\s*'1 !important'/)
  assert.match(globalCss, /_motionReduce:\s*\{[\s\S]*?scrollBehavior:\s*'auto !important'/)
  assert.match(globalCss, /_motionReduce:\s*\{[\s\S]*?transitionDuration:\s*'0\.01ms !important'/)
  assert.match(recipes, /spinnerRecipe = defineRecipe\([\s\S]*?animation:\s*'uiSpin'[\s\S]*?_motionReduce:\s*\{\s*animation:\s*'none'\s*\}/)
  assert.doesNotMatch(styleSources, /\.animate-spin/)
  assert.ok((recipes.match(/_motionReduce:/g) ?? []).length >= 7, 'le recipe animate devono dichiarare anche una riduzione locale intenzionale')
  assert.doesNotMatch(styleSources, /@media\s*\([^)]*prefers-reduced-motion/)
})

test('le liste selezionabili delegano focus composito tastiera e selezione a Listbox Ark', () => {
  const primitive = read('src/components/ui/listbox.tsx')
  const index = read('src/components/ui/index.ts')
  const recipes = read('src/theme/recipes.ts')
  const projectSkills = read('src/features/ai/components/project-skills.tsx')
  const remoteFiles = read('src/features/remote-files/components/remote-files.tsx')
  const settings = readSettingsSource()

  assert.match(primitive, /Listbox as ArkListbox[^\n]*from '@ark-ui\/react\/listbox'/)
  assert.match(index, /createListCollection[^\n]*from '@ark-ui\/react\/collection'/)
  assert.match(primitive, /createStyleContext\(listbox\)/)
  for (const slot of ['Root', 'Content', 'Item', 'ItemText', 'ItemIndicator']) assert.match(primitive, new RegExp(`${slot}:`))
  assert.match(index, /export \{ Listbox \} from '\.\/listbox'/)
  assert.match(recipes, /export const listboxRecipe = defineSlotRecipe/)
  assert.match(recipes, /_highlighted:\s*\{[^}]*bg:\s*'surfaceHover'/)
  assert.match(recipes, /_selected:\s*\{[^}]*bg:\s*'accentSubtle'/)
  assert.match(recipes, /_focusVisible:\s*\{[^}]*focusRing/)

  for (const source of [projectSkills, remoteFiles, settings]) {
    assert.match(source, /createListCollection\(/)
    assert.match(source, /<Listbox\.Root[^>]*collection=/)
    assert.match(source, /<Listbox\.Content/)
    assert.match(source, /<Listbox\.Item[^>]*item=/)
    assert.match(source, /selectionMode="single"/)
    assert.match(source, /loopFocus/)
    assert.doesNotMatch(source, /role="listbox"|role="option"/)
  }

  assert.doesNotMatch(projectSkills, /skill-list-item-active|<Button[^>]*className="skill-list-item/)
  assert.doesNotMatch(remoteFiles, /remote-connection-active|<Button[^>]*className="remote-profile-summary/)
  assert.doesNotMatch(settings, /<Button[^>]*className="system-skill-select/)
})

test('Tabs e SegmentGroup delegano roving focus e tastiera ad Ark senza handler o ruoli duplicati', () => {
  const tabs = read('src/components/ui/tabs.tsx')
  const segmentGroup = read('src/components/ui/segment-group.tsx')

  assert.match(tabs, /Tabs as ArkTabs[^\r\n]*from '@ark-ui\/react\/tabs'/)
  for (const mapping of ['Root: withProvider\\(ArkTabs.Root', 'List: withContext\\(ArkTabs.List', 'Trigger: withContext\\(ArkTabs.Trigger', 'Content: withContext\\(ArkTabs.Content']) {
    assert.match(tabs, new RegExp(mapping))
  }
  assert.match(segmentGroup, /SegmentGroup as ArkSegmentGroup[^\r\n]*from '@ark-ui\/react\/segment-group'/)
  for (const slot of ['Root', 'Item', 'ItemHiddenInput', 'ItemControl', 'ItemText', 'Indicator']) assert.match(segmentGroup, new RegExp(`${slot}:`))

  let tabsRoots = 0
  let tabsTriggers = 0
  let segmentItems = 0
  for (const record of rendererRecords) {
    for (const tag of ['Tabs.Root', 'Tabs.List', 'Tabs.Trigger', 'SegmentGroup.Root', 'SegmentGroup.Item']) {
      for (const element of jsxElements(record, tag)) {
        assert.equal(jsxAttribute(element, 'onKeyDown'), undefined, `${record.file}: ${tag} non deve reimplementare la tastiera Ark`)
        assert.equal(jsxAttribute(element, 'tabIndex'), undefined, `${record.file}: ${tag} non deve reimplementare il roving tabindex Ark`)
        assert.equal(jsxAttribute(element, 'role'), undefined, `${record.file}: ${tag} non deve duplicare il ruolo Ark`)
        if (tag === 'Tabs.Root') tabsRoots += 1
        if (tag === 'Tabs.Trigger') tabsTriggers += 1
        if (tag === 'SegmentGroup.Item') {
          segmentItems += 1
          for (const requiredPart of ['SegmentGroup.ItemHiddenInput', 'SegmentGroup.ItemControl', 'SegmentGroup.ItemText']) {
            assert.equal(subtreeHasJsxTag(element, requiredPart), true, `${record.file}: SegmentGroup.Item deve includere ${requiredPart}`)
          }
        }
      }
    }
  }
  assert.ok(tabsRoots > 0 && tabsTriggers > 0 && segmentItems > 0)
})

test('gli allegati Pi delegano drop, focus e tastiera a FileUpload senza cambiare gli IPC', () => {
  const attachments = read('src/features/ai/components/terminal-attachments.tsx')
  const fileUpload = read('src/components/ui/file-upload.tsx')
  const recipes = read('src/theme/recipes.ts')
  const styles = [attachments, fileUpload, recipes, read('src/theme/styles/terminal.ts')].join('\n')

  for (const slot of ['Root', 'Dropzone', 'HiddenInput', 'Trigger', 'ItemGroup', 'Item', 'ItemName', 'ItemDeleteTrigger']) {
    assert.match(attachments, new RegExp(`<FileUpload\\.${slot}`))
  }
  assert.match(attachments, /aiBridge\.terminal\.chooseAttachments\(\)/)
  assert.match(attachments, /aiBridge\.terminal\.prepareDroppedAttachments\(files\)/)
  assert.match(fileUpload, /FileUpload as ArkFileUpload[\s\S]*?from '@ark-ui\/react\/file-upload'/)
  assert.match(fileUpload, /createStyleContext\(fileUpload\)/)
  assert.match(recipes, /&\[data-dragging\]::after/)
  assert.match(recipes, /_focusVisible:/)
  assert.match(recipes, /_motionReduce:/)
  assert.doesNotMatch(attachments, /dragDepth|onDragEnter|onDragLeave|onDragOver|onDrop=/)
  assert.doesNotMatch(styles, /terminal-attachment-(?:chips?|insert)|terminal-drop-overlay/)
})

test('Splitter centralizza persistenza, reset e dimensioni controllate senza separator manuali', () => {
  const splitter = read('src/components/ui/splitter.tsx')
  const consumers = [
    'src/features/ai/components/project-skills.tsx',
    'src/features/database/components/database-workspace.tsx',
    'src/features/remote-files/components/remote-files.tsx',
    'src/features/github/components/github-workspace.tsx',
    'src/features/editor/components/project-editor.tsx',
    'src/features/terminal/components/free-terminal.tsx',
  ]

  assert.match(splitter, /readStorageSize\(window\.localStorage, storageKey\)/)
  assert.match(splitter, /writeStorageSize\(window\.localStorage, storageKey, size\)/)
  assert.match(splitter, /readStorageSize\(window\.sessionStorage, storageKey\)/)
  assert.match(splitter, /size=\{size\}/)
  assert.match(splitter, /setSize\(fixedPanelLayout\(panels\.length, fixedPanel, nextSize\)\)/)
  assert.match(splitter, /onDoubleClick=\{handleDoubleClick\}/)
  assert.match(splitter, /persistence\.resetToDefault\(\)/)
  assert.doesNotMatch(splitter, /splitterApi\.setSizes\(persistence\.defaultSize\)/)

  for (const file of consumers) {
    const source = read(file)
    assert.match(source, /<Splitter\.Root/)
    assert.match(source, /<Splitter\.Panel/)
    assert.match(source, /<Splitter\.ResizeTrigger/)
    assert.match(source, /storageKey=(?:"vincodelab\.|\{`vincodelab\.)/)
    assert.doesNotMatch(source, /useResizablePanel|role="separator"|onPointerDown=/)
  }

  const github = read('src/features/github/components/github-workspace.tsx')
  assert.match(github, /collapsible:\s*true,\s*collapsedSize:\s*'240px'/)
  assert.match(github, /<Splitter\.Context>\{\(\{ collapsePanel, expandPanel \}\)/)
  assert.match(github, /expandPanel\('github-project-picker'\) : collapsePanel\('github-project-picker'\)/)
})

test('l’explorer Database delega al TreeView Ark espansione selezione e tastiera', () => {
  const treeView = read('src/components/ui/tree-view.tsx')
  const index = read('src/components/ui/index.ts')
  const database = read('src/features/database/components/database-explorer.tsx')
  const databaseSchemaTreeNode = read('src/features/database/components/database-schema-tree-node.tsx')
  const recipes = read('src/theme/recipes.ts')

  assert.match(treeView, /TreeView as ArkTreeView[^\n]*from '@ark-ui\/react\/tree-view'/)
  assert.match(index, /export \{ createTreeCollection \} from '@ark-ui\/react\/tree-view'/)
  for (const slot of ['Root', 'Tree', 'NodeProvider', 'Branch', 'BranchControl', 'BranchTrigger', 'BranchIndicator', 'BranchText', 'BranchContent', 'Item', 'ItemText']) {
    assert.match(treeView, new RegExp(`${slot}:`))
  }
  assert.match(recipes, /export const treeViewRecipe = defineSlotRecipe/)
  assert.match(recipes, /tree:\s*\{[^}]*alignContent:\s*'start'/)
  assert.match(database, /createTreeCollection<SchemaTreeNode>/)
  assert.match(database, /<TreeView\.Root[\s\S]*?collection=\{schemaTreeCollection\}[\s\S]*?expandedValue=\{schemaExpandedValue\}[\s\S]*?selectedValue=\{schemaSelectedValue\}[\s\S]*?selectionMode="single"/)
  assert.match(databaseSchemaTreeNode, /<TreeView\.BranchTrigger aria-label=\{`\$\{node\.label\}: espandi o comprimi`\}>/)
  assert.match(database, /onExpandedChange=\{\(\{ expandedNodes \}\) => \{[\s\S]*?onExpandedSchemasChange\(new Set\(expandedNodes/)
  assert.match(database, /onSelectionChange=\{\(\{ selectedNodes \}\) => \{[\s\S]*?onOpenTable\(node\.tableName\)[\s\S]*?onOpenRoutine\(node\.routine\)/)
  assert.doesNotMatch(database, /role="(?:tree|treeitem)"|event\.key === ['"](?:ArrowUp|ArrowDown|ArrowLeft|ArrowRight)['"]/)
})

test('SelectField conserva semantica nativa, tastiera e layer portaled di Ark', () => {
  const select = read('src/components/ui/select.tsx')
  const recipes = read('src/theme/recipes.ts')
  const tokens = read('src/theme/tokens.ts')

  assert.match(select, /createListCollection/)
  assert.match(select, /HiddenSelect:\s*ArkSelect\.HiddenSelect/)
  assert.match(select, /<Select\.HiddenSelect \/>/)
  assert.match(select, /const accessibleLabel = label \?\? ariaLabel/)
  assert.match(select, /ids=\{id \? \{ trigger: id \} : undefined\}/)
  assert.match(select, /\{accessibleLabel && <Select\.Label className=\{label \? undefined : css\(\{ srOnly: true \}\)\}>\{accessibleLabel\}<\/Select\.Label>\}/)
  assert.match(select, /<Select\.Trigger>/)
  assert.match(select, /lazyMount[\s\S]*?unmountOnExit[\s\S]*?<Select\.Portal>[\s\S]*?<Select\.Positioner[^>]*>[\s\S]*?<Select\.Content/)
  assert.match(select, /const modalLayerClass = css\(\{ zIndex: 'modalPopover' \}\)/)
  assert.match(select, /<Select\.Positioner className=\{layer === 'modal' \? modalLayerClass : undefined\}>/)
  assert.match(select, /<Select\.Content className=\{layer === 'modal' \? modalLayerClass : undefined\}>/)
  assert.match(select, /<Select\.Item item=\{item\}/)
  assert.match(select, /<Select\.ItemIndicator>/)
  assert.match(recipes, /positioner:\s*\{\s*zIndex:\s*'popover'/)
  assert.match(tokens, /popover:\s*\{\s*value:\s*'30'/)
  assert.match(tokens, /modal:\s*\{\s*value:\s*'50'/)
  assert.match(tokens, /modalPopover:\s*\{\s*value:\s*'60'/)
})

test('Dialog delega focus trap, Escape e semantica modale ad Ark senza ruoli manuali', () => {
  const dialog = read('src/components/ui/dialog.tsx')
  const consumers = [
    'src/components/confirmation-dialog.tsx',
    'src/components/workspace-change-dialog.tsx',
    'src/components/remote-diff-dialog.tsx',
    'src/features/database/components/database-connection-dialog.tsx',
    'src/features/remote-files/components/remote-files.tsx',
    'src/features/github/components/github-workspace.tsx',
    'src/components/terminal-paste-status.tsx',
  ]

  for (const slot of ['Root', 'Backdrop', 'Positioner', 'Content', 'Title', 'Description', 'CloseTrigger']) {
    assert.match(dialog, new RegExp(`${slot}:`))
  }
  assert.match(dialog, /Root:\s*withRootProvider\(ArkDialog\.Root\)/)
  assert.match(dialog, /\n\s+Portal,/)
  for (const file of consumers) {
    const source = read(file)
    assert.match(source, /<Dialog\.Root/)
    assert.match(source, /<Dialog\.Portal>/)
    assert.match(source, /<Dialog\.Content/)
    assert.equal(source.match(/<Dialog\.Root\b/g)?.length, source.match(/<Dialog\.Portal>/g)?.length, `${file} deve portare ogni modal fuori dagli stack locali`)
    assert.doesNotMatch(source, /<dialog\b|role="dialog"|aria-modal="true"/)
    assert.doesNotMatch(source, /trapFocus=\{false\}|restoreFocus=\{false\}|modal=\{false\}/, `${file} deve conservare trap e ripristino focus predefiniti di Ark`)
  }

  const focusContracts = [
    ['src/components/confirmation-dialog.tsx', 'cancelButton', /finalFocusEl=\{\(\) => focusState\.opener\}/],
    ['src/components/workspace-change-dialog.tsx', 'cancelButton', /finalFocusEl=\{\(\) => focusState\.opener\}/],
    ['src/components/remote-diff-dialog.tsx', 'closeButton', /finalFocusEl=\{\(\) => opener\.current\}/],
    ['src/features/database/components/database-connection-dialog.tsx', 'nameInputRef', /finalFocusEl=\{\(\) => openerRef\.current\}/],
    ['src/features/remote-files/components/remote-files.tsx', 'renameInput', /finalFocusEl=\{\(\) => renameDialogOpener\.current\}/],
    ['src/components/terminal-paste-status.tsx', 'primaryAction', /finalFocusEl=\{\(\) => opener\.current\}/],
  ]
  for (const [file, initialFocusRef, finalFocusPattern] of focusContracts) {
    const source = read(file)
    assert.match(source, new RegExp(`initialFocusEl=\\{\\(\\) => ${initialFocusRef}\\.current\\}`), `${file} deve affidare ad Ark il focus iniziale utile`)
    assert.match(source, finalFocusPattern, `${file} deve affidare ad Ark il ritorno all'opener`)
  }

  for (const file of ['src/features/database/components/database-connection-dialog.tsx', 'src/components/terminal-paste-status.tsx', 'src/features/remote-files/components/remote-files.tsx', 'src/components/remote-diff-dialog.tsx']) {
    const source = read(file)
    assert.match(source, /<Dialog\.CloseTrigger asChild><IconButton[^>]*tooltip=/, `${file} deve usare IconButton con tooltip per la chiusura icon-only`)
    assert.doesNotMatch(source, /<Dialog\.CloseTrigger asChild><Button[^>]*(?:size="icon|aria-label="Chiudi)/, `${file} non deve ricreare un icon button con Button`)
  }

  const database = read('src/features/database/components/database-connection-dialog.tsx')
  const remoteFiles = read('src/features/remote-files/components/remote-files.tsx')
  const workspaceChange = read('src/components/workspace-change-dialog.tsx')
  assert.doesNotMatch(database, /\{connectionModalOpen && <Dialog\.Root/)
  assert.doesNotMatch(remoteFiles, /\{renaming && <Dialog\.Root/)
  assert.doesNotMatch(remoteFiles, /<Field\.Input autoFocus/)
  assert.doesNotMatch(workspaceChange, /if \(!open\) return null/)

  const terminal = read('src/features/terminal/components/free-terminal.tsx')
  assert.match(terminal, /<Dialog\.Root[\s\S]*?finalFocusEl=\{\(\) => commandsTrigger\.current\}/)
  assert.match(terminal, /<Dialog\.Root[\s\S]*?initialFocusEl=\{\(\) => commandSearchInput\.current\}/)
  assert.match(terminal, /modal=\{false\}[\s\S]*?trapFocus=\{false\}/)
  assert.match(terminal, /function closeCommands\(\) \{[\s\S]*?requestAnimationFrame\(\(\) => commandsTrigger\.current\?\.focus\(\)\)/)
})

test('tutti i TSX delegano controlli e semantica interattiva alle primitive Ark/Park', () => {
  const forbiddenIntrinsicTags = new Set(['button', 'input', 'select', 'textarea', 'dialog', 'details', 'summary'])
  const arkOwnedRoles = new Set(['tablist', 'tab', 'dialog', 'separator', 'listbox', 'tree', 'treeitem'])
  const rawControls = []
  const manualRoles = []
  const manualModals = []

  for (const record of rendererRecords) {
    for (const element of jsxElements(record)) {
      const tag = jsxTagName(element)
      if (forbiddenIntrinsicTags.has(tag)) rawControls.push(`${record.file}: <${tag}>`)

      for (const role of jsxAttributeLiteralValues(element, 'role')) {
        if (arkOwnedRoles.has(role)) manualRoles.push(`${record.file}: role="${role}"`)
      }
      if (jsxAttributeLiteralValues(element, 'aria-modal').includes(true)) manualModals.push(`${record.file}: aria-modal={true}`)
      if (jsxAttributeLiteralValues(element, 'aria-modal').includes('true')) manualModals.push(`${record.file}: aria-modal="true"`)
    }
  }

  assert.deepEqual(rawControls, [], `controlli HTML grezzi trovati:\n${rawControls.join('\n')}`)
  assert.deepEqual(manualRoles, [], `ruoli già gestiti da Ark trovati:\n${manualRoles.join('\n')}`)
  assert.deepEqual(manualModals, [], `semantica modale manuale trovata:\n${manualModals.join('\n')}`)

  // La board GitHub documenta una tabella ARIA (table/rowgroup/row/cell/columnheader):
  // questi ruoli strutturali non duplicano una primitiva Ark e restano intenzionalmente ammessi.
})

test('manifest, lockfile e import non reintroducono lo stack UI precedente', () => {
  const forbiddenLegacyPackage = (specifier) => {
    if (specifier === 'sonner') return true
    if (/^framer-motion(?:\/|$)/.test(specifier)) return true
    if (/^@base-ui(?:-components)?(?:\/|$)/.test(specifier)) return true
    if (/^(?:@shadcn\/|shadcn(?:-ui)?(?:\/|$))/.test(specifier)) return true
    if (/^(?:@tailwindcss\/|tailwindcss(?:-|\/|$)|tailwind-merge$|tw-animate-css$)/.test(specifier)) return true
    if (specifier === 'class-variance-authority') return true
    return specifier === '@codemirror/theme-one-dark'
  }
  const forbiddenSourceImport = (specifier) => (
    forbiddenLegacyPackage(specifier)
    || /^(?:motion-dom|motion-utils)(?:\/|$)/.test(specifier)
    || (/^motion(?:\/|$)/.test(specifier) && specifier !== 'motion/react')
  )
  const sourceDirectories = ['src', 'electron', 'scripts']
    .map((directory) => path.join(projectRoot, directory))
    .filter(fs.existsSync)
  const sourcePaths = sourceDirectories.flatMap((directory) => filesUnder(directory, (file) => /\.[cm]?[jt]sx?$/.test(file)))
  for (const config of ['panda.config.ts', 'vite.config.ts']) {
    const absolutePath = path.join(projectRoot, config)
    if (fs.existsSync(absolutePath)) sourcePaths.push(absolutePath)
  }
  const forbiddenImports = sourcePaths.flatMap((absolutePath) => {
    const record = sourceRecord(absolutePath)
    return importedModuleSpecifiers(record)
      .filter(forbiddenSourceImport)
      .map((specifier) => `${record.file}: ${specifier}`)
  })
  const motionImports = sourcePaths.flatMap((absolutePath) => {
    const record = sourceRecord(absolutePath)
    return importedModuleSpecifiers(record)
      .filter((specifier) => /^motion(?:\/|$)/.test(specifier))
      .map((specifier) => `${record.file}: ${specifier}`)
  })

  const manifest = JSON.parse(read('package.json'))
  const declaredPackages = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap((field) => Object.keys(manifest[field] ?? {}))
  const lockfile = JSON.parse(read('package-lock.json'))
  const lockedPackages = Object.keys(lockfile.packages ?? {}).flatMap((entry) => {
    if (!entry.includes('node_modules/')) return []
    return [entry.split('node_modules/').at(-1)]
  })

  assert.deepEqual(forbiddenImports, [], `import legacy trovati:\n${forbiddenImports.join('\n')}`)
  assert.deepEqual(motionImports, ['src/components/ui/workbench-presence.tsx: motion/react'], 'Motion deve essere importato solo dal wrapper WorkbenchPresence')
  assert.deepEqual(declaredPackages.filter(forbiddenLegacyPackage), [], 'il manifest contiene dipendenze UI legacy')
  assert.deepEqual(declaredPackages.filter((name) => /^(?:motion|motion-dom|motion-utils)$/.test(name)), ['motion'], 'solo motion può essere una dipendenza diretta')
  assert.deepEqual(lockedPackages.filter((name) => forbiddenLegacyPackage(name) && name !== 'framer-motion'), [], 'il lockfile contiene pacchetti UI legacy')
  assert.ok(lockedPackages.includes('motion'), 'Motion 13 deve essere bloccato nel lockfile')
  assert.equal(fs.existsSync(path.join(projectRoot, 'components.json')), false, 'la configurazione shadcn non deve esistere')
})

test('i vecchi helper di resize e navigazione sono eliminati, non solo inutilizzati', () => {
  const legacyModules = ['use-resizable-panel', 'panel-resize', 'tab-navigation']
  const legacyFiles = [
    'src/lib/use-resizable-panel.ts',
    'src/lib/panel-resize.js',
    'src/lib/panel-resize.d.ts',
    'src/lib/tab-navigation.ts',
  ]
  for (const file of legacyFiles) assert.equal(fs.existsSync(path.join(projectRoot, file)), false, `${file} deve essere rimosso`)

  const staleImports = filesUnder(path.join(projectRoot, 'src'), (file) => /\.[cm]?[jt]sx?$/.test(file)).flatMap((absolutePath) => {
    const record = sourceRecord(absolutePath)
    return importedModuleSpecifiers(record).flatMap((specifier) => {
      const moduleName = specifier.split('/').at(-1).replace(/\.[cm]?[jt]sx?$/, '')
      return legacyModules.includes(moduleName) ? [`${record.file}: ${specifier}`] : []
    })
  })
  assert.deepEqual(staleImports, [], `import verso helper legacy trovati:\n${staleImports.join('\n')}`)
})

test('lo stato delle tab Ark non viene duplicato da classi attive legacy', () => {
  const tabSurfaces = [
    'src/features/terminal/components/terminal-workspace.tsx',
    'src/features/remote-files/components/remote-files.tsx',
    'src/features/database/components/database-workspace.tsx',
    'src/features/github/components/github-workspace.tsx',
  ].map(read).concat(readAppSource(), readSettingsSource()).join('\n')
  const styles = [
    ...filesUnder(path.join(projectRoot, 'src/styles'), (file) => file.endsWith('.css')),
    ...filesUnder(path.join(projectRoot, 'src/theme/styles'), (file) => file.endsWith('.ts')),
  ].map((file) => fs.readFileSync(file, 'utf8')).join('\n')
  const legacyState = /ui-tab(?:list)?\b|(?:[a-z][\w-]*-)?tab-active\b/

  assert.doesNotMatch(tabSurfaces, legacyState)
  assert.doesNotMatch(styles, legacyState)
})

test('le viste operative restano montate dopo la prima apertura', () => {
  const record = (file) => rendererRecords.find((candidate) => candidate.file === file)
  const appRecords = rendererRecords.filter((candidate) => appSourceFiles.includes(candidate.file))
  const appSource = readAppSource()
  const terminal = record('src/features/terminal/components/terminal-workspace.tsx')
  const databaseRecords = [
    record('src/features/database/components/database-workspace.tsx'),
    record('src/features/database/components/database-results-panel.tsx'),
  ]
  const settingsRecords = rendererRecords.filter((candidate) => settingsSourceFiles.includes(candidate.file))
  const editor = record('src/features/editor/components/project-editor.tsx')
  const editorLifecycle = sourceRecord(path.join(projectRoot, 'src/features/editor/hooks/use-persistent-code-mirror.ts'))
  const freeTerminal = record('src/features/terminal/components/free-terminal.tsx')
  assert.ok(appRecords.length === appSourceFiles.filter((file) => file.endsWith('.tsx')).length && settingsRecords.length === settingsSourceFiles.filter((file) => file.endsWith('.tsx')).length && terminal && databaseRecords.every(Boolean) && editor && freeTerminal)

  const appContents = appRecords.flatMap((app) => jsxElements(app, 'Tabs.Content'))
  for (const section of ['settings', 'ai', 'editor', 'terminal', 'github', 'database']) {
    assert.ok(
      appContents.some((element) => staticJsxAttributeValue(element, 'value') === section && staticJsxAttributeValue(element, 'key') === section),
      `Tabs.Content ${section} deve avere una key stabile omonima indipendentemente dall'ordine delle prop`,
    )
  }
  assert.match(appSource, /setLoadedSections\(\(current\) => visitPersistentView\(current, section\)\)/)
  for (const section of ['editor', 'terminal', 'github', 'database']) {
    assert.match(appSource, new RegExp(`loadedSections\\.${section}\\s*\\|\\|\\s*appSection\\s*===\\s*['"]${section}['"]`))
  }
  for (const [view, active] of [['settings', 'appSection'], ['skills', 'aiTab'], ['instructions', 'aiTab']]) {
    assert.match(appSource, new RegExp(`shouldMountPersistentView\\(loadedSections, '${view}', ${active} === '${view}'\\)`))
  }
  for (const [tag, expectedKey] of [['ProjectEditor', 'workspace'], ['TerminalWorkspace', 'workspace'], ['GitHubWorkspace', 'workspace'], ['DatabaseWorkspace', 'workspace']]) {
    const owner = appRecords.find((app) => jsxElements(app, tag).length > 0)
    const element = owner && jsxElements(owner, tag)[0]
    assert.ok(element, `manca ${tag}`)
    assert.equal(jsxAttributeExpressionText(element, 'key', owner.ast), expectedKey, `${tag} deve cambiare istanza soltanto quando cambia workspace`)
  }

  const terminalContents = jsxElements(terminal, 'Tabs.Content')
  for (const [value, persistentView] of [['shell', 'FreeTerminal'], ['remote', 'RemoteFiles']]) {
    const content = terminalContents.find((element) => staticJsxAttributeValue(element, 'value') === value)
    assert.ok(content, `manca il pannello Terminale ${value}`)
    assert.equal(subtreeHasJsxTag(content, persistentView), true, `${persistentView} deve restare figlio stabile di Tabs.Content`)
  }
  assert.doesNotMatch(terminal.source, /tab === '(?:shell|remote)'\s*&&\s*<(?:FreeTerminal|RemoteFiles)/)

  const databaseValues = new Set(databaseRecords.flatMap((database) => jsxElements(database, 'Tabs.Content')).map((element) => staticJsxAttributeValue(element, 'value')))
  for (const value of ['sql', 'data']) assert.equal(databaseValues.has(value), true, `manca il pannello Database ${value}`)

  for (const tabsRecord of [...appRecords, ...settingsRecords, terminal, ...databaseRecords]) {
    for (const root of jsxElements(tabsRecord, 'Tabs.Root')) {
      assert.notEqual(staticJsxAttributeValue(root, 'lazyMount'), true, `${tabsRecord.file}: le tab operative non devono montare pigramente i pannelli`)
      assert.notEqual(staticJsxAttributeValue(root, 'unmountOnExit'), true, `${tabsRecord.file}: le tab operative non devono smontare i pannelli nascosti`)
    }
  }

  const aiTerminalRuntime = sourceRecord(path.join(projectRoot, 'src/features/ai/hooks/use-ai-terminal-instance.ts'))
  const databaseEditor = sourceRecord(path.join(projectRoot, 'src/features/database/hooks/use-database-sql-editor.ts'))
  const databaseResults = databaseRecords[1]
  const shellXtermLifecycle = sourceRecord(path.join(projectRoot, 'src/features/terminal/hooks/use-shell-xterm-lifecycle.ts'))
  const aiXtermDependencies = useEffectDependenciesContaining(aiTerminalRuntime, 'new xtermModule.Terminal')
  const shellXtermDependencies = useEffectDependenciesContaining(shellXtermLifecycle, 'new Terminal')
  const editorViewDependencies = useEffectDependenciesContaining(editorLifecycle, 'new EditorView')
  const databaseEditorDependencies = useEffectDependenciesContaining(databaseEditor, 'new EditorView')
  assert.ok(aiXtermDependencies && shellXtermDependencies !== undefined && editorViewDependencies !== undefined && databaseEditorDependencies !== undefined)
  assert.match(aiXtermDependencies, /workspace/)
  assert.doesNotMatch(aiXtermDependencies, /appSection|aiTab/)
  assert.doesNotMatch(shellXtermDependencies, /active|\btab\b/)
  assert.equal(editorViewDependencies, '[]', 'CodeMirror Editor deve vivere quanto ProjectEditor')
  assert.equal(databaseEditorDependencies, '[connectionIdRef]', 'CodeMirror Database deve dipendere solo dal ref stabile della connessione')
  assert.match(databaseResults.source, /<DatabaseTableGrid[\s\S]*?key=\{`\$\{selectedTableName\}:\$\{tableRevision\}`\}/)
  assert.doesNotMatch(databaseResults.source, /<DatabaseTableGrid[^>]*key=\{[^}]*databaseView/)

  const settingsContents = settingsRecords.flatMap((settings) => jsxElements(settings, 'Tabs.Content'))
  const settingsSource = readSettingsSource()
  for (const value of ['general', 'updates', 'runtime', 'packages', 'skills']) {
    const content = settingsContents.find((element) => staticJsxAttributeValue(element, 'value') === value)
    assert.ok(content, `manca il pannello Impostazioni ${value}`)
    assert.equal(staticJsxAttributeValue(content, 'asChild'), true, `il pannello ${value} deve conservare il nodo sezione`)
    assert.doesNotMatch(settingsSource, new RegExp(`tab === ['"]${value}['"]\\s*&&\\s*<`))
  }
})

test('Button espone solo le cinque varianti Graphite e usa tone danger per le azioni distruttive', () => {
  const allowedVariants = ['outline', 'plain', 'solid', 'subtle', 'surface']
  const allowedTones = ['accent', 'danger']
  const button = sourceRecord(path.join(projectRoot, 'src/components/ui/button.tsx'))
  const recipes = sourceRecord(path.join(projectRoot, 'src/theme/recipes.ts'))

  assert.deepEqual(stringUnionMembers(button.ast, 'ParkVariant').sort(), allowedVariants)
  assert.deepEqual(stringUnionMembers(button.ast, 'ParkTone').sort(), allowedTones)
  assert.deepEqual(recipeVariantMembers(recipes.ast, 'buttonRecipe', 'variant').sort(), allowedVariants)
  assert.deepEqual(recipeVariantMembers(recipes.ast, 'buttonRecipe', 'tone').sort(), allowedTones)

  const invalidVariants = []
  const invalidTones = []
  let dangerToneUses = 0
  for (const record of rendererRecords) {
    if (record.file === 'src/components/ui/button.tsx' || record.file === 'src/components/ui/icon-button.tsx') continue
    for (const tag of ['Button', 'IconButton']) {
      for (const element of jsxElements(record, tag)) {
        const variant = staticJsxAttributeValue(element, 'variant')
        const tone = staticJsxAttributeValue(element, 'tone')
        if (typeof variant === 'string' && !allowedVariants.includes(variant)) invalidVariants.push(`${record.file}: ${tag} variant="${variant}"`)
        if (typeof tone === 'string' && !allowedTones.includes(tone)) invalidTones.push(`${record.file}: ${tag} tone="${tone}"`)
        if (tone === 'danger') dangerToneUses += 1
      }
    }
  }

  assert.deepEqual(invalidVariants, [], `varianti Button non standard trovate:\n${invalidVariants.join('\n')}`)
  assert.deepEqual(invalidTones, [], `tone Button non standard trovati:\n${invalidTones.join('\n')}`)
  assert.ok(dangerToneUses > 0, 'le azioni distruttive devono usare esplicitamente tone="danger"')
})
