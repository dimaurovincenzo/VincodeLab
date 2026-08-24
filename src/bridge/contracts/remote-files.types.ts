export interface RemoteEntry {
  id: string
  name: string
  kind: 'file' | 'directory' | 'link' | 'unknown'
  displayPath: string
  size: number | null
  modifiedAt: number | null
  mode: number | null
  destructiveAllowed: boolean
}

export interface RemoteTrackedFile {
  id: string
  connectionId: string
  name: string
  remotePath: string
  localState: 'synced' | 'modified' | 'conflict' | 'offline'
  size: number | null
  cacheSize: number
  modifiedAt: number | null
  mode: number | null
  baselineHash: string
  localHash: string
  lastError: string | null
  updatedAt: number
}

export interface RemoteTransfer {
  id: string
  direction: 'download' | 'upload'
  name: string
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
  bytes: number | null
  total: number | null
  error?: string
}

export interface RemoteCompareResult {
  baselineChanged: boolean
  binary: boolean
  remoteHash: string
  baselineHash: string
  localHash: string
  remoteContent?: string
  localContent?: string
}

export type RemoteFilesApi = {
  browse: (connectionId: string, directoryId?: string | null) => Promise<{ path: string; entries: RemoteEntry[] }>
  downloadAndTrack: (entryId: string) => Promise<RemoteTrackedFile>
  downloadAs: (entryId: string) => Promise<{ saved: boolean }>
  read: (fileId: string) => Promise<{ file: RemoteTrackedFile; content: string }>
  preview: (fileId: string) => Promise<{ file: RemoteTrackedFile; binary: boolean; size: number }>
  saveLocal: (fileId: string, content: string) => Promise<RemoteTrackedFile>
  compare: (fileId: string) => Promise<RemoteCompareResult>
  upload: (fileId: string, options?: { force?: boolean }) => Promise<{ status: 'synced' | 'conflict'; uploaded: boolean; file?: RemoteTrackedFile }>
  chooseAndUpload: (connectionId: string, directoryId?: string | null) => Promise<Array<{ name: string; uploaded: true }>>
  cancelTransfer: (transferId: string) => Promise<{ cancelled: boolean }>
  createDirectory: (connectionId: string, parentId: string | null, name: string) => Promise<{ created: true }>
  rename: (entryId: string, name: string) => Promise<{ renamed: true }>
  remove: (entryId: string) => Promise<{ removed: true }>
  discard: (fileId: string, options?: { force?: boolean }) => Promise<{ removed: true }>
  listTracked: () => Promise<RemoteTrackedFile[]>
  revealLocal: (fileId: string) => Promise<{ revealed: true }>
  cleanup: (options?: { olderThan?: number }) => Promise<{ removed: number }>
  onTransfer: (listener: (transfer: RemoteTransfer) => void) => () => void
}
