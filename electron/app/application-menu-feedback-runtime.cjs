const { IPC_CHANNELS } = require('../ipc/channels.cjs')
function createApplicationMenuFeedbackRuntime({
  Menu,
  Notification,
  createApplicationMenuTemplate,
  getActiveWorkspacePath,
  getIsDevelopment,
  getMainWindow,
  isApplicationMenuCommand,
  log,
  sendToRenderer,
}) {
  let activeAppSection = 'home'

  function reportPreferenceRecovery(snapshot) {
    if (!snapshot?.recovery) return snapshot
    log('warning', 'preferences_recovered', {
      category: 'persistence',
      code: 'PERSISTENCE_PREFERENCES_CORRUPT',
      component: 'settings',
      correlationId: snapshot.recovery.correlationId,
      globalCount: snapshot.recovery.globalCount,
      operation: 'load-preferences',
      severity: 'warning',
      workspaceCount: snapshot.recovery.workspaceCount,
    })
    return snapshot
  }

  function dispatchApplicationMenuCommand(command) {
    if (!isApplicationMenuCommand(command)) {
      log('warn', 'application_menu_command_rejected')
      return
    }
    sendToRenderer(IPC_CHANNELS.APP_MENU_COMMAND, command)
  }

  function notifyWhenBackground(title, body) {
    const window = getMainWindow()
    if (!window || window.isFocused() || !Notification.isSupported()) return
    new Notification({ title, body }).show()
  }

  function createMenu() {
    const menu = Menu.buildFromTemplate(createApplicationMenuTemplate({
      activeSection: activeAppSection,
      hasWorkspace: Boolean(getActiveWorkspacePath()),
      isDevelopment: getIsDevelopment(),
      onCommand: dispatchApplicationMenuCommand,
    }))
    Menu.setApplicationMenu(menu)
  }

  return {
    createMenu,
    dispatchApplicationMenuCommand,
    getActiveAppSection: () => activeAppSection,
    notifyWhenBackground,
    reportPreferenceRecovery,
    setActiveAppSection: (section) => { activeAppSection = section },
  }
}

module.exports = { createApplicationMenuFeedbackRuntime }
