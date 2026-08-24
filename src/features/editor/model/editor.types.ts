import type { RemoteTrackedFile, WorkspaceSessionState } from '@/bridge'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

export type EditorPreview = 'image' | 'pdf' | 'csv' | 'markdown'

export type RemoteOpenRequest = { id: string; nonce: number }

export type EditorWorkbenchRequest =
  | { kind: 'open-file'; fileId: string; nonce: number }
  | { kind: 'focus-editor' | 'focus-explorer' | 'close-active' | 'next-tab' | 'previous-tab'; nonce: number }

export type EditorWorkbenchContext = {
  activeFileId: string | null
  activeFileName: string | null
  dirty: boolean
  source: 'workspace' | 'remote' | null
  selection: { fromLine: number; toLine: number } | null
}

export type RemoteEditorFile = {
  file: RemoteTrackedFile
  connectionTitle: string
  binary: boolean
}

export type EditorTab = {
  id: string
  name: string
  content: string
  savedContent: string
  revision: number
  savedRevision: number
  instance: number
  source: 'workspace' | 'remote'
  diskRevision?: string
  restoredExternalConflict?: boolean
  preview?: EditorPreview
  remote?: RemoteEditorFile
}

export type EditorTreeNode =
  | { kind: 'root'; value: 'editor:root'; name: string; children: EditorTreeNode[] }
  | { kind: 'file'; value: string; id: string; name: string }
  | { kind: 'directory'; value: string; id: string; name: string; loaded: boolean; children?: EditorTreeNode[] }
  | { kind: 'new-file'; value: string; name: string; directoryId: string }

export type ProjectEditorProps = {
  workspace: string
  initialState?: WorkspaceSessionState['editor']
  remoteOpenRequest?: RemoteOpenRequest | null
  workbenchRequest?: EditorWorkbenchRequest | null
  onContextChange?: (context: EditorWorkbenchContext) => void
  onOpenGitDiff?: (fileId: string) => void
  onSendContextToAi?: (includeSelection: boolean) => void
  onSessionChange?: (state: WorkspaceSessionState['editor']) => void
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}
