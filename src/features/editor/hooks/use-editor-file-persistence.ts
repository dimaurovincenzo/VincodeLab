import { useCallback, useEffect, useLayoutEffect } from 'react'
import type { RemoteTrackedFile } from '@/bridge'
import { toast } from '@/components/ui'
import { commitVolatileDraft, discardVolatileDraft, writeVolatileDraft } from '@/lib/volatile-draft-store'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { editorBridge } from '../api/editor.bridge'
import { editorDraftIdentity } from '../model/editor-document'
import type { EditorFileConflict } from '../model/editor-runtime.types'
import type { EditorTab, ProjectEditorProps } from '../model/editor.types'
import { externalFileConflictCode, isExternalFileConflict, reportEditorFailure, showGitStatusWarning } from '../services/editor-error'
import type { EditorTabStore } from './use-editor-tab-store'

type EditorFilePersistenceOptions = {
  editorAutoSave: boolean
  focusEditor: () => void
  onWorkspaceGuardChange: ProjectEditorProps['onWorkspaceGuardChange']
  refreshGitStatus: () => Promise<void>
  refreshGitStatusFromWarning: () => void
  store: EditorTabStore
  workspace: string
}

export function useEditorFilePersistence({
  editorAutoSave,
  focusEditor,
  onWorkspaceGuardChange,
  refreshGitStatus,
  refreshGitStatusFromWarning,
  store,
  workspace,
}: EditorFilePersistenceOptions) {
  const {
    activeIdRef,
    autoSaveTimersRef,
    editorAliveRef,
    fileConflicts,
    fileConflictsRef,
    fileRecoveryIdsRef,
    saveActiveRef,
    saveJobsRef,
    savingCountsRef,
    setConfirmation,
    setDocumentFailure,
    setFileConflicts,
    setSavingFileIds,
    setTabs,
    tabs,
    tabsRef,
    workspaceRef,
  } = store

  const clearFileConflict = useCallback((fileId: string, instance: number) => {
    const current = fileConflictsRef.current.get(fileId)
    if (!current || current.instance !== instance) return
    const next = new Map(fileConflictsRef.current)
    next.delete(fileId)
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [fileConflictsRef, setFileConflicts])

  const recordFileConflict = useCallback((tab: EditorTab, cause: unknown) => {
    if (!editorAliveRef.current || workspaceRef.current !== workspace || tab.source !== 'workspace') return
    const incident = reportUserError(normalizeUserError(cause, {
      category: 'conflict',
      code: externalFileConflictCode,
      component: 'project-editor',
      operation: 'save-workspace-file',
      severity: 'warning',
      title: 'File modificato sul disco',
      description: `Impossibile salvare “${tab.name}” perché il file sul disco è cambiato o è stato rimosso. Le modifiche locali sono al sicuro. Scegli se ricaricare dal disco o sovrascrivere il file.`,
    }))
    const next = new Map(fileConflictsRef.current)
    next.set(tab.id, { error: incident, fileId: tab.id, instance: tab.instance })
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [editorAliveRef, fileConflictsRef, setFileConflicts, workspace, workspaceRef])

  const recordConflictRecoveryFailure = useCallback((tab: EditorTab, cause: unknown, operation: string, title: string, description: string) => {
    if (!editorAliveRef.current || workspaceRef.current !== workspace) return
    const incident = reportUserError(normalizeUserError(cause, {
      category: 'filesystem',
      component: 'project-editor',
      operation,
      title,
      description,
    }))
    const next = new Map(fileConflictsRef.current)
    next.set(tab.id, { error: incident, fileId: tab.id, instance: tab.instance })
    fileConflictsRef.current = next
    setFileConflicts(next)
  }, [editorAliveRef, fileConflictsRef, setFileConflicts, workspace, workspaceRef])

  const saveEditorTab = useCallback(async (tab: EditorTab, force = false) => {
    const requestWorkspace = workspace
    const remoteFile = tab.source === 'remote' && tab.remote
      ? await editorBridge.remoteFiles.saveLocal(tab.remote.file.id, tab.content)
      : null
    const savedFile = !remoteFile
      ? await editorBridge.files.save(tab.id, tab.content, force ? { force: true } : { revision: tab.diskRevision })
      : null

    if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
    const currentTab = tabsRef.current.find((entry) => entry.id === tab.id && entry.instance === tab.instance)
    if (!currentTab) return
    const saveStillMatchesDocument = currentTab.content === tab.content
    const next = tabsRef.current.map((entry) => entry.id === tab.id && entry.instance === tab.instance
      ? {
          ...entry,
          savedContent: tab.content,
          savedRevision: tab.revision,
          ...(savedFile ? { diskRevision: savedFile.revision } : {}),
          ...(remoteFile && entry.remote ? { remote: { ...entry.remote, file: remoteFile } } : {}),
        }
      : entry)
    tabsRef.current = next
    setTabs(next)
    setDocumentFailure((current) => current?.fileId === tab.id ? null : current)
    clearFileConflict(tab.id, tab.instance)
    if (saveStillMatchesDocument) commitVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id), tab.content)
    else writeVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id), currentTab.content, tab.content)

    if (tab.source === 'workspace') {
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-save',
          title: 'File salvato, stato Git non aggiornato',
          fallbackDescription: 'Il file è al sicuro. Gli indicatori Git potrebbero essere obsoleti; aggiornali quando sei pronto.',
        }, refreshGitStatusFromWarning)
      }
    }
    toast.success(remoteFile ? 'Copia locale salvata.' : 'File salvato.', { description: remoteFile ? remoteFile.remotePath : tab.id })
  }, [clearFileConflict, editorAliveRef, refreshGitStatus, refreshGitStatusFromWarning, setDocumentFailure, setTabs, tabsRef, workspace, workspaceRef])

  const saveEditorTabById = useCallback((fileId: string, options: { force?: boolean } = {}) => {
    if (fileRecoveryIdsRef.current.has(fileId)) return Promise.resolve()
    const tab = tabsRef.current.find((entry) => entry.id === fileId)
    if (!tab) return Promise.resolve()
    const pendingConflict = fileConflictsRef.current.get(fileId)
    if (tab.content === tab.savedContent && !(options.force && pendingConflict?.instance === tab.instance)) return Promise.resolve()
    if (!options.force && pendingConflict?.instance === tab.instance) {
      return Promise.reject(Object.assign(new Error('Risolvi il conflitto del file prima di salvarlo.'), { code: externalFileConflictCode }))
    }
    const jobKey = `${workspace}\0${fileId}\0${tab.instance}`
    const currentJob = saveJobsRef.current.get(jobKey)
    if (currentJob) return currentJob

    const pendingTimer = autoSaveTimersRef.current.get(fileId)
    if (pendingTimer) window.clearTimeout(pendingTimer.timer)
    autoSaveTimersRef.current.delete(fileId)
    savingCountsRef.current.set(fileId, (savingCountsRef.current.get(fileId) ?? 0) + 1)
    setSavingFileIds((current) => new Set(current).add(fileId))
    const job = saveEditorTab(tab, options.force === true).catch((error) => {
      if (isExternalFileConflict(error)) recordFileConflict(tab, error)
      throw error
    })
    saveJobsRef.current.set(jobKey, job)
    const finish = () => {
      if (saveJobsRef.current.get(jobKey) === job) saveJobsRef.current.delete(jobKey)
      const remainingSaves = Math.max(0, (savingCountsRef.current.get(fileId) ?? 1) - 1)
      if (remainingSaves > 0) savingCountsRef.current.set(fileId, remainingSaves)
      else savingCountsRef.current.delete(fileId)
      if (!editorAliveRef.current) return
      setSavingFileIds((current) => {
        if (remainingSaves > 0 || !current.has(fileId)) return current
        const next = new Set(current)
        next.delete(fileId)
        return next
      })
    }
    void job.then(finish, finish)
    return job
  }, [autoSaveTimersRef, editorAliveRef, fileConflictsRef, fileRecoveryIdsRef, recordFileConflict, saveEditorTab, saveJobsRef, savingCountsRef, setSavingFileIds, tabsRef, workspace])

  const saveActive = useCallback(async () => {
    const fileId = activeIdRef.current
    if (!fileId) return
    try {
      await saveEditorTabById(fileId)
    } catch (error) {
      if (isExternalFileConflict(error)) return
      const tab = tabsRef.current.find((entry) => entry.id === fileId)
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'save-file',
          title: 'File non salvato',
          fallbackDescription: `Le modifiche${tab ? ` a “${tab.name}”` : ''} sono rimaste nell’Editor. Verifica che il file sia accessibile e riprova.`,
        }),
        fileId,
        recovery: { kind: 'save-file', fileId },
      })
    }
  }, [activeIdRef, saveEditorTabById, setDocumentFailure, tabsRef])
  useLayoutEffect(() => {
    saveActiveRef.current = saveActive
  }, [saveActive, saveActiveRef])

  const saveAll = useCallback(async () => {
    const dirtyFileIds = tabsRef.current.filter((tab) => tab.content !== tab.savedContent).map((tab) => tab.id)
    try {
      for (const fileId of dirtyFileIds) {
        while (true) {
          const current = tabsRef.current.find((tab) => tab.id === fileId)
          if (!current || current.content === current.savedContent) break
          await saveEditorTabById(fileId)
        }
      }
      setDocumentFailure((current) => current?.error.operation === 'save-files-before-workspace-change' ? null : current)
    } catch (error) {
      if (isExternalFileConflict(error)) throw error
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: 'save-files-before-workspace-change',
        title: 'File non salvati',
        fallbackDescription: 'Il cambio di workspace o la chiusura è stato annullato. Le modifiche restano aperte nell’Editor e puoi riprovare il salvataggio.',
      })
      setDocumentFailure({ error: incident, recovery: { kind: 'save-all' } })
      throw error
    }
  }, [saveEditorTabById, setDocumentFailure, tabsRef])

  const discardAll = useCallback(async () => {
    const requestWorkspace = workspace
    const discardedTabs = tabsRef.current
      .filter((tab) => tab.content !== tab.savedContent)
      .map((tab) => ({
        id: tab.id,
        instance: tab.instance,
        savedContent: tab.savedContent,
        diskRevision: tab.diskRevision,
        source: tab.source,
        remoteFileId: tab.remote?.file.id,
        pendingJob: saveJobsRef.current.get(`${workspace}\0${tab.id}\0${tab.instance}`),
      }))

    for (const tab of discardedTabs) {
      const pendingTimer = autoSaveTimersRef.current.get(tab.id)
      if (pendingTimer) window.clearTimeout(pendingTimer.timer)
      autoSaveTimersRef.current.delete(tab.id)
    }

    try {
      const restoredRemoteFiles = new Map<string, RemoteTrackedFile>()
      const restoredProjectRevisions = new Map<string, string>()
      await Promise.all(discardedTabs.map(async (tab) => {
        if (!tab.pendingJob) return
        await tab.pendingJob.catch(() => undefined)
        if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) throw new Error('Il workspace è cambiato durante il ripristino.')
        if (tab.source === 'remote') {
          if (!tab.remoteFileId) throw new Error('Copia remota non disponibile per il ripristino.')
          restoredRemoteFiles.set(tab.id, await editorBridge.remoteFiles.saveLocal(tab.remoteFileId, tab.savedContent))
          return
        }
        const current = tabsRef.current.find((entry) => entry.id === tab.id && entry.instance === tab.instance)
        const revision = current?.diskRevision ?? tab.diskRevision
        const saved = await editorBridge.files.save(tab.id, tab.savedContent, { revision })
        restoredProjectRevisions.set(tab.id, saved.revision)
      }))

      if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
      for (const tab of discardedTabs) discardVolatileDraft(editorDraftIdentity(requestWorkspace, tab.source, tab.id))
      const discardedById = new Map(discardedTabs.map((tab) => [tab.id, tab]))
      const next = tabsRef.current.map((tab) => {
        const discarded = discardedById.get(tab.id)
        if (!discarded || tab.instance !== discarded.instance) return tab
        const restoredRemoteFile = restoredRemoteFiles.get(tab.id)
        return {
          ...tab,
          content: discarded.savedContent,
          savedContent: discarded.savedContent,
          revision: tab.revision + 1,
          savedRevision: tab.revision + 1,
          ...(restoredProjectRevisions.has(tab.id) ? { diskRevision: restoredProjectRevisions.get(tab.id) } : {}),
          ...(restoredRemoteFile && tab.remote ? { remote: { ...tab.remote, file: restoredRemoteFile } } : {}),
        }
      })
      tabsRef.current = next
      setTabs(next)
      setDocumentFailure((current) => current?.error.operation === 'discard-files-before-workspace-change' ? null : current)
    } catch (error) {
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: 'discard-files-before-workspace-change',
        title: 'Bozze non ripristinate',
        fallbackDescription: 'Il cambio di workspace o la chiusura è stato annullato. Le modifiche restano aperte nell’Editor; puoi salvarle prima di riprovare.',
      })
      setDocumentFailure({ error: incident, recovery: { kind: 'save-all' } })
      throw error
    }
  }, [autoSaveTimersRef, editorAliveRef, saveJobsRef, setDocumentFailure, setTabs, tabsRef, workspace, workspaceRef])

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => tabsRef.current.some((tab) => tab.content !== tab.savedContent),
      saveAll,
      discardAll,
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [discardAll, onWorkspaceGuardChange, saveAll, tabsRef])

  useEffect(() => {
    const tabsById = new Map(tabs.map((tab) => [tab.id, tab]))
    for (const [fileId, pending] of autoSaveTimersRef.current) {
      const tab = tabsById.get(fileId)
      const conflict = fileConflicts.get(fileId)
      if (editorAutoSave && tab && !conflict && tab.content !== tab.savedContent && tab.instance === pending.instance && tab.revision === pending.revision) continue
      window.clearTimeout(pending.timer)
      autoSaveTimersRef.current.delete(fileId)
    }
    if (!editorAutoSave) return
    for (const tab of tabs) {
      const conflict = fileConflicts.get(tab.id)
      if (tab.content === tab.savedContent || autoSaveTimersRef.current.has(tab.id) || conflict?.instance === tab.instance) continue
      const pending = {
        instance: tab.instance,
        revision: tab.revision,
        timer: window.setTimeout(() => {
          const scheduled = autoSaveTimersRef.current.get(tab.id)
          if (!scheduled || scheduled.instance !== tab.instance || scheduled.revision !== tab.revision) return
          autoSaveTimersRef.current.delete(tab.id)
          const current = tabsRef.current.find((entry) => entry.id === tab.id)
          if (!current || current.instance !== tab.instance || current.revision !== tab.revision || current.content === current.savedContent) return
          void saveEditorTabById(tab.id).catch((error) => {
            if (isExternalFileConflict(error)) return
            setDocumentFailure({
              error: reportEditorFailure(error, {
                category: 'filesystem',
                operation: 'auto-save-file',
                title: 'Salvataggio automatico non completato',
                fallbackDescription: `Le modifiche a “${tab.name}” sono rimaste nell’Editor. Salva manualmente quando il file torna accessibile.`,
              }),
              fileId: tab.id,
              recovery: { kind: 'save-file', fileId: tab.id },
            })
          })
        }, 700),
      }
      autoSaveTimersRef.current.set(tab.id, pending)
    }
  }, [autoSaveTimersRef, editorAutoSave, fileConflicts, saveEditorTabById, setDocumentFailure, tabs, tabsRef])

  useEffect(() => () => {
    for (const pending of autoSaveTimersRef.current.values()) window.clearTimeout(pending.timer)
    autoSaveTimersRef.current.clear()
  }, [autoSaveTimersRef])

  const reloadWorkspaceFileFromDisk = useCallback(async (fileId: string, instance: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance && entry.source === 'workspace')
    if (!tab || savingCountsRef.current.has(fileId)) return
    const requestWorkspace = workspace
    fileRecoveryIdsRef.current.add(fileId)
    savingCountsRef.current.set(fileId, 1)
    setSavingFileIds((current) => new Set(current).add(fileId))
    try {
      const file = await editorBridge.files.read(fileId)
      if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (!current) return
      const nextRevision = current.revision + 1
      const next = tabsRef.current.map((entry) => entry.id === fileId && entry.instance === instance
        ? { ...entry, content: file.content, savedContent: file.content, diskRevision: file.revision, revision: nextRevision, savedRevision: nextRevision }
        : entry)
      tabsRef.current = next
      setTabs(next)
      clearFileConflict(fileId, instance)
      discardVolatileDraft(editorDraftIdentity(requestWorkspace, 'workspace', fileId))
      toast.success('File ricaricato dal disco.', { description: fileId })
      focusEditor()
    } catch (cause) {
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (current) recordConflictRecoveryFailure(current, cause, 'reload-workspace-file', 'Impossibile ricaricare il file', `“${current.name}” non è disponibile sul disco. Le modifiche locali sono ancora al sicuro. Puoi riprovare oppure sovrascrivere esplicitamente il file.`)
    } finally {
      fileRecoveryIdsRef.current.delete(fileId)
      savingCountsRef.current.delete(fileId)
      if (editorAliveRef.current && workspaceRef.current === requestWorkspace) {
        setSavingFileIds((current) => {
          if (!current.has(fileId)) return current
          const next = new Set(current)
          next.delete(fileId)
          return next
        })
      }
    }
  }, [clearFileConflict, editorAliveRef, fileRecoveryIdsRef, focusEditor, recordConflictRecoveryFailure, savingCountsRef, setSavingFileIds, setTabs, tabsRef, workspace, workspaceRef])

  const overwriteWorkspaceFile = useCallback(async (fileId: string, instance: number) => {
    const tab = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance && entry.source === 'workspace')
    if (!tab) return
    try {
      await saveEditorTabById(fileId, { force: true })
    } catch (cause) {
      const current = tabsRef.current.find((entry) => entry.id === fileId && entry.instance === instance)
      if (current) recordConflictRecoveryFailure(current, cause, 'force-overwrite-workspace-file', 'Impossibile sovrascrivere il file', `“${current.name}” non è stato sovrascritto. Le modifiche locali sono ancora al sicuro. Puoi riprovare oppure ricaricare la versione presente sul disco.`)
    }
  }, [recordConflictRecoveryFailure, saveEditorTabById, tabsRef])

  const requestReloadWorkspaceFile = useCallback((conflict: EditorFileConflict) => {
    const tab = tabsRef.current.find((entry) => entry.id === conflict.fileId && entry.instance === conflict.instance)
    if (!tab) return
    setConfirmation({
      title: 'Ricarica la versione sul disco',
      detail: `Le modifiche locali a “${tab.name}” verranno sostituite dalla versione presente sul disco. Questa operazione non sovrascrive il file esterno.`,
      confirmLabel: 'Ricarica dal disco',
      destructive: true,
      onConfirm: () => { void reloadWorkspaceFileFromDisk(conflict.fileId, conflict.instance) },
    })
  }, [reloadWorkspaceFileFromDisk, setConfirmation, tabsRef])

  const requestOverwriteWorkspaceFile = useCallback((conflict: EditorFileConflict) => {
    const tab = tabsRef.current.find((entry) => entry.id === conflict.fileId && entry.instance === conflict.instance)
    if (!tab) return
    setConfirmation({
      title: 'Sovrascrivi la versione sul disco',
      detail: `La versione esterna di “${tab.name}” verrà sostituita con le modifiche locali conservate nell’Editor. Non sarà possibile recuperarla da VincodeLab.`,
      confirmLabel: 'Sovrascrivi file',
      destructive: true,
      onConfirm: () => { void overwriteWorkspaceFile(conflict.fileId, conflict.instance) },
    })
  }, [overwriteWorkspaceFile, setConfirmation, tabsRef])

  return {
    clearFileConflict,
    discardAll,
    recordFileConflict,
    requestOverwriteWorkspaceFile,
    requestReloadWorkspaceFile,
    saveActive,
    saveAll,
    saveEditorTabById,
  }
}
