import type { TerminalAttachment } from './terminal.types'

export interface ProjectFileTreeNode {
  id: string
  name: string
  kind: 'file' | 'directory'
  children?: ProjectFileTreeNode[]
}

export interface ProjectFileReadResult {
  id: string
  name: string
  content: string
  revision: string
  size: number
}

export interface ProjectFileSaveResult {
  id: string
  revision: string
  size: number
}

export interface ProjectFileIndexEntry {
  id: string
  name: string
  directory: string
  extension: string
  size: number
  modifiedAt: number
}

export interface ProjectFileIndexResult {
  state: 'ready'
  workspacePath: string
  generation: number
  files: ProjectFileIndexEntry[]
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

export interface ProjectFileIndexStatus {
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

export interface ProjectFileContentMatch {
  fileId: string
  fileName: string
  directory: string
  line: number
  column: number
  preview: string
}

export interface ProjectFileContentSearchResult {
  cancelled: boolean
  filesSearched: number
  matches: ProjectFileContentMatch[]
  skippedFiles: number
  truncated: boolean
}

export type FilesApi = {
  list: () => Promise<{ entries: ProjectFileTreeNode[]; truncated: boolean }>
  listDirectory: (directoryId: string) => Promise<{ entries: ProjectFileTreeNode[]; truncated: boolean }>
  index: (options?: { force?: boolean }) => Promise<ProjectFileIndexResult>
  indexStatus: () => Promise<ProjectFileIndexStatus | null>
  read: (fileId: string) => Promise<ProjectFileReadResult>
  searchContent: (query: string, options?: { maxResults?: number }) => Promise<ProjectFileContentSearchResult>
  preview: (fileId: string) => Promise<{ id: string; name: string; kind: 'image' | 'pdf'; content: string; size: number }>
  prepareAttachment: (fileId: string) => Promise<TerminalAttachment>
  create: (directoryId: string, fileName: string) => Promise<ProjectFileReadResult>
  createDirectory: (parentId: string, directoryName: string) => Promise<{ id: string; kind: 'directory'; name: string }>
  rename: (entryId: string, entryName: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; previousId: string; renamed: boolean }>
  duplicate: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; name: string; sourceId: string }>
  trash: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; trashed: true }>
  save: (fileId: string, content: string, options: { revision?: string; force?: boolean }) => Promise<ProjectFileSaveResult>
}
