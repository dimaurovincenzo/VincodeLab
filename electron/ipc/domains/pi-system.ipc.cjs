const PI_SYSTEM_INVOKE_CHANNELS = Object.freeze([
  'piSystem:status',
  'piSystem:list',
  'piSystem:listSkills',
  'piSystem:install',
  'piSystem:update',
  'piSystem:remove',
])

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
    ['piSystem:status', (event) => {
      assertTrustedSender(event)
      return getPiSystemStatus(resolvePiExecutable)
    }],
    ['piSystem:list', (event) => {
      assertTrustedSender(event)
      return listPiPackages(resolvePiExecutable)
    }],
    ['piSystem:listSkills', (event) => {
      assertTrustedSender(event)
      return listPiPackageSkills(resolvePiExecutable)
    }],
    ['piSystem:install', (event, source) => runExternalMutation(
      event,
      'pi-system:install',
      null,
      async () => {
        const result = await installPiPackage(source, resolvePiExecutable)
        await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot)
        return result
      },
    )],
    ['piSystem:update', (event, source) => runExternalMutation(
      event,
      'pi-system:update',
      null,
      async () => {
        const result = await updatePiPackage(source, resolvePiExecutable)
        await reconcileManagedPiPackages(resolvePiExecutable, piAgentRoot)
        return result
      },
    )],
    ['piSystem:remove', (event, source) => runExternalMutation(
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
