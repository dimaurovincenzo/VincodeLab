const { IPC_CHANNELS, UPDATES_INVOKE_CHANNELS } = require('../channels.cjs')

function createUpdatesHandlers({
  activatePendingUpdates,
  assertTrustedSender,
  checkUpdates,
  downloadAllUpdates,
  listManagedUpdates,
  rollbackManagedUpdate,
  runExternalMutation,
  setManagedUpdatePolicy,
  stageManagedUpdate,
}) {
  return new Map([
    [IPC_CHANNELS.UPDATES_LIST, (event) => {
      assertTrustedSender(event)
      return listManagedUpdates()
    }],
    [IPC_CHANNELS.UPDATES_CHECK, (event, id) => {
      assertTrustedSender(event)
      return checkUpdates(id ?? null, { force: true })
    }],
    [IPC_CHANNELS.UPDATES_DOWNLOAD, (event, id) => runExternalMutation(
      event,
      IPC_CHANNELS.UPDATES_DOWNLOAD,
      null,
      () => stageManagedUpdate(id),
    )],
    [IPC_CHANNELS.UPDATES_DOWNLOAD_ALL, (event) => runExternalMutation(
      event,
      'updates:download-all',
      null,
      () => downloadAllUpdates(),
    )],
    [IPC_CHANNELS.UPDATES_SET_POLICY, (event, id, policy) => {
      assertTrustedSender(event)
      return setManagedUpdatePolicy(id, policy)
    }],
    [IPC_CHANNELS.UPDATES_ROLLBACK, (event, id) => runExternalMutation(
      event,
      IPC_CHANNELS.UPDATES_ROLLBACK,
      null,
      () => rollbackManagedUpdate(id),
    )],
    [IPC_CHANNELS.UPDATES_ACTIVATE_PENDING, (event) => runExternalMutation(
      event,
      'updates:activate',
      null,
      () => activatePendingUpdates(),
    )],
  ])
}

function registerUpdatesIpc({ ipcMain, ...dependencies }) {
  const handlers = createUpdatesHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: UPDATES_INVOKE_CHANNELS })
}

module.exports = { UPDATES_INVOKE_CHANNELS, createUpdatesHandlers, registerUpdatesIpc }
