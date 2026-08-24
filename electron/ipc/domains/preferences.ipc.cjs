const { IPC_CHANNELS, PREFERENCES_INVOKE_CHANNELS } = require('../channels.cjs')

function createPreferencesHandlers({
  assertTrustedSender,
  clearAllWorkspacePreferences,
  clearWorkspacePreference,
  getActiveWorkspacePath,
  getPreferences,
  reportPreferenceRecovery,
  requireActiveWorkspace,
  setGlobalPreference,
  setWorkspacePreference,
}) {
  const readCurrentPreferences = () => reportPreferenceRecovery(
    getPreferences(getActiveWorkspacePath() ?? null),
  )

  return new Map([
    [IPC_CHANNELS.PREFERENCES_GET, (event) => {
      assertTrustedSender(event)
      return readCurrentPreferences()
    }],
    [IPC_CHANNELS.PREFERENCES_SET_GLOBAL, (event, key, value) => {
      assertTrustedSender(event)
      setGlobalPreference(key, value)
      return readCurrentPreferences()
    }],
    [IPC_CHANNELS.PREFERENCES_SET_WORKSPACE, (event, key, value) => {
      assertTrustedSender(event)
      return reportPreferenceRecovery(setWorkspacePreference(requireActiveWorkspace(), key, value))
    }],
    [IPC_CHANNELS.PREFERENCES_CLEAR_WORKSPACE, (event, key) => {
      assertTrustedSender(event)
      return reportPreferenceRecovery(clearWorkspacePreference(requireActiveWorkspace(), key))
    }],
    [IPC_CHANNELS.PREFERENCES_CLEAR_ALL_WORKSPACE, (event) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      clearAllWorkspacePreferences(workspacePath)
      return reportPreferenceRecovery(getPreferences(workspacePath))
    }],
  ])
}

function registerPreferencesIpc({ ipcMain, ...dependencies }) {
  const handlers = createPreferencesHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: PREFERENCES_INVOKE_CHANNELS })
}

module.exports = {
  PREFERENCES_INVOKE_CHANNELS,
  createPreferencesHandlers,
  registerPreferencesIpc,
}
