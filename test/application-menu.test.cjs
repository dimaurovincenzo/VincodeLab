const test = require('node:test')
const assert = require('node:assert/strict')

const { createApplicationMenuTemplate, isApplicationMenuCommand } = require('../electron/application-menu.cjs')

function menuByLabel(template, label) {
  return template.find((item) => item.label === label)
}

function itemByCommand(menu, command) {
  return menu.submenu.find((item) => item.command === command)
}

test('il nome del menu applicazione resta VincodeLab anche nel runtime Electron di sviluppo', () => {
  const template = createApplicationMenuTemplate({
    activeSection: 'home',
    hasWorkspace: false,
    isDevelopment: true,
    onOpenWorkspace() {},
    onCommand() {},
  })

  assert.equal(template[0].label, 'VincodeLab')
})

test('il menu macOS espone navigazione VincodeLab e conserva i comandi di modifica nativi', () => {
  const template = createApplicationMenuTemplate({
    appName: 'VincodeLab',
    activeSection: 'editor',
    hasWorkspace: true,
    isDevelopment: false,
    onOpenWorkspace() {},
    onCommand() {},
  })

  assert.deepEqual(template.map((item) => item.label ?? item.role), [
    'VincodeLab',
    'Workspace',
    'Modifica',
    'Vai',
    'Azioni',
    'Vista',
    'Finestra',
  ])
  assert.deepEqual(menuByLabel(template, 'Modifica').submenu.map((item) => item.role ?? item.type), [
    'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll',
  ])
  const settingsItems = template
    .flatMap((menu) => Array.isArray(menu.submenu) ? menu.submenu : [])
    .filter((item) => item.command === 'navigation.settings' && item.accelerator)
  assert.equal(settingsItems.length >= 1, true)
  assert.equal(settingsItems.every((item) => item.accelerator === 'CmdOrCtrl+,'), true)
  assert.equal(itemByCommand(menuByLabel(template, 'Vai'), 'navigation.editor').accelerator, 'CmdOrCtrl+2')
  assert.deepEqual(menuByLabel(template, 'Finestra').submenu.map((item) => item.role ?? item.type), [
    'minimize', 'zoom', 'separator', 'front',
  ])
})

test('il menu Azioni cambia con la sezione attiva senza esporre mutazioni dirette', () => {
  const dispatched = []
  const common = {
    appName: 'VincodeLab',
    hasWorkspace: true,
    isDevelopment: false,
    onOpenWorkspace() {},
    onCommand(command) { dispatched.push(command) },
  }

  const editorActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'editor' }), 'Azioni')
  assert.deepEqual(editorActions.submenu.map((item) => item.command), [
    'editor.save',
    'editor.search',
    'editor.focusExplorer',
    'editor.nextTab',
    'editor.previousTab',
    'editor.close',
    'editor.refresh',
  ])
  itemByCommand(editorActions, 'editor.save').click()
  assert.deepEqual(dispatched, ['editor.save'])

  const githubActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'github' }), 'Azioni')
  assert.deepEqual(githubActions.submenu.map((item) => item.command), ['github.refresh', 'github.fetch'])
  assert.equal(githubActions.submenu.some((item) => item.command === 'github.push'), false)

  const databaseActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'database' }), 'Azioni')
  assert.deepEqual(databaseActions.submenu.map((item) => item.command), ['database.execute', 'database.format', 'database.schema'])
  assert.equal(itemByCommand(databaseActions, 'database.format').accelerator, 'Alt+Shift+F')

  const terminalActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'terminal' }), 'Azioni')
  assert.deepEqual(terminalActions.submenu.filter((item) => item.command).map((item) => item.command), [
    'terminal.new', 'terminal.previous', 'terminal.next', 'terminal.close',
    'terminal.search', 'terminal.clear', 'terminal.restart',
  ])

  const aiTerminalActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'ai' }), 'Azioni')
  const aiResourceActions = menuByLabel(createApplicationMenuTemplate({ ...common, activeSection: 'ai-skills' }), 'Azioni')
  assert.equal(aiTerminalActions.submenu.some((item) => item.command === 'ai.save'), false)
  assert.deepEqual(aiResourceActions.submenu.map((item) => item.command), ['ai.save', 'ai.reload', 'ai.restart'])
})

test('reload e DevTools compaiono soltanto durante lo sviluppo', () => {
  const options = {
    appName: 'VincodeLab',
    activeSection: 'home',
    hasWorkspace: false,
    onOpenWorkspace() {},
    onCommand() {},
  }
  const productionView = menuByLabel(createApplicationMenuTemplate({ ...options, isDevelopment: false }), 'Vista')
  const developmentView = menuByLabel(createApplicationMenuTemplate({ ...options, isDevelopment: true }), 'Vista')

  assert.equal(productionView.submenu.some((item) => item.role === 'reload' || item.role === 'toggleDevTools'), false)
  assert.equal(developmentView.submenu.some((item) => item.role === 'reload'), true)
  assert.equal(developmentView.submenu.some((item) => item.role === 'toggleDevTools'), true)
})

test('le azioni contestuali non entrano in conflitto con le scorciatoie di sviluppo', () => {
  const options = {
    appName: 'VincodeLab',
    hasWorkspace: true,
    isDevelopment: true,
    onOpenWorkspace() {},
    onCommand() {},
  }

  for (const activeSection of ['ai', 'github', 'database']) {
    const template = createApplicationMenuTemplate({ ...options, activeSection })
    const actionAccelerators = menuByLabel(template, 'Azioni').submenu
      .map((item) => item.accelerator)
      .filter(Boolean)
    assert.deepEqual(actionAccelerators.filter((accelerator) => [
      'CmdOrCtrl+R',
      'CmdOrCtrl+Shift+R',
    ].includes(accelerator)), [], `scorciatoia duplicata nella sezione ${activeSection}`)
  }
})

test('le azioni del workspace sono disabilitate quando non esiste un workspace aperto', () => {
  const template = createApplicationMenuTemplate({
    appName: 'VincodeLab',
    activeSection: 'home',
    hasWorkspace: false,
    isDevelopment: false,
    onOpenWorkspace() {},
    onCommand() {},
  })

  assert.equal(itemByCommand(menuByLabel(template, 'Workspace'), 'workspace.reveal').enabled, false)
  assert.equal(itemByCommand(menuByLabel(template, 'Vai'), 'navigation.github').enabled, false)
  assert.equal(itemByCommand(menuByLabel(template, 'Vai'), 'navigation.settings').enabled, true)
})

test('il bridge accetta soltanto comandi applicativi dichiarati', () => {
  assert.equal(isApplicationMenuCommand('workspace.open'), true)
  assert.equal(isApplicationMenuCommand('navigation.database'), true)
  assert.equal(isApplicationMenuCommand('database.execute'), true)
  assert.equal(isApplicationMenuCommand('database.format'), true)
  assert.equal(isApplicationMenuCommand('ai.copy'), true)
  assert.equal(isApplicationMenuCommand('ai.paste'), true)
  assert.equal(isApplicationMenuCommand('ai.skills'), true)
  assert.equal(isApplicationMenuCommand('ai.instructions'), true)
  assert.equal(isApplicationMenuCommand('terminal.copy'), true)
  assert.equal(isApplicationMenuCommand('terminal.paste'), true)
  assert.equal(isApplicationMenuCommand('github.push'), false)
  assert.equal(isApplicationMenuCommand('shell:input'), false)
  assert.equal(isApplicationMenuCommand(''), false)
})
