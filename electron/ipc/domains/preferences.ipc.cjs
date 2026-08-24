const PREFERENCES_INVOKE_CHANNELS = Object.freeze([
  'preferences:get',
  'preferences:setGlobal',
  'preferences:setWorkspace',
  'preferences:clearWorkspace',
  'preferences:clearAllWorkspace',
])

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
    ['preferences:get', (event) => {
      assertTrustedSender(event)
      return readCurrentPreferences()
    }],
    ['preferences:setGlobal', (event, key, value) => {
      assertTrustedSender(event)
      setGlobalPreference(key, value)
      return readCurrentPreferences()
    }],
    ['preferences:setWorkspace', (event, key, value) => {
      assertTrustedSender(event)
      return reportPreferenceRecovery(setWorkspacePreference(requireActiveWorkspace(), key, value))
    }],
    ['preferences:clearWorkspace', (event, key) => {
      assertTrustedSender(event)
      return reportPreferenceRecovery(clearWorkspacePreference(requireActiveWorkspace(), key))
    }],
    ['preferences:clearAllWorkspace', (event) => {
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
