const { IPC_CHANNELS, REMOTE_FILES_INVOKE_CHANNELS } = require('../channels.cjs')

function createRemoteFilesHandlers({
  assertTrustedSender,
  getRemoteFileService,
  requireActiveWorkspace,
}) {
  return new Map([
    [IPC_CHANNELS.REMOTE_FILES_BROWSE, (event, connectionId, directoryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().browse(requireActiveWorkspace(), connectionId, directoryId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AND_TRACK, (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().downloadAndTrack(requireActiveWorkspace(), entryId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AS, (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().downloadAs(requireActiveWorkspace(), entryId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_READ, (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().readLocal(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_PREVIEW, (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().readPreview(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_SAVE_LOCAL, (event, fileId, content) => {
      assertTrustedSender(event)
      return getRemoteFileService().saveLocal(requireActiveWorkspace(), fileId, content)
    }],
    [IPC_CHANNELS.REMOTE_FILES_COMPARE, (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().compare(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_UPLOAD, (event, fileId, options) => {
      assertTrustedSender(event)
      return getRemoteFileService().upload(requireActiveWorkspace(), fileId, options)
    }],
    [IPC_CHANNELS.REMOTE_FILES_CHOOSE_AND_UPLOAD, (event, connectionId, directoryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().chooseAndUpload(requireActiveWorkspace(), connectionId, directoryId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_CANCEL_TRANSFER, (event, transferId) => {
      assertTrustedSender(event)
      return { cancelled: getRemoteFileService().cancelTransfer(requireActiveWorkspace(), transferId) }
    }],
    [IPC_CHANNELS.REMOTE_FILES_CREATE_DIRECTORY, (event, connectionId, parentId, name) => {
      assertTrustedSender(event)
      return getRemoteFileService().createDirectory(requireActiveWorkspace(), connectionId, parentId, name)
    }],
    [IPC_CHANNELS.REMOTE_FILES_RENAME, (event, entryId, name) => {
      assertTrustedSender(event)
      return getRemoteFileService().rename(requireActiveWorkspace(), entryId, name)
    }],
    [IPC_CHANNELS.REMOTE_FILES_REMOVE, (event, entryId) => {
      assertTrustedSender(event)
      return getRemoteFileService().remove(requireActiveWorkspace(), entryId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_DISCARD, (event, fileId, options) => {
      assertTrustedSender(event)
      return getRemoteFileService().discard(requireActiveWorkspace(), fileId, options)
    }],
    [IPC_CHANNELS.REMOTE_FILES_LIST_TRACKED, (event) => {
      assertTrustedSender(event)
      return getRemoteFileService().listTracked(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.REMOTE_FILES_REVEAL_LOCAL, (event, fileId) => {
      assertTrustedSender(event)
      return getRemoteFileService().revealLocal(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.REMOTE_FILES_CLEANUP, (event, options) => {
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
