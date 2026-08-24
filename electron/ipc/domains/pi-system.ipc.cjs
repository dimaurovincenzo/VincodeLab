const { IPC_CHANNELS, PI_SYSTEM_INVOKE_CHANNELS } = require('../channels.cjs')

function createPiSystemHandlers({
  assertTrustedSender,
  getPiSystemStatus,
  installPiPackage,
  listPiPackageSkills,
  listPiPackages,
  piAgentRoot,
  reconcileManagedPiPackages,
  removePiPackage,
  resolvePiExecutable,
  runExternalMutation,
  updatePiPackage,
}) {
  return new Map([
    [IPC_CHANNELS.PI_SYSTEM_STATUS, (event) => {
      assertTrustedSender(event)
      return getPiSystemStatus(resolvePiExecutable)
    }],
    [IPC_CHANNELS.PI_SYSTEM_LIST, (event) => {
      assertTrustedSender(event)
      return listPiPackages(resolvePiExecutable)
    }],
    [IPC_CHANNELS.PI_SYSTEM_LIST_SKILLS, (event) => {
      assertTrustedSender(event)
      return listPiPackageSkills(resolvePiExecutable)
    }],
    [IPC_CHANNELS.PI_SYSTEM_INSTALL, (event, source) => runExternalMutation(
      event,
      'pi-system:install',
      null,
      async () => {
        const result = await installPiPackage(source, resolvePiExecutable)
        await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot)
        return result
      },
    )],
    [IPC_CHANNELS.PI_SYSTEM_UPDATE, (event, source) => runExternalMutation(
      event,
      'pi-system:update',
      null,
      async () => {
        const result = await updatePiPackage(source, resolvePiExecutable)
        await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot)
        return result
      },
    )],
    [IPC_CHANNELS.PI_SYSTEM_REMOVE, (event, source) => runExternalMutation(
      event,
      'pi-system:remove',
      null,
      () => removePiPackage(source, resolvePiExecutable),
    )],
  ])
}

function registerPiSystemIpc({ ipcMain, ...dependencies }) {
  const handlers = createPiSystemHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: PI_SYSTEM_INVOKE_CHANNELS })
}

module.exports = {
  PI_SYSTEM_INVOKE_CHANNELS,
  createPiSystemHandlers,
  registerPiSystemIpc,
}
