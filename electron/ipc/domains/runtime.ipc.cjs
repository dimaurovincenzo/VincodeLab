const RUNTIME_INVOKE_CHANNELS = Object.freeze(['runtime:capabilities'])

function createRuntimeHandlers({
  assertTrustedSender,
  cleanMachineSmokeMode = false,
  getPtyStatus,
  getRuntimeCapabilities,
  resolvePiExecutable,
}) {
  return new Map([
    ['runtime:capabilities', (event) => {
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
