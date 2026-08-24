const { IPC_CHANNELS, RUNTIME_INVOKE_CHANNELS } = require('../channels.cjs')

function createRuntimeHandlers({
  assertTrustedSender,
  cleanMachineSmokeMode = false,
  getPtyStatus,
  getRuntimeCapabilities,
  resolvePiExecutable,
}) {
  return new Map([
    [IPC_CHANNELS.RUNTIME_CAPABILITIES, (event) => {
      assertTrustedSender(event)
      return getRuntimeCapabilities({
        piExecutable: resolvePiExecutable(),
        ptyStatus: getPtyStatus(),
        systemToolSearchOptions: cleanMachineSmokeMode
          ? { includeCommonDirectories: false, includeNvm: false }
          : undefined,
      })
    }],
  ])
}

function registerRuntimeIpc({ ipcMain, ...dependencies }) {
  const handlers = createRuntimeHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: RUNTIME_INVOKE_CHANNELS })
}

module.exports = { RUNTIME_INVOKE_CHANNELS, createRuntimeHandlers, registerRuntimeIpc }
