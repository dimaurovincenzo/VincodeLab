const assert = require('node:assert/strict')
const test = require('node:test')

const { createApplicationMenuFeedbackRuntime } = require('../electron/app/application-menu-feedback-runtime.cjs')

function createFixture() {
  const logs = []
  const sent = []
  const templates = []
  const installedMenus = []
  const notifications = []
  let workspacePath
  let focused = false
  let supported = true

  class Notification {
    static isSupported() { return supported }
    constructor(options) { this.options = options }
    show() { notifications.push(this.options) }
  }

  const runtime = createApplicationMenuFeedbackRuntime({
    Menu: {
      buildFromTemplate: (template) => {
        templates.push(template)
        return { template }
      },
      setApplicationMenu: (menu) => installedMenus.push(menu),
    },
    Notification,
    createApplicationMenuTemplate: (options) => options,
    getActiveWorkspacePath: () => workspacePath,
    getIsDevelopment: () => true,
    getMainWindow: () => ({ isFocused: () => focused }),
    isApplicationMenuCommand: (command) => command === 'workspace.open',
    log: (...entry) => logs.push(entry),
    sendToRenderer: (...entry) => sent.push(entry),
  })

  return {
    installedMenus,
    logs,
    notifications,
    runtime,
    sent,
    setFocused: (value) => { focused = value },
    setSupported: (value) => { supported = value },
    setWorkspacePath: (value) => { workspacePath = value },
    templates,
  }
}

test('possiede contesto menu, dispatch e feedback preferenze senza duplicare il messaggio', () => {
  const fixture = createFixture()
  fixture.setWorkspacePath('/tmp/workspace')
  fixture.runtime.setActiveAppSection('editor')
  fixture.runtime.createMenu()

  assert.equal(fixture.templates.length, 1)
  assert.deepEqual(fixture.templates[0], {
    activeSection: 'editor',
    hasWorkspace: true,
    isDevelopment: true,
    onCommand: fixture.runtime.dispatchApplicationMenuCommand,
  })
  assert.equal(fixture.installedMenus.length, 1)

  fixture.runtime.dispatchApplicationMenuCommand('workspace.open')
  fixture.runtime.dispatchApplicationMenuCommand('unknown')
  assert.deepEqual(fixture.sent, [['appMenu:command', 'workspace.open']])
  assert.deepEqual(fixture.logs, [['warn', 'application_menu_command_rejected']])

  const snapshot = { recovery: { correlationId: 'ERR-A1B2C3', globalCount: 2, workspaceCount: 1 } }
  assert.equal(fixture.runtime.reportPreferenceRecovery(snapshot), snapshot)
  assert.deepEqual(fixture.logs.at(-1), ['warning', 'preferences_recovered', {
    category: 'persistence',
    code: 'PERSISTENCE_PREFERENCES_CORRUPT',
    component: 'settings',
    correlationId: 'ERR-A1B2C3',
    globalCount: 2,
    operation: 'load-preferences',
    severity: 'warning',
    workspaceCount: 1,
  }])
})

test('notifica soltanto quando la finestra è in background e il sistema lo supporta', () => {
  const fixture = createFixture()
  fixture.runtime.notifyWhenBackground('Titolo', 'Corpo')
  fixture.setFocused(true)
  fixture.runtime.notifyWhenBackground('Ignora', 'Focus')
  fixture.setFocused(false)
  fixture.setSupported(false)
  fixture.runtime.notifyWhenBackground('Ignora', 'Non supportata')

  assert.deepEqual(fixture.notifications, [{ title: 'Titolo', body: 'Corpo' }])
})
