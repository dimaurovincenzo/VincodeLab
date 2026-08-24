import { useEffect, useRef, useState } from 'react'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import type { EditorAutoSaveTimer, EditorFailure, EditorFileConflict } from '../model/editor-runtime.types'
import type { EditorTab } from '../model/editor.types'

export function useEditorTabStore(workspace: string) {
  const saveActiveRef = useRef<() => Promise<void>>(async () => undefined)
  const tabsRef = useRef<EditorTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  const workspaceRef = useRef(workspace)
  const editorAliveRef = useRef(true)
  const activationIntentRef = useRef(0)
  const nextTabInstanceRef = useRef(0)
  const openFileRequestsRef = useRef(new Map<string, Promise<EditorTab>>())
  const saveJobsRef = useRef(new Map<string, Promise<void>>())
  const savingCountsRef = useRef(new Map<string, number>())
  const autoSaveTimersRef = useRef(new Map<string, EditorAutoSaveTimer>())
  const fileRecoveryIdsRef = useRef(new Set<string>())
  const fileConflictsRef = useRef(new Map<string, EditorFileConflict>())
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)
  const [savingFileIds, setSavingFileIds] = useState<Set<string>>(new Set())
  const [fileConflicts, setFileConflicts] = useState<Map<string, EditorFileConflict>>(new Map())
  const [documentFailure, setDocumentFailure] = useState<EditorFailure | null>(null)
  const [remoteComparison, setRemoteComparison] = useState<RemoteCompareResult | null>(null)
  const [remoteDiffFile, setRemoteDiffFile] = useState<RemoteTrackedFile | null>(null)
  const [uploadingRemote, setUploadingRemote] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null

  useEffect(() => {
    editorAliveRef.current = true
    return () => {
      editorAliveRef.current = false
      activationIntentRef.current += 1
    }
  }, [])

  return {
    activationIntentRef,
    activeId,
    activeIdRef,
    activeTab,
    autoSaveTimersRef,
    confirmation,
    documentFailure,
    editorAliveRef,
    fileConflicts,
    fileConflictsRef,
    fileRecoveryIdsRef,
    loadingFile,
    nextTabInstanceRef,
    openFileRequestsRef,
    remoteComparison,
    remoteDiffFile,
    saveActiveRef,
    saveJobsRef,
    savingCountsRef,
    savingFileIds,
    setActiveId,
    setConfirmation,
    setDocumentFailure,
    setFileConflicts,
    setLoadingFile,
    setRemoteComparison,
    setRemoteDiffFile,
    setSavingFileIds,
    setTabs,
    setUploadingRemote,
    tabs,
    tabsRef,
    uploadingRemote,
    workspaceRef,
  }
}

export type EditorTabStore = ReturnType<typeof useEditorTabStore>
