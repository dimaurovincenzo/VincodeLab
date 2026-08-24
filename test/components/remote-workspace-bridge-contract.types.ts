import type {
  ManagedSshApi,
  RemoteFilesApi,
  VincodeLabBridge,
  WorkspaceCommandsApi,
} from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedWorkspaceCommandKind = 'shell' | 'ssh'
interface ExpectedWorkspaceCommand {
  id: string
  categoryId: string
  title: string
  kind: ExpectedWorkspaceCommandKind
  command: string
  note: string
  sshDestination: string
  remoteRoot: string
}
interface ExpectedWorkspaceCommandCategory {
  id: string
  name: string
  commands: ExpectedWorkspaceCommand[]
}
interface ExpectedWorkspaceCommandInput {
  categoryId: string
  title: string
  kind: ExpectedWorkspaceCommandKind
  command: string
  note: string
  sshDestination: string
  remoteRoot: string
}
type ExpectedWorkspaceCommandsApi = {
  list: () => Promise<{ categories: ExpectedWorkspaceCommandCategory[] }>
  createCategory: (name: string) => Promise<{ id: string; name: string }>
  updateCategory: (categoryId: string, name: string) => Promise<{ id: string; name: string }>
  deleteCategory: (categoryId: string) => Promise<{ deleted: true }>
  create: (input: ExpectedWorkspaceCommandInput) => Promise<ExpectedWorkspaceCommand>
  update: (commandId: string, input: ExpectedWorkspaceCommandInput) => Promise<ExpectedWorkspaceCommand>
  move: (commandId: string, categoryId: string) => Promise<{ moved: true }>
  delete: (commandId: string) => Promise<{ deleted: true }>
  run: (commandId: string) => Promise<{ executed: true; managedConnectionId?: string }>
}

interface ExpectedManagedSshConnection {
  id: string
  commandId: string
  title: string
  destination: string
  remoteRoot: string
  state: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}
type ExpectedManagedSshApi = {
  list: () => Promise<ExpectedManagedSshConnection[]>
  check: (connectionId: string) => Promise<boolean>
  disconnect: (connectionId: string) => Promise<{ disconnected: true }>
  onStatus: (listener: (status: ExpectedManagedSshConnection) => void) => () => void
}

interface ExpectedRemoteEntry {
  id: string
  name: string
  kind: 'file' | 'directory' | 'link' | 'unknown'
  displayPath: string
  size: number | null
  modifiedAt: number | null
  mode: number | null
  destructiveAllowed: boolean
}
interface ExpectedRemoteTrackedFile {
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
interface ExpectedRemoteTransfer {
  id: string
  direction: 'download' | 'upload'
  name: string
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'
  bytes: number | null
  total: number | null
  error?: string
}
interface ExpectedRemoteCompareResult {
  baselineChanged: boolean
  binary: boolean
  remoteHash: string
  baselineHash: string
  localHash: string
  remoteContent?: string
  localContent?: string
}
type ExpectedRemoteFilesApi = {
  browse: (connectionId: string, directoryId?: string | null) => Promise<{ path: string; entries: ExpectedRemoteEntry[] }>
  downloadAndTrack: (entryId: string) => Promise<ExpectedRemoteTrackedFile>
  downloadAs: (entryId: string) => Promise<{ saved: boolean }>
  read: (fileId: string) => Promise<{ file: ExpectedRemoteTrackedFile; content: string }>
  preview: (fileId: string) => Promise<{ file: ExpectedRemoteTrackedFile; binary: boolean; size: number }>
  saveLocal: (fileId: string, content: string) => Promise<ExpectedRemoteTrackedFile>
  compare: (fileId: string) => Promise<ExpectedRemoteCompareResult>
  upload: (fileId: string, options?: { force?: boolean }) => Promise<{ status: 'synced' | 'conflict'; uploaded: boolean; file?: ExpectedRemoteTrackedFile }>
  chooseAndUpload: (connectionId: string, directoryId?: string | null) => Promise<Array<{ name: string; uploaded: true }>>
  cancelTransfer: (transferId: string) => Promise<{ cancelled: boolean }>
  createDirectory: (connectionId: string, parentId: string | null, name: string) => Promise<{ created: true }>
  rename: (entryId: string, name: string) => Promise<{ renamed: true }>
  remove: (entryId: string) => Promise<{ removed: true }>
  discard: (fileId: string, options?: { force?: boolean }) => Promise<{ removed: true }>
  listTracked: () => Promise<ExpectedRemoteTrackedFile[]>
  revealLocal: (fileId: string) => Promise<{ revealed: true }>
  cleanup: (options?: { olderThan?: number }) => Promise<{ removed: number }>
  onTransfer: (listener: (transfer: ExpectedRemoteTransfer) => void) => () => void
}

export type RemoteWorkspaceBridgeContractAssertions = [
  Expect<Equal<WorkspaceCommandsApi, ExpectedWorkspaceCommandsApi>>,
  Expect<Equal<VincodeLabBridge['workspaceCommands'], WorkspaceCommandsApi>>,
  Expect<Equal<keyof WorkspaceCommandsApi,
    | 'list'
    | 'createCategory'
    | 'updateCategory'
    | 'deleteCategory'
    | 'create'
    | 'update'
    | 'move'
    | 'delete'
    | 'run'
  >>,
  Expect<Equal<ManagedSshApi, ExpectedManagedSshApi>>,
  Expect<Equal<VincodeLabBridge['managedSsh'], ManagedSshApi>>,
  Expect<Equal<keyof ManagedSshApi, 'list' | 'check' | 'disconnect' | 'onStatus'>>,
  Expect<Equal<RemoteFilesApi, ExpectedRemoteFilesApi>>,
  Expect<Equal<VincodeLabBridge['remoteFiles'], RemoteFilesApi>>,
  Expect<Equal<keyof RemoteFilesApi,
    | 'browse'
    | 'downloadAndTrack'
    | 'downloadAs'
    | 'read'
    | 'preview'
    | 'saveLocal'
    | 'compare'
    | 'upload'
    | 'chooseAndUpload'
    | 'cancelTransfer'
    | 'createDirectory'
    | 'rename'
    | 'remove'
    | 'discard'
    | 'listTracked'
    | 'revealLocal'
    | 'cleanup'
    | 'onTransfer'
  >>,
]

// @ts-expect-error Il tipo comando deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceCommandKindContractMustNotBeGlobal = WorkspaceCommandKind
// @ts-expect-error Il comando deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceCommandContractMustNotBeGlobal = WorkspaceCommand
// @ts-expect-error La categoria deve essere importata dal bridge, non dichiarata globalmente.
export type WorkspaceCommandCategoryContractMustNotBeGlobal = WorkspaceCommandCategory
// @ts-expect-error L’input comando deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceCommandInputContractMustNotBeGlobal = WorkspaceCommandInput
// @ts-expect-error La connessione SSH deve essere importata dal bridge, non dichiarata globalmente.
export type ManagedSshConnectionContractMustNotBeGlobal = ManagedSshConnection
// @ts-expect-error L’entry remota deve essere importata dal bridge, non dichiarata globalmente.
export type RemoteEntryContractMustNotBeGlobal = RemoteEntry
// @ts-expect-error Il file remoto tracciato deve essere importato dal bridge, non dichiarato globalmente.
export type RemoteTrackedFileContractMustNotBeGlobal = RemoteTrackedFile
// @ts-expect-error Il trasferimento remoto deve essere importato dal bridge, non dichiarato globalmente.
export type RemoteTransferContractMustNotBeGlobal = RemoteTransfer
// @ts-expect-error Il confronto remoto deve essere importato dal bridge, non dichiarato globalmente.
export type RemoteCompareResultContractMustNotBeGlobal = RemoteCompareResult
