const APPEARANCE_INVOKE_CHANNELS = Object.freeze(['appearance:get', 'appearance:set'])

function createAppearanceHandlers({ assertTrustedSender, applyAppearance, getAppearance, setAppearance }) {
  return new Map([
    ['appearance:get', (event) => {
      assertTrustedSender(event)
      return getAppearance()
    }],
    ['appearance:set', (event, appearance) => {
      assertTrustedSender(event)
      const value = setAppearance(appearance)
      applyAppearance(value)
      return value
    }],
  ])
}

function registerAppearanceIpc({ ipcMain, ...dependencies }) {
  const handlers = createAppearanceHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: APPEARANCE_INVOKE_CHANNELS })
}

module.exports = { APPEARANCE_INVOKE_CHANNELS, createAppearanceHandlers, registerAppearanceIpc }
