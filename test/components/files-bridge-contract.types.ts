import type * as Bridge from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

interface ExpectedProjectFileTreeNode {
  id: string
  name: string
  kind: 'file' | 'directory'
  children?: ExpectedProjectFileTreeNode[]
}

interface ExpectedProjectFileReadResult {
  id: string
  name: string
  content: string
  revision: string
  size: number
}

interface ExpectedProjectFileSaveResult {
  id: string
  revision: string
  size: number
}

interface ExpectedProjectFileIndexEntry {
  id: string
  name: string
  directory: string
  extension: string
  size: number
  modifiedAt: number
}

interface ExpectedProjectFileIndexResult {
  state: 'ready'
  workspacePath: string
  generation: number
  files: ExpectedProjectFileIndexEntry[]
  fileCount: number
  directoriesVisited: number
  entriesScanned: number
  truncated: boolean
  maxFiles: number
  startedAt: number
  completedAt: number
  durationMs: number
  cacheHit: boolean
}

interface ExpectedProjectFileIndexStatus {
  state: 'indexing' | 'ready' | 'error' | 'cancelled'
  workspacePath: string
  generation: number
  filesIndexed: number
  directoriesVisited: number
  entriesScanned: number
  truncated: boolean
  maxFiles: number
  startedAt: number
  updatedAt: number
  completedAt?: number
  error?: { code: string }
}

interface ExpectedTerminalAttachment {
  absolutePath: string
  name: string
}

type ExpectedFilesApi = {
  list: () => Promise<{ entries: ExpectedProjectFileTreeNode[]; truncated: boolean }>
  listDirectory: (directoryId: string) => Promise<{ entries: ExpectedProjectFileTreeNode[]; truncated: boolean }>
  index: (options?: { force?: boolean }) => Promise<ExpectedProjectFileIndexResult>
  indexStatus: () => Promise<ExpectedProjectFileIndexStatus | null>
  read: (fileId: string) => Promise<ExpectedProjectFileReadResult>
  preview: (fileId: string) => Promise<{ id: string; name: string; kind: 'image' | 'pdf'; content: string; size: number }>
  prepareAttachment: (fileId: string) => Promise<ExpectedTerminalAttachment>
  create: (directoryId: string, fileName: string) => Promise<ExpectedProjectFileReadResult>
  createDirectory: (parentId: string, directoryName: string) => Promise<{ id: string; kind: 'directory'; name: string }>
  rename: (entryId: string, entryName: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; previousId: string; renamed: boolean }>
  duplicate: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; sourceId: string }>
  trash: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; trashed: true }>
  save: (fileId: string, content: string, options: { revision?: string; force?: boolean }) => Promise<ExpectedProjectFileSaveResult>
}

export type FilesBridgeContractAssertions = [
  Expect<Equal<Bridge.ProjectFileTreeNode, ExpectedProjectFileTreeNode>>,
  Expect<Equal<Bridge.ProjectFileReadResult, ExpectedProjectFileReadResult>>,
  Expect<Equal<Bridge.ProjectFileSaveResult, ExpectedProjectFileSaveResult>>,
  Expect<Equal<Bridge.ProjectFileIndexEntry, ExpectedProjectFileIndexEntry>>,
  Expect<Equal<Bridge.ProjectFileIndexResult, ExpectedProjectFileIndexResult>>,
  Expect<Equal<Bridge.ProjectFileIndexStatus, ExpectedProjectFileIndexStatus>>,
  Expect<Equal<Bridge.FilesApi, ExpectedFilesApi>>,
  Expect<Equal<Window['vincodeLab']['files'], Bridge.FilesApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['files'], Bridge.FilesApi>>,
  Expect<Equal<Awaited<ReturnType<Bridge.FilesApi['prepareAttachment']>>, Bridge.TerminalAttachment>>,
  Expect<Equal<keyof Bridge.FilesApi,
    | 'list'
    | 'listDirectory'
    | 'index'
    | 'indexStatus'
    | 'read'
    | 'preview'
    | 'prepareAttachment'
    | 'create'
    | 'createDirectory'
    | 'rename'
    | 'duplicate'
    | 'trash'
    | 'save'
  >>,
]

// @ts-expect-error L'albero file deve essere importato dal bridge, non dichiarato globalmente.
export type ProjectFileTreeNodeContractMustNotBeGlobal = ProjectFileTreeNode
// @ts-expect-error Il risultato read deve essere importato dal bridge, non dichiarato globalmente.
export type ProjectFileReadResultContractMustNotBeGlobal = ProjectFileReadResult
// @ts-expect-error Il risultato save deve essere importato dal bridge, non dichiarato globalmente.
export type ProjectFileSaveResultContractMustNotBeGlobal = ProjectFileSaveResult
// @ts-expect-error L'entry indice deve essere importata dal bridge, non dichiarata globalmente.
export type ProjectFileIndexEntryContractMustNotBeGlobal = ProjectFileIndexEntry
// @ts-expect-error Il risultato indice deve essere importato dal bridge, non dichiarato globalmente.
export type ProjectFileIndexResultContractMustNotBeGlobal = ProjectFileIndexResult
// @ts-expect-error Lo stato indice deve essere importato dal bridge, non dichiarato globalmente.
export type ProjectFileIndexStatusContractMustNotBeGlobal = ProjectFileIndexStatus
// @ts-expect-error L'API file deve essere importata dal bridge, non dichiarata globalmente.
export type FilesApiContractMustNotBeGlobal = FilesApi
