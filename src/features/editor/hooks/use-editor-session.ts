import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { previewKindForFile, sessionFileRef } from '../model/editor-document'
import type { EditorTab, ProjectEditorProps } from '../model/editor.types'

type EditorSessionOptions = {
  activeId: string | null
  activeIdRef: MutableRefObject<string | null>
  activationIntentRef: MutableRefObject<number>
  collectFileViews: (tabs: EditorTab[]) => WorkspaceSessionFileView[]
  expanded: Set<string>
  initialState: ProjectEditorProps['initialState']
  onSessionChange: ProjectEditorProps['onSessionChange']
  openFile: (fileId: string, focusAfterOpen?: boolean, activateAfterOpen?: boolean) => Promise<void>
  openRemoteFile: (fileId: string, focusAfterOpen?: boolean, activateAfterOpen?: boolean) => Promise<void>
  restoreActiveFileView: (tab: EditorTab, storedView: WorkspaceSessionFileView) => void
  restoreFileView: (tab: EditorTab, storedView: WorkspaceSessionFileView) => void
  sessionRevision: number
  setActiveId: Dispatch<SetStateAction<string | null>>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  setTabs: Dispatch<SetStateAction<EditorTab[]>>
  tabs: EditorTab[]
  tabsRef: MutableRefObject<EditorTab[]>
}

export function useEditorSession({
  activeId,
  activeIdRef,
  activationIntentRef,
  collectFileViews,
  expanded,
  initialState,
  onSessionChange,
  openFile,
  openRemoteFile,
  restoreActiveFileView,
  restoreFileView,
  sessionRevision,
  setActiveId,
  setExpanded,
  setTabs,
  tabs,
  tabsRef,
}: EditorSessionOptions) {
  const restoredSessionRef = useRef<WorkspaceSessionState['editor'] | null>(null)
  const restoringSessionRef = useRef(false)
  const [restoreReady, setRestoreReady] = useState(() => !initialState)
  const tabSignature = useMemo(() => tabs.map((tab) => {
    const file = sessionFileRef(tab)
    return `${file.source}:${file.id}:${file.mode}`
  }).join('\0'), [tabs])

  useEffect(() => {
    if (!initialState) return
    if (restoredSessionRef.current === initialState) {
      if (!restoringSessionRef.current) queueMicrotask(() => setRestoreReady(true))
      return
    }
    restoredSessionRef.current = initialState
    restoringSessionRef.current = true
    const restoreActivationIntent = activationIntentRef.current
    let cancelled = false
    setRestoreReady(false)

    void (async () => {
      setExpanded(new Set(initialState.expandedDirectoryIds))
      for (const file of initialState.openFiles) {
        if (cancelled) return
        if (file.source === 'workspace') await openFile(file.id, false, false)
        else await openRemoteFile(file.id, false, false)
        if (!file.mode) continue
        const tabId = file.source === 'workspace' ? file.id : `remote:${file.id}`
        const tab = tabsRef.current.find((entry) => entry.id === tabId)
        if (!tab) continue
        const previewKind = previewKindForFile(tab.name)
        if (previewKind !== 'csv' && previewKind !== 'markdown') continue
        const preview = file.mode === 'preview' ? previewKind : undefined
        if (tab.preview === preview) continue
        const nextTabs = tabsRef.current.map((entry) => entry.id === tabId ? { ...entry, preview } : entry)
        tabsRef.current = nextTabs
        setTabs(nextTabs)
      }
      if (cancelled) return

      for (const storedView of initialState.fileViews) {
        const tabId = storedView.source === 'workspace' ? storedView.id : `remote:${storedView.id}`
        const tab = tabsRef.current.find((entry) => entry.id === tabId)
        if (tab) restoreFileView(tab, storedView)
      }

      const activeFile = initialState.activeFile
      const activeTabId = activeFile ? (activeFile.source === 'workspace' ? activeFile.id : `remote:${activeFile.id}`) : null
      const restoredActiveId = activationIntentRef.current === restoreActivationIntent
        ? (activeTabId && tabsRef.current.some((tab) => tab.id === activeTabId) ? activeTabId : tabsRef.current.at(-1)?.id ?? null)
        : activeIdRef.current
      activeIdRef.current = restoredActiveId
      setActiveId(restoredActiveId)
      restoringSessionRef.current = false
      setRestoreReady(true)

      window.setTimeout(() => {
        if (cancelled || !restoredActiveId) return
        const tab = tabsRef.current.find((entry) => entry.id === restoredActiveId)
        if (!tab) return
        const storedId = tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id
        const storedView = initialState.fileViews.find((view) => view.source === tab.source && view.id === storedId)
        if (storedView) restoreActiveFileView(tab, storedView)
      }, 0)
    })()

    return () => { cancelled = true; restoringSessionRef.current = false }
  }, [activeIdRef, activationIntentRef, initialState, openFile, openRemoteFile, restoreActiveFileView, restoreFileView, setActiveId, setExpanded, setTabs, tabsRef])

  useEffect(() => {
    if (!onSessionChange || !restoreReady || restoringSessionRef.current) return
    const openTabs = tabsRef.current
    const activeTab = openTabs.find((tab) => tab.id === activeIdRef.current) ?? null
    onSessionChange({
      openFiles: openTabs.map(sessionFileRef),
      activeFile: activeTab ? sessionFileRef(activeTab) : null,
      expandedDirectoryIds: [...expanded],
      fileViews: collectFileViews(openTabs),
    })
  }, [activeId, activeIdRef, collectFileViews, expanded, onSessionChange, restoreReady, sessionRevision, tabSignature, tabsRef])

  return { restoreReady }
}
