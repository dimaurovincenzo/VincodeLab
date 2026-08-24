const UPDATES_INVOKE_CHANNELS = Object.freeze([
  'updates:list',
  'updates:check',
  'updates:download',
  'updates:downloadAll',
  'updates:setPolicy',
  'updates:rollback',
  'updates:activatePending',
])

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
    ['updates:list', (event) => {
      assertTrustedSender(event)
      return listManagedUpdates()
    }],
    ['updates:check', (event, id) => {
      assertTrustedSender(event)
      return checkUpdates(id ?? null, { force: true })
    }],
    ['updates:download', (event, id) => runExternalMutation(
      event,
      'updates:download',
      null,
      () => stageManagedUpdate(id),
    )],
    ['updates:downloadAll', (event) => runExternalMutation(
      event,
      'updates:download-all',
      null,
      () => downloadAllUpdates(),
    )],
    ['updates:setPolicy', (event, id, policy) => {
      assertTrustedSender(event)
      return setManagedUpdatePolicy(id, policy)
    }],
    ['updates:rollback', (event, id) => runExternalMutation(
      event,
      'updates:rollback',
      null,
      () => rollbackManagedUpdate(id),
    )],
    ['updates:activatePending', (event) => runExternalMutation(
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
