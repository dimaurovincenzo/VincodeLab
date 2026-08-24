const { APPEARANCE_INVOKE_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

function createAppearanceHandlers({ assertTrustedSender, applyAppearance, getAppearance, setAppearance }) {
  return new Map([
    [IPC_CHANNELS.APPEARANCE_GET, (event) => {
      assertTrustedSender(event)
      return getAppearance()
    }],
    [IPC_CHANNELS.APPEARANCE_SET, (event, appearance) => {
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
