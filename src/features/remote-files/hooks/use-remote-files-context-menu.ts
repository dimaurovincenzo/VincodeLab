import { useEffect } from 'react'
import { remoteFilesBridge } from '../api/remote-files.bridge'
import type { RemoteFilesContextAction } from '../model/remote-files.types'

type Options = {
  entries: RemoteEntry[]
  trackedFiles: RemoteTrackedFile[]
  transfers: Record<string, RemoteTransfer>
  canRetryTransfer: (transferId: string) => boolean
  cancelTransfer: (transfer: RemoteTransfer) => void
  copyRemotePath: (entry: RemoteEntry) => void
  copyTrackedRemotePath: (file: RemoteTrackedFile) => void
  downloadAs: (entry: RemoteEntry) => Promise<void>
  onOpenRemoteFile: (fileId: string) => void
  openEntry: (entry: RemoteEntry) => Promise<void>
  openRename: (entry: RemoteEntry) => void
  requestDelete: (entry: RemoteEntry) => void
  requestDiscard: (file: RemoteTrackedFile) => void
  retryTransfer: (transferId: string) => Promise<void>
  revealLocal: (file: RemoteTrackedFile) => void
}

export function useRemoteFilesContextMenu({
  entries,
  trackedFiles,
  transfers,
  canRetryTransfer,
  cancelTransfer,
  copyRemotePath,
  copyTrackedRemotePath,
  downloadAs,
  onOpenRemoteFile,
  openEntry,
  openRename,
  requestDelete,
  requestDiscard,
  retryTransfer,
  revealLocal,
}: Options) {
  useEffect(() => remoteFilesBridge.contextMenu.onAction((rawAction) => {
    // Il preload espone un union più ampio condiviso con gli altri menu nativi.
    const action = rawAction as RemoteFilesContextAction
    const entry = action.contextKind === 'remote-file' || action.contextKind === 'remote-directory'
      ? entries.find((candidate) => candidate.id === action.contextId)
      : undefined
    if (entry) {
      if (action.command === 'remote.downloadOpen') void openEntry(entry)
      else if (action.command === 'remote.downloadAs') void downloadAs(entry)
      else if (action.command === 'remote.openDirectory') void openEntry(entry)
      else if (action.command === 'remote.copyPath') copyRemotePath(entry)
      else if (action.command === 'remote.rename') openRename(entry)
      else if (action.command === 'remote.delete') requestDelete(entry)
      return
    }

    const localFile = action.contextKind === 'remote-local-file'
      ? trackedFiles.find((candidate) => candidate.id === action.contextId)
      : undefined
    if (localFile) {
      if (action.command === 'remoteLocal.open') onOpenRemoteFile(localFile.id)
      else if (action.command === 'remoteLocal.reveal') revealLocal(localFile)
      else if (action.command === 'remoteLocal.copyPath') copyTrackedRemotePath(localFile)
      else if (action.command === 'remoteLocal.discard') requestDiscard(localFile)
      return
    }

    const transfer = action.contextKind === 'remote-transfer' ? transfers[action.contextId] : undefined
    if (!transfer) return
    if (action.command === 'remoteTransfer.cancel' && transfer.state === 'running') cancelTransfer(transfer)
    else if (action.command === 'remoteTransfer.retry' && transfer.state === 'error' && canRetryTransfer(transfer.id)) void retryTransfer(transfer.id)
  }), [canRetryTransfer, cancelTransfer, copyRemotePath, copyTrackedRemotePath, downloadAs, entries, onOpenRemoteFile, openEntry, openRename, requestDelete, requestDiscard, retryTransfer, revealLocal, trackedFiles, transfers])
}
