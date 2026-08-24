const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createContextMenuTemplate } = require('../electron/context-menu.cjs')
const { isApplicationMenuCommand } = require('../electron/application-menu.cjs')

function labels(template) {
  return template.map((item) => item.label ?? item.role ?? item.type)
}

function commands(template) {
  return template.filter((item) => item.command).map((item) => item.command)
}

test('un campo editabile conserva la modifica nativa e aggiunge le azioni della pagina', () => {
  const template = createContextMenuTemplate({
    activeSection: 'settings',
    params: {
      isEditable: true,
      selectionText: 'testo',
      editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    },
    onCommand() {},
  })

  assert.deepEqual(template.filter((item) => item.role).map((item) => item.role), ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'])
  assert.equal(template.find((item) => item.role === 'undo').enabled, true)
  assert.equal(template.find((item) => item.role === 'redo').enabled, false)
  assert.deepEqual(commands(template), ['settings.refresh', 'settings.resetWorkspacePreferences', 'workspace.open', 'workbench.quickOpen', 'workbench.commandPalette'])
})

test('Home offre apertura, ricerca comandi e impostazioni oltre alla copia nativa', () => {
  const template = createContextMenuTemplate({
    activeSection: 'home',
    params: { isEditable: false, selectionText: 'VincodeLab', editFlags: { canCopy: true } },
    onCommand() {},
  })

  assert.deepEqual(labels(template).slice(0, 2), ['Copia', 'Incolla'])
  assert.equal(template[0].enabled, true)
  assert.equal(template[1].enabled, false)
  assert.deepEqual(commands(template), ['workspace.open', 'workbench.quickOpen', 'workbench.commandPalette', 'navigation.settings'])
})

test('solo la superficie xterm usa Copia e Incolla applicativi', () => {
  const dispatched = []
  const xterm = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { surfaceKind: 'terminal', enabledCommands: ['terminal.copy', 'terminal.paste'] },
    onCommand(command) { dispatched.push(command) },
  })
  const toolbar = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { surfaceKind: 'default', editFlags: {} },
    onCommand() {},
  })

  assert.deepEqual(commands(xterm).slice(0, 2), ['terminal.copy', 'terminal.paste'])
  assert.equal(toolbar.slice(0, 2).every((item) => item.role), true)
  xterm[1].click()
  assert.deepEqual(dispatched, ['terminal.paste'])
})

test('ogni pagina espone il set completo di comandi già operativi', () => {
  const options = { params: { isEditable: false, selectionText: '', editFlags: {} }, onCommand() {} }
  const editor = commands(createContextMenuTemplate({ ...options, activeSection: 'editor' }))
  const terminal = commands(createContextMenuTemplate({ ...options, activeSection: 'terminal' }))
  const github = commands(createContextMenuTemplate({ ...options, activeSection: 'github' }))
  const database = commands(createContextMenuTemplate({ ...options, activeSection: 'database' }))

  assert.deepEqual(editor, ['editor.save', 'editor.search', 'editor.focus', 'editor.focusExplorer', 'editor.nextTab', 'editor.previousTab', 'editor.close', 'editor.openCurrentDiff', 'editor.sendFileToAi', 'editor.sendSelectionToAi', 'editor.refresh'])
  assert.deepEqual(terminal, ['terminal.new', 'terminal.previous', 'terminal.next', 'terminal.close', 'terminal.search', 'terminal.selectAll', 'terminal.clear', 'terminal.zoomIn', 'terminal.zoomOut', 'terminal.zoomReset', 'terminal.restart'])
  assert.deepEqual(github, ['github.focusChanges', 'github.refresh', 'github.fetch'])
  assert.deepEqual(database, ['database.focus', 'database.execute', 'database.cancel', 'database.format', 'database.saveQuery', 'database.schema', 'database.begin', 'database.commit', 'database.rollback'])
})

test('Skill e Istruzioni AI non perdono piu il proprio contesto', () => {
  const options = { params: { isEditable: false, selectionText: '', editFlags: {} }, onCommand() {} }
  assert.deepEqual(commands(createContextMenuTemplate({ ...options, activeSection: 'ai-skills' })), ['ai.save', 'ai.reload', 'ai.restart'])
  assert.deepEqual(commands(createContextMenuTemplate({ ...options, activeSection: 'ai-instructions' })), ['ai.save', 'ai.reload', 'ai.restart'])
})

test('lo stato del registry disabilita i comandi non eseguibili senza rimuoverli', () => {
  const template = createContextMenuTemplate({
    activeSection: 'editor',
    params: { enabledCommands: ['editor.search', 'editor.refresh'] },
    onCommand() {},
  })

  assert.equal(template.find((item) => item.command === 'editor.search').enabled, true)
  assert.equal(template.find((item) => item.command === 'editor.save').enabled, false)
  assert.equal(template.find((item) => item.command === 'editor.refresh').enabled, true)
})

test('un file remoto espone download, percorso, rinomina ed eliminazione', () => {
  const dispatched = []
  const template = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { contextKind: 'remote-file', contextId: '123e4567-e89b-42d3-a456-426614174000' },
    onCommand() {},
    onContextCommand(command, contextId, contextKind) { dispatched.push({ command, contextId, contextKind }) },
  })

  assert.deepEqual(commands(template), ['remote.downloadOpen', 'remote.downloadAs', 'remote.copyPath', 'remote.rename', 'remote.delete'])
  template[0].click()
  assert.deepEqual(dispatched, [{ command: 'remote.downloadOpen', contextId: '123e4567-e89b-42d3-a456-426614174000', contextKind: 'remote-file' }])
})

test('copie locali e trasferimenti ricevono azioni specifiche e gating di stato', () => {
  const local = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { contextKind: 'remote-local-file', contextId: '123e4567-e89b-42d3-a456-426614174000' },
    onCommand() {},
  })
  const running = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { contextKind: 'remote-transfer', contextId: '123e4567-e89b-42d3-a456-426614174000', contextFlags: { cancellable: true } },
    onCommand() {},
  })

  assert.deepEqual(commands(local), ['remoteLocal.open', 'remoteLocal.reveal', 'remoteLocal.copyPath', 'remoteLocal.discard'])
  assert.equal(running.find((item) => item.command === 'remoteTransfer.cancel').enabled, true)
  assert.equal(running.find((item) => item.command === 'remoteTransfer.retry').enabled, false)
})

test('file, cartella, root e tab Editor usano il bersaglio cliccato', () => {
  const options = { activeSection: 'editor', onCommand() {} }
  const file = createContextMenuTemplate({ ...options, params: { contextKind: 'workspace-file', contextId: 'src/App.tsx' } })
  const directory = createContextMenuTemplate({ ...options, params: { contextKind: 'workspace-directory', contextId: 'src', contextFlags: { expanded: true } } })
  const root = createContextMenuTemplate({ ...options, params: { contextKind: 'workspace-root', contextId: '' } })
  const tab = createContextMenuTemplate({ ...options, params: { contextKind: 'editor-workspace-tab', contextId: 'src/App.tsx', contextFlags: { dirty: true, hasOtherTabs: true, hasRightTabs: false } } })

  assert.deepEqual(commands(file), ['workspaceFile.open', 'workspaceFile.openWith', 'workspaceFile.rename', 'workspaceFile.duplicate', 'workspaceEntry.copyName', 'workspaceEntry.copyRelativePath', 'workspaceEntry.copyAbsolutePath', 'workspaceEntry.reveal', 'workspaceFile.trash'])
  assert.equal(directory.some((item) => item.command === 'workspaceDirectory.collapse'), true)
  assert.equal(directory.some((item) => item.command === 'workspaceDirectory.expand'), false)
  assert.deepEqual(commands(root), ['workspaceDirectory.newFile', 'workspaceDirectory.newDirectory', 'workspaceExplorer.collapseAll', 'workspaceExplorer.refresh', 'workspaceEntry.copyAbsolutePath', 'workspaceEntry.reveal'])
  assert.equal(tab.find((item) => item.command === 'editorTab.save').enabled, true)
  assert.equal(tab.find((item) => item.command === 'editorTab.closeOthers').enabled, true)
  assert.equal(tab.find((item) => item.command === 'editorTab.closeRight').enabled, false)
})

test('un workspace recente si apre qui o in una nuova finestra e resta copiabile', () => {
  const template = createContextMenuTemplate({
    activeSection: 'home',
    params: { contextKind: 'recent-workspace', contextId: '/tmp/progetto' },
    onCommand() {},
  })
  assert.deepEqual(commands(template), ['recentWorkspace.open', 'recentWorkspace.openNew', 'recentWorkspace.copyPath', 'recentWorkspace.reveal'])
})

test('file Git e tab terminale operano sull’elemento cliccato con gating esplicito', () => {
  const git = createContextMenuTemplate({
    activeSection: 'github',
    params: { contextKind: 'git-unstaged-file', contextId: 'src/App.tsx', contextFlags: { operable: true, stageable: false } },
    onCommand() {},
  })
  const terminalTab = createContextMenuTemplate({
    activeSection: 'terminal',
    params: { contextKind: 'terminal-tab', contextId: '123e4567-e89b-42d3-a456-426614174000', contextFlags: { canCreate: true, operable: true } },
    onCommand() {},
  })

  assert.equal(git.find((item) => item.command === 'gitFile.diff').enabled, true)
  assert.equal(git.find((item) => item.command === 'gitFile.stage').enabled, false)
  assert.deepEqual(commands(terminalTab), ['terminalTab.activate', 'terminalTab.new', 'terminalTab.restart', 'terminalTab.close'])
  assert.equal(terminalTab.every((item) => item.type === 'separator' || item.enabled), true)
})

test('la finestra Electron valida kind, ID, comandi abilitati e flags prima del menu', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')

  assert.equal((main.match(/ipcMain\.handle\('contextMenu:open'/g) ?? []).length, 1)
  assert.match(main, /ipcMain\.handle\('contextMenu:open'[\s\S]*assertTrustedSender\(event\)/)
  assert.match(main, /REMOTE_CONTEXT_KINDS/)
  assert.match(main, /WORKSPACE_FILE_CONTEXT_KINDS/)
  assert.match(main, /request\?\.enabledCommands[\s\S]*isApplicationMenuCommand/)
  assert.doesNotMatch(main, /relative\.startsWith\('\.\.'\)/)
  assert.match(main, /relative === '\.\.' \|\| relative\.startsWith\(`\.\.\$\{path\.sep\}`\)/)
  assert.match(main, /surfaceKind = request\?\.kind === 'terminal'/)
  assert.match(main, /activeSection: activeAppSection/)
  assert.match(main, /onCommand: dispatchApplicationMenuCommand/)
  assert.match(main, /onContextCommand: dispatchContextMenuCommand/)
  assert.match(main, /Menu\.buildFromTemplate\(template\)\.popup\(\{ window: mainWindow \}\)/)
})

test('tutti i comandi inviati come stato del menu sono accettati dal bridge nativo', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const start = app.indexOf('const workbenchCommands')
  const end = app.indexOf('useEffect(() => commandRegistry.registerAll', start)
  const commandIds = [...app.slice(start, end).matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])

  assert.ok(commandIds.length > 0)
  assert.deepEqual(commandIds.filter((command) => !isApplicationMenuCommand(command)), [])
})

test('main e preload espongono mutazioni filesystem confinate e Cestino macOS', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')

  assert.match(main, /ipcMain\.handle\('files:createDirectory'/)
  assert.match(main, /ipcMain\.handle\('files:rename'/)
  assert.match(main, /ipcMain\.handle\('files:duplicate'/)
  assert.match(main, /ipcMain\.handle\('files:trash'[\s\S]*resolveProject(File|Directory)[\s\S]*shell\.trashItem/)
  assert.match(preload, /createDirectory: .*files:createDirectory/)
  assert.match(preload, /rename: .*files:rename/)
  assert.match(preload, /duplicate: .*files:duplicate/)
  assert.match(preload, /trash: .*files:trash/)
})

test('DOM renderer identifica Explorer, cartelle, tab, recenti, copie e trasferimenti', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')
  const github = fs.readFileSync(path.join(__dirname, '../src/features/github/components/github-workspace.tsx'), 'utf8')
  const remote = fs.readFileSync(path.join(__dirname, '../src/features/remote-files/components/remote-files.tsx'), 'utf8')
  const terminal = fs.readFileSync(path.join(__dirname, '../src/features/terminal/components/terminal-workspace.tsx'), 'utf8')

  assert.match(app, /closest<HTMLElement>\('\[data-context-menu-kind\]'\)/)
  assert.match(app, /data-context-menu-kind="recent-workspace"/)
  assert.match(editor, /data-workspace-context-kind="workspace-file"/)
  assert.match(editor, /data-workspace-context-kind="workspace-directory"/)
  assert.match(editor, /data-workspace-context-kind="workspace-root"/)
  assert.match(editor, /'editor-remote-tab' : 'editor-workspace-tab'/)
  assert.match(remote, /data-remote-context-kind="remote-local-file"/)
  assert.match(remote, /data-remote-context-kind="remote-transfer"/)
  assert.match(github, /data-context-menu-kind="git-unstaged-file"/)
  assert.match(github, /data-context-menu-kind="git-staged-file"/)
  assert.match(terminal, /data-context-menu-kind="terminal-tab"/)
})
