import { useLayoutEffect, type Dispatch, type SetStateAction } from 'react'
import type { EditorFailure } from '../model/editor-runtime.types'
import type { EditorTabStore } from './use-editor-tab-store'

type EditorWorkspaceResetOptions = {
  clearProjectIdentityMutations: () => void
  setExplorerFailure: Dispatch<SetStateAction<EditorFailure | null>>
  store: EditorTabStore
  workspace: string
}

export function useEditorWorkspaceReset({
  clearProjectIdentityMutations,
  setExplorerFailure,
  store,
  workspace,
}: EditorWorkspaceResetOptions) {
  const {
    activationIntentRef,
    autoSaveTimersRef,
    fileConflictsRef,
    fileRecoveryIdsRef,
    setDocumentFailure,
    setFileConflicts,
    workspaceRef,
  } = store

  useLayoutEffect(() => {
    if (workspaceRef.current === workspace) return
    workspaceRef.current = workspace
    activationIntentRef.current += 1
    for (const pending of autoSaveTimersRef.current.values()) window.clearTimeout(pending.timer)
    autoSaveTimersRef.current.clear()
    clearProjectIdentityMutations()
    fileRecoveryIdsRef.current.clear()
    fileConflictsRef.current = new Map()
    setFileConflicts(new Map())
    setExplorerFailure(null)
    setDocumentFailure(null)
  }, [activationIntentRef, autoSaveTimersRef, clearProjectIdentityMutations, fileConflictsRef, fileRecoveryIdsRef, setDocumentFailure, setExplorerFailure, setFileConflicts, workspace, workspaceRef])
}
