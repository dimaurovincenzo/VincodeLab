import { useCallback, useEffect } from 'react'
import { toast } from '@/components/ui'
import { discardVolatileDraft, readVolatileDraft, restoreVolatileDraft } from '@/lib/volatile-draft-store'
import { editorBridge } from '../api/editor.bridge'
import { editorDraftIdentity, previewKindForFile } from '../model/editor-document'
import type { EditorTab, ProjectEditorProps } from '../model/editor.types'
import { externalFileConflictCode, reportEditorFailure } from '../services/editor-error'
import type { EditorTabStore } from './use-editor-tab-store'

type EditorTabsOptions = {
  clearCodeMirrorFile: (fileId: string) => void
  clearFileConflict: (fileId: string, instance: number) => void
  focusEditor: () => void
  focusExplorer: () => void
  hasActiveProjectIdentityMutation: (entryId: string, entryKind: 'file' | 'directory') => boolean
  recordFileConflict: (tab: EditorTab, cause: unknown) => void
  remoteOpenRequest: ProjectEditorProps['remoteOpenRequest']
  store: EditorTabStore
  workspace: string
}

export function useEditorTabs({
  clearCodeMirrorFile,
  clearFileConflict,
  focusEditor,
  focusExplorer,
  hasActiveProjectIdentityMutation,
  recordFileConflict,
  remoteOpenRequest,
  store,
  workspace,
}: EditorTabsOptions) {
  const {
    activationIntentRef,
    activeIdRef,
    activeTab,
    autoSaveTimersRef,
    editorAliveRef,
    fileConflictsRef,
    nextTabInstanceRef,
    openFileRequestsRef,
    savingCountsRef,
    setActiveId,
    setConfirmation,
    setDocumentFailure,
    setLoadingFile,
    setTabs,
    tabsRef,
    workspaceRef,
  } = store

  const toggleTextPreview = useCallback(() => {
    if (!activeTab) return
    const preview = previewKindForFile(activeTab.name)
    if (preview !== 'csv' && preview !== 'markdown') return
    setTabs((current) => {
      const finalTabs = current.map((tab) => tab.id === activeTab.id ? { ...tab, preview: activeTab.preview ? undefined : preview } : tab)
      tabsRef.current = finalTabs
      return finalTabs
    })
  }, [activeTab, setTabs, tabsRef])

  const openFile = useCallback(async (fileId: string, focusAfterOpen = true, activateAfterOpen = true) => {
    const requestWorkspace = workspace
    const intent = activateAfterOpen ? ++activationIntentRef.current : activationIntentRef.current
    const activate = (tabId: string) => {
      if (!activateAfterOpen || !editorAliveRef.current || workspaceRef.current !== requestWorkspace || activationIntentRef.current !== intent) return
      activeIdRef.current = tabId
      setActiveId(tabId)
      if (focusAfterOpen) focusEditor()
    }
    const existing = tabsRef.current.find((tab) => tab.id === fileId)
    if (existing) {
      activate(existing.id)
      return
    }
    if (hasActiveProjectIdentityMutation(fileId, 'file')) {
      toast.info('Attendi la conclusione della modifica prima di aprire questo file.', { description: fileId })
      return
    }

    const requestKey = `workspace\0${requestWorkspace}\0${fileId}`
    let request = openFileRequestsRef.current.get(requestKey)
    const ownsRequest = !request
    if (!request) {
      setLoadingFile(fileId)
      request = (async () => {
        const previewKind = previewKindForFile(fileId)
        const file = previewKind === 'image' || previewKind === 'pdf'
          ? await editorBridge.files.preview(fileId)
          : await editorBridge.files.read(fileId)
        const draftIdentity = editorDraftIdentity(requestWorkspace, 'workspace', file.id)
        const volatileDraft = readVolatileDraft(draftIdentity)
        const restoredExternalConflict = Boolean(volatileDraft && volatileDraft.content !== file.content && volatileDraft.baseline !== file.content)
        // A recovered draft is intentionally not rebased when the disk changed:
        // the user must still choose how to resolve the external conflict.
        const content = restoredExternalConflict && volatileDraft
          ? volatileDraft.content
          : restoreVolatileDraft(draftIdentity, file.content)
        return {
          id: file.id,
          name: file.name,
          content,
          savedContent: file.content,
          revision: content === file.content ? 0 : 1,
          savedRevision: 0,
          instance: ++nextTabInstanceRef.current,
          source: 'workspace' as const,
          ...('revision' in file ? { diskRevision: file.revision } : {}),
          ...(restoredExternalConflict ? { restoredExternalConflict: true } : {}),
          ...(previewKind ? { preview: previewKind } : {}),
        }
      })()
      openFileRequestsRef.current.set(requestKey, request)
    }
    try {
      const opened = await request
      if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
      const installed = tabsRef.current.find((tab) => tab.id === opened.id) ?? opened
      if (!tabsRef.current.some((tab) => tab.id === installed.id)) {
        const next = [...tabsRef.current, installed]
        tabsRef.current = next
        setTabs(next)
      }
      setDocumentFailure((current) => current?.recovery?.kind === 'open-workspace-file' && current.recovery.fileId === fileId ? null : current)
      if (installed.restoredExternalConflict && !fileConflictsRef.current.has(installed.id)) {
        recordFileConflict(installed, Object.assign(
          new Error(`Il file è cambiato mentre le modifiche locali venivano recuperate. [${externalFileConflictCode}]`),
          { code: externalFileConflictCode },
        ))
      }
      activate(installed.id)
    } catch (error) {
      if (ownsRequest && editorAliveRef.current && workspaceRef.current === requestWorkspace) {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'filesystem',
            operation: 'open-workspace-file',
            title: 'File non aperto',
            fallbackDescription: 'Il file selezionato non è stato aperto. Gli altri tab e le modifiche già presenti restano disponibili.',
          }),
          fileId,
          recovery: { kind: 'open-workspace-file', fileId },
        })
      }
    } finally {
      if (ownsRequest && openFileRequestsRef.current.get(requestKey) === request) openFileRequestsRef.current.delete(requestKey)
      if (ownsRequest && editorAliveRef.current && workspaceRef.current === requestWorkspace) {
        setLoadingFile((current) => current === fileId ? null : current)
      }
    }
  }, [activationIntentRef, activeIdRef, editorAliveRef, fileConflictsRef, focusEditor, hasActiveProjectIdentityMutation, nextTabInstanceRef, openFileRequestsRef, recordFileConflict, setActiveId, setDocumentFailure, setLoadingFile, setTabs, tabsRef, workspace, workspaceRef])

  const openRemoteFile = useCallback(async (fileId: string, focusAfterOpen = true, activateAfterOpen = true) => {
    const requestWorkspace = workspace
    const intent = activateAfterOpen ? ++activationIntentRef.current : activationIntentRef.current
    const activate = (tabId: string) => {
      if (!activateAfterOpen || !editorAliveRef.current || workspaceRef.current !== requestWorkspace || activationIntentRef.current !== intent) return
      activeIdRef.current = tabId
      setActiveId(tabId)
      if (focusAfterOpen) focusEditor()
    }
    const existing = tabsRef.current.find((tab) => tab.source === 'remote' && tab.remote?.file.id === fileId)
    if (existing) {
      activate(existing.id)
      return
    }

    const loadingId = `remote:${fileId}`
    const requestKey = `remote\0${requestWorkspace}\0${fileId}`
    let request = openFileRequestsRef.current.get(requestKey)
    const ownsRequest = !request
    if (!request) {
      setLoadingFile(loadingId)
      request = (async () => {
        const [preview, connections] = await Promise.all([
          editorBridge.remoteFiles.preview(fileId),
          editorBridge.managedSsh.list(),
        ])
        const content = preview.binary ? '' : (await editorBridge.remoteFiles.read(fileId)).content
        const connection = connections.find((entry) => entry.id === preview.file.connectionId)
        const previewKind = preview.binary ? undefined : previewKindForFile(preview.file.name)
        const restoredContent = preview.binary
          ? content
          : restoreVolatileDraft(editorDraftIdentity(requestWorkspace, 'remote', `remote:${preview.file.id}`), content)
        return {
          id: `remote:${preview.file.id}`,
          name: preview.file.name,
          content: restoredContent,
          savedContent: content,
          revision: restoredContent === content ? 0 : 1,
          savedRevision: 0,
          instance: ++nextTabInstanceRef.current,
          source: 'remote' as const,
          remote: { file: preview.file, connectionTitle: connection?.title ?? connection?.destination ?? 'Connessione remota', binary: preview.binary },
          ...(previewKind ? { preview: previewKind } : {}),
        }
      })()
      openFileRequestsRef.current.set(requestKey, request)
    }
    try {
      const opened = await request
      if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
      const installed = tabsRef.current.find((tab) => tab.id === opened.id) ?? opened
      if (!tabsRef.current.some((tab) => tab.id === installed.id)) {
        const next = [...tabsRef.current, installed]
        tabsRef.current = next
        setTabs(next)
      }
      setDocumentFailure((current) => current?.recovery?.kind === 'open-remote-file' && current.recovery.fileId === fileId ? null : current)
      activate(installed.id)
    } catch (error) {
      if (ownsRequest && editorAliveRef.current && workspaceRef.current === requestWorkspace) {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'remote',
            operation: 'open-remote-file',
            title: 'File remoto non aperto',
            fallbackDescription: 'La copia remota non è stata aperta. Gli altri tab e le modifiche locali restano disponibili. Riconnetti il server e riprova.',
          }),
          fileId: loadingId,
          recovery: { kind: 'open-remote-file', fileId },
        })
      }
    } finally {
      if (ownsRequest && openFileRequestsRef.current.get(requestKey) === request) openFileRequestsRef.current.delete(requestKey)
      if (ownsRequest && editorAliveRef.current && workspaceRef.current === requestWorkspace) {
        setLoadingFile((current) => current === loadingId ? null : current)
      }
    }
  }, [activationIntentRef, activeIdRef, editorAliveRef, focusEditor, nextTabInstanceRef, openFileRequestsRef, setActiveId, setDocumentFailure, setLoadingFile, setTabs, tabsRef, workspace, workspaceRef])

  useEffect(() => {
    if (!remoteOpenRequest) return
    void openRemoteFile(remoteOpenRequest.id)
  }, [openRemoteFile, remoteOpenRequest])

  const closeTabConfirmed = useCallback((fileId: string) => {
    const pendingSave = autoSaveTimersRef.current.get(fileId)
    if (pendingSave) window.clearTimeout(pendingSave.timer)
    autoSaveTimersRef.current.delete(fileId)
    clearCodeMirrorFile(fileId)
    const closingTab = tabsRef.current.find((entry) => entry.id === fileId)
    if (closingTab) discardVolatileDraft(editorDraftIdentity(workspaceRef.current, closingTab.source, closingTab.id))
    if (closingTab) clearFileConflict(fileId, closingTab.instance)
    const remaining = tabsRef.current.filter((entry) => entry.id !== fileId)
    tabsRef.current = remaining
    setTabs(remaining)
    if (activeIdRef.current === fileId) {
      activationIntentRef.current += 1
      const nextActiveId = remaining.at(-1)?.id ?? null
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
      if (nextActiveId) focusEditor()
      else focusExplorer()
    }
  }, [activationIntentRef, activeIdRef, autoSaveTimersRef, clearCodeMirrorFile, clearFileConflict, focusEditor, focusExplorer, setActiveId, setTabs, tabsRef, workspaceRef])

  const closeTab = useCallback((fileId: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId)
    if (!tab) return
    if (savingCountsRef.current.has(fileId)) {
      toast.info('Attendi la conclusione del salvataggio prima di chiudere il file.')
      return
    }
    if (tab.content === tab.savedContent) {
      closeTabConfirmed(fileId)
      return
    }
    setConfirmation({ title: 'Chiudi senza salvare', detail: `Le modifiche a “${tab.name}” non sono state salvate e verranno scartate.`, confirmLabel: 'Scarta modifiche', destructive: true, onConfirm: () => closeTabConfirmed(fileId) })
  }, [closeTabConfirmed, savingCountsRef, setConfirmation, tabsRef])

  const cycleOpenTab = useCallback((offset: -1 | 1) => {
    const current = tabsRef.current
    if (current.length < 2) {
      if (current.length === 1) focusEditor()
      return
    }
    const activeIndex = Math.max(0, current.findIndex((tab) => tab.id === activeIdRef.current))
    const nextIndex = (activeIndex + offset + current.length) % current.length
    const nextId = current[nextIndex]?.id ?? null
    activationIntentRef.current += 1
    activeIdRef.current = nextId
    setActiveId(nextId)
    focusEditor()
  }, [activationIntentRef, activeIdRef, focusEditor, setActiveId, tabsRef])

  const activateTab = useCallback((tabId: string | null) => {
    activationIntentRef.current += 1
    activeIdRef.current = tabId
    setActiveId(tabId)
  }, [activationIntentRef, activeIdRef, setActiveId])

  const canToggleTextPreview = activeTab?.preview === 'csv'
    || activeTab?.preview === 'markdown'
    || previewKindForFile(activeTab?.name ?? '') === 'csv'
    || previewKindForFile(activeTab?.name ?? '') === 'markdown'

  return {
    activateTab,
    canToggleTextPreview,
    closeTab,
    closeTabConfirmed,
    cycleOpenTab,
    openFile,
    openRemoteFile,
    toggleTextPreview,
  }
}
