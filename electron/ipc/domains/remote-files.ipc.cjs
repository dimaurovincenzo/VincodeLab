const REMOTE_FILES_INVOKE_CHANNELS = Object.freeze([
  'remoteFiles:browse',
  'remoteFiles:downloadAndTrack',
  'remoteFiles:downloadAs',
  'remoteFiles:read',
  'remoteFiles:preview',
  'remoteFiles:saveLocal',
  'remoteFiles:compare',
  'remoteFiles:upload',
  'remoteFiles:chooseAndUpload',
  'remoteFiles:cancelTransfer',
  'remoteFiles:createDirectory',
  'remoteFiles:rename',
  'remoteFiles:remove',
  'remoteFiles:discard',
  'remoteFiles:listTracked',
  'remoteFiles:revealLocal',
  'remoteFiles:cleanup',
])

function createRemoteFilesHandlers({
  assertTrustedSender,
  getRemoteFileService,
  requireActiveWorkspace,
}) {
  return new Map([
    ['remoteFiles:browse', (event, connectionId, directoryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().browse(requireActiveWorkspace(), connectionId, directoryId)
    }],
    ['remoteFiles:downloadAndTrack', (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().downloadAndTrack(requireActiveWorkspace(), entryId)
    }],
    ['remoteFiles:downloadAs', (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().downloadAs(requireActiveWorkspace(), entryId)
    }],
    ['remoteFiles:read', (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().readLocal(requireActiveWorkspace(), fileId)
    }],
    ['remoteFiles:preview', (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().readPreview(requireActiveWorkspace(), fileId)
    }],
    ['remoteFiles:saveLocal', (event, fileId, content) => {
      assertTrustedSender(event)
      return getRemoteFileService().saveLocal(requireActiveWorkspace(), fileId, content)
    }],
    ['remoteFiles:compare', (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().compare(requireActiveWorkspace(), fileId)
    }],
    ['remoteFiles:upload', (event, fileId, options) => {
      assertTrustedSender(event)
      return getRemoteFileService().upload(requireActiveWorkspace(), fileId, options)
    }],
    ['remoteFiles:chooseAndUpload', (event, connectionId, directoryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().chooseAndUpload(requireActiveWorkspace(), connectionId, directoryId)
    }],
    ['remoteFiles:cancelTransfer', (event, transferId) => {
      assertTrustedSender(event)
      return { cancelled: getRemoteFileService().cancelTransfer(requireActiveWorkspace(), transferId) }
    }],
    ['remoteFiles:createDirectory', (event, connectionId, parentId, name) => {
      assertTrustedSender(event)
      return getRemoteFileService().createDirectory(requireActiveWorkspace(), connectionId, parentId, name)
    }],
    ['remoteFiles:rename', (event, entryId, name) => {
      assertTrustedSender(event)
      return getRemoteFileService().rename(requireActiveWorkspace(), entryId, name)
    }],
    ['remoteFiles:remove', (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().remove(requireActiveWorkspace(), entryId)
    }],
    ['remoteFiles:discard', (event, fileId, options) => {
      assertTrustedSender(event)
      return getRemoteFileService().discard(requireActiveWorkspace(), fileId, options)
    }],
    ['remoteFiles:listTracked', (event) => {
      assertTrustedSender(event)
      return getRemoteFileService().listTracked(requireActiveWorkspace())
    }],
    ['remoteFiles:revealLocal', (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().revealLocal(requireActiveWorkspace(), fileId)
    }],
    ['remoteFiles:cleanup', (event, options) => {
      assertTrustedSender(event)
      return getRemoteFileService().cleanup(requireActiveWorkspace(), options)
    }],
  ])
}

function registerRemoteFilesIpc({ ipcMain, ...dependencies }) {
  const handlers = createRemoteFilesHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: REMOTE_FILES_INVOKE_CHANNELS })
}

module.exports = {
  REMOTE_FILES_INVOKE_CHANNELS,
  createRemoteFilesHandlers,
  registerRemoteFilesIpc,
}
