export type RemoteFilesProps = {
  active: boolean
  workspace: string
  preferredConnectionId: string | null
  onOpenRemoteFile: (fileId: string) => void
  onCreateSshProfile: () => void
  onConnectProfile: (commandId: string) => Promise<string | null>
}

export type RemoteDirectoryLocation = {
  id: string | null
  path: string
}

export type RemoteFilesContextAction = {
  command:
    | 'remote.downloadOpen'
    | 'remote.downloadAs'
    | 'remote.openDirectory'
    | 'remote.copyPath'
    | 'remote.rename'
    | 'remote.delete'
    | 'remoteLocal.open'
    | 'remoteLocal.reveal'
    | 'remoteLocal.copyPath'
    | 'remoteLocal.discard'
    | 'remoteTransfer.cancel'
    | 'remoteTransfer.retry'
  contextId: string
  contextKind: 'remote-file' | 'remote-directory' | 'remote-local-file' | 'remote-transfer'
}
