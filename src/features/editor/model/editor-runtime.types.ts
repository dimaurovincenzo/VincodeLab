import type { Compartment } from '@codemirror/state'
import type { UserError } from '@/lib/user-error'
import type { EditorPreview } from './editor.types'

export type EditorFileConflict = { error: UserError; fileId: string; instance: number }

export type EditorFailureRecovery =
  | { kind: 'compare-remote' }
  | { kind: 'create-file'; fileName: string }
  | { kind: 'load-directory'; directoryId: string; directoryName: string }
  | { kind: 'open-remote-file'; fileId: string }
  | { kind: 'open-workspace-file'; fileId: string }
  | { kind: 'refresh-explorer' }
  | { kind: 'save-all' }
  | { kind: 'save-file'; fileId: string }
  | { kind: 'upload-remote'; force: boolean }

export type EditorFailure = { error: UserError; fileId?: string; recovery?: EditorFailureRecovery }

export type ProjectEntryDialogState = {
  busy: boolean
  entryId: string
  entryKind: 'file' | 'directory'
  error: UserError | null
  mode: 'rename' | 'new-directory'
  value: string
}

export type EditorCompartments = {
  fontSize: Compartment
  tabSize: Compartment
  wordWrap: Compartment
  documentMode: Compartment
}

export type EditorStateOwner = {
  key: string
  tabId: string
  preview?: EditorPreview
}

export type EditorScrollPosition = { left: number; top: number }
export type EditorAutoSaveTimer = { timer: number; revision: number; instance: number }
