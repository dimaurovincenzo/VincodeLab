const test = require('node:test')
const assert = require('node:assert/strict')

const {
  APP_SECTIONS,
  createApplicationMenuTemplate,
  isApplicationMenuCommand,
} = require('../electron/application-menu.cjs')

const WORKSPACE_SECTIONS = ['ai', 'editor', 'terminal', 'github', 'database']

function commandItems(template) {
  return template.flatMap((menu) => Array.isArray(menu.submenu)
    ? menu.submenu.filter((item) => item.command)
    : [])
}

function templateFor(activeSection, hasWorkspace = true, dispatched = []) {
  return createApplicationMenuTemplate({
    appName: 'VincodeLab',
    activeSection,
    hasWorkspace,
    isDevelopment: false,
    onCommand(command) { dispatched.push(command) },
  })
}

test('la grammatica globale implementata resta stabile in ogni contesto operativo', () => {
  const expected = new Map([
    ['workbench.commandPalette', 'CmdOrCtrl+Shift+P'],
    ['workbench.quickOpen', 'CmdOrCtrl+P'],
    ['workspace.open', 'CmdOrCtrl+O'],
    ['navigation.ai', 'CmdOrCtrl+1'],
    ['navigation.editor', 'CmdOrCtrl+2'],
    ['navigation.terminal', 'CmdOrCtrl+3'],
    ['navigation.github', 'CmdOrCtrl+4'],
    ['navigation.database', 'CmdOrCtrl+5'],
    ['navigation.settings', 'CmdOrCtrl+,'],
    ['terminal.focus', 'Ctrl+`'],
    ['terminal.new', 'Ctrl+Shift+`'],
  ])

  for (const section of APP_SECTIONS) {
    const items = commandItems(templateFor(section))
    for (const [command, accelerator] of expected) {
      const matches = items.filter((item) => item.command === command)
      assert.ok(matches.length >= 1, `${command} assente nella sezione ${section}`)
      const acceleratedMatches = matches.filter((item) => item.accelerator)
      assert.ok(acceleratedMatches.length >= 1, `${command} non ha acceleratore nella sezione ${section}`)
      assert.equal(acceleratedMatches.every((item) => item.accelerator === accelerator), true)
    }
  }
})

test('un acceleratore non cambia comando quando cambia area', () => {
  for (const section of APP_SECTIONS) {
    const commandsByAccelerator = new Map()

    for (const item of commandItems(templateFor(section))) {
      if (!item.accelerator) continue
      const commands = commandsByAccelerator.get(item.accelerator) ?? new Set()
      commands.add(item.command)
      commandsByAccelerator.set(item.accelerator, commands)
    }

    for (const [accelerator, commands] of commandsByAccelerator) {
      assert.equal(
        commands.size,
        1,
        `${accelerator} esegue comandi diversi nella sezione ${section}: ${[...commands].join(', ')}`,
      )
    }
  }
})

test('il gating del workspace conserva accessibili soltanto le destinazioni globali', () => {
  const template = templateFor('home', false)
  const items = commandItems(template)

  for (const section of WORKSPACE_SECTIONS) {
    const item = items.find((candidate) => candidate.command === `navigation.${section}`)
    assert.equal(item.enabled, false, `navigation.${section} deve richiedere un workspace`)
  }

  assert.equal(items.find((item) => item.command === 'navigation.settings').enabled, true)
  assert.equal(items.find((item) => item.command === 'workspace.reveal').enabled, false)
  assert.equal(items.find((item) => item.command === 'terminal.focus').enabled, false)
  assert.notEqual(items.find((item) => item.command === 'workspace.open').enabled, false)
})

test('click e allowlist inoltrano soltanto comandi dichiarati dal contratto pubblico', () => {
  const dispatched = []
  const template = templateFor('database', true, dispatched)
  const workspaceOpen = commandItems(template).find((item) => item.command === 'workspace.open')
  const execute = commandItems(template).find((item) => item.command === 'database.execute')

  workspaceOpen.click()
  execute.click()

  assert.deepEqual(dispatched, ['workspace.open', 'database.execute'])
  assert.equal(isApplicationMenuCommand('navigation.editor'), true)
  assert.equal(isApplicationMenuCommand('database.execute'), true)
  assert.equal(isApplicationMenuCommand('workspace.open'), true)
  assert.equal(isApplicationMenuCommand('github.push'), false)
  assert.equal(isApplicationMenuCommand('shell:input'), false)
})
