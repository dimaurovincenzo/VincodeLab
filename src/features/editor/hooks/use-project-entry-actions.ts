import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ProjectFileTreeNode } from '@/bridge'
import { toast } from '@/components/ui'
import { discardVolatileDraft } from '@/lib/volatile-draft-store'
import { editorBridge } from '../api/editor.bridge'
import { editorDraftIdentity } from '../model/editor-document'
import type { EditorFailure, ProjectEntryDialogState } from '../model/editor-runtime.types'
import {
  findProjectTreeEntry,
  mergeRefreshedProjectEntries,
  projectEntriesOverlap,
  projectEntryContainsPath,
  remapProjectPath,
  removeProjectTreeEntry,
  renameProjectTreeEntry,
  replaceDirectoryChildren,
} from '../model/editor-tree'
import type { EditorTab } from '../model/editor.types'
import { reportEditorFailure, showGitStatusWarning } from '../services/editor-error'
import type { EditorTabStore } from './use-editor-tab-store'

export type ProjectEntryKind = 'file' | 'directory'

type ProjectEntryActionsOptions = {
  beginProjectIdentityMutation: (entryId: string, entryKind: ProjectEntryKind) => () => void
  bumpSessionRevision: () => void
  closeTabConfirmed: (fileId: string) => void
  hasActiveProjectIdentityMutation: (entryId: string, entryKind: ProjectEntryKind) => boolean
  loadingDirectories: MutableRefObject<Set<string>>
  openFile: (fileId: string, focusAfterOpen?: boolean, activateAfterOpen?: boolean) => Promise<void>
  refreshGitStatus: () => Promise<void>
  refreshGitStatusFromWarning: () => void
  renameCodeMirrorFile: (previous: EditorTab, renamed: EditorTab) => void
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  setExplorerFailure: Dispatch<SetStateAction<EditorFailure | null>>
  setSelectedDirectoryId: Dispatch<SetStateAction<string | null>>
  setTree: Dispatch<SetStateAction<ProjectFileTreeNode[]>>
  setTruncated: Dispatch<SetStateAction<boolean>>
  store: EditorTabStore
}

export function useProjectEntryActions({
  beginProjectIdentityMutation,
  bumpSessionRevision,
  closeTabConfirmed,
  hasActiveProjectIdentityMutation,
  loadingDirectories,
  openFile,
  refreshGitStatus,
  refreshGitStatusFromWarning,
  renameCodeMirrorFile,
  setExpanded,
  setExplorerFailure,
  setSelectedDirectoryId,
  setTree,
  setTruncated,
  store,
}: ProjectEntryActionsOptions) {
  const [projectEntryDialog, setProjectEntryDialog] = useState<ProjectEntryDialogState | null>(null)
  const projectEntryDialogInput = useRef<HTMLInputElement>(null)
  const projectEntryDialogOpener = useRef<HTMLElement | null>(null)
  const {
    activeIdRef,
    fileConflictsRef,
    openFileRequestsRef,
    savingCountsRef,
    setActiveId,
    setConfirmation,
    setTabs,
    tabsRef,
    workspaceRef,
  } = store

  const refreshMutationParent = useCallback(async (entryId: string) => {
    const parentId = entryId.split('/').slice(0, -1).join('/')
    const result = parentId
      ? await editorBridge.files.listDirectory(parentId)
      : await editorBridge.files.list()
    setTree((current) => {
      if (!parentId) return mergeRefreshedProjectEntries(current, result.entries)
      const existing = findProjectTreeEntry(current, parentId)
      return replaceDirectoryChildren(current, parentId, mergeRefreshedProjectEntries(existing?.children ?? [], result.entries))
    })
    if (!parentId) setTruncated(result.truncated)
    if (result.truncated) toast.info(`La cartella ${parentId || 'principale'} mostra un elenco limitato.`)
  }, [setTree, setTruncated])

  const affectedWorkspaceTabs = useCallback((entryId: string, entryKind: ProjectEntryKind) => tabsRef.current.filter((tab) => (
    tab.source === 'workspace' && projectEntryContainsPath(entryId, entryKind, tab.id)
  )), [tabsRef])

  const projectEntryCanMutate = useCallback((entryId: string, entryKind: ProjectEntryKind) => {
    if (hasActiveProjectIdentityMutation(entryId, entryKind)) {
      toast.info('Una modifica dello stesso elemento è già in corso. Attendi prima di riprovare.')
      return false
    }
    const workspaceRequestPrefix = `workspace\0${workspaceRef.current}\0`
    const pendingOpenFile = [...openFileRequestsRef.current.keys()]
      .filter((requestKey) => requestKey.startsWith(workspaceRequestPrefix))
      .map((requestKey) => requestKey.slice(workspaceRequestPrefix.length))
      .find((fileId) => projectEntriesOverlap(entryId, entryKind, fileId, 'file'))
    if (pendingOpenFile) {
      toast.info('Attendi l’apertura del file prima di modificare questo elemento.', { description: pendingOpenFile })
      return false
    }
    const pendingDirectory = [...loadingDirectories.current]
      .find((directoryId) => projectEntriesOverlap(entryId, entryKind, directoryId, 'directory'))
    if (pendingDirectory) {
      toast.info('Attendi il caricamento della cartella prima di modificare questo elemento.', { description: pendingDirectory })
      return false
    }
    const affected = affectedWorkspaceTabs(entryId, entryKind)
    const savingTab = affected.find((tab) => savingCountsRef.current.has(tab.id))
    if (savingTab) {
      toast.info('Attendi il salvataggio prima di modificare questo elemento.', { description: savingTab.name })
      return false
    }
    const conflictedTab = affected.find((tab) => fileConflictsRef.current.has(tab.id))
    if (conflictedTab) {
      toast.warning('Risolvi il conflitto prima di modificare questo elemento.', { description: `“${conflictedTab.name}” e le modifiche locali sono rimasti al sicuro.` })
      return false
    }
    const dirtyTab = affected.find((tab) => tab.content !== tab.savedContent)
    if (dirtyTab) {
      toast.warning('Salva il file prima di modificare questo elemento.', { description: `Le modifiche a “${dirtyTab.name}” sono rimaste nell’Editor.` })
      return false
    }
    return true
  }, [affectedWorkspaceTabs, fileConflictsRef, hasActiveProjectIdentityMutation, loadingDirectories, openFileRequestsRef, savingCountsRef, workspaceRef])

  const applyRenamedProjectEntry = useCallback((previousId: string, nextId: string, entryKind: ProjectEntryKind) => {
    const nextTabs = tabsRef.current.map((tab) => {
      if (tab.source !== 'workspace' || !projectEntryContainsPath(previousId, entryKind, tab.id)) return tab
      const id = remapProjectPath(tab.id, previousId, nextId)
      const renamed = { ...tab, id, name: id.split('/').at(-1) ?? tab.name }
      renameCodeMirrorFile(tab, renamed)
      discardVolatileDraft(editorDraftIdentity(workspaceRef.current, 'workspace', tab.id))
      return renamed
    })
    tabsRef.current = nextTabs
    setTabs(nextTabs)
    if (activeIdRef.current && projectEntryContainsPath(previousId, entryKind, activeIdRef.current)) {
      const nextActiveId = remapProjectPath(activeIdRef.current, previousId, nextId)
      activeIdRef.current = nextActiveId
      setActiveId(nextActiveId)
    }
    setExpanded((current) => new Set([...current].map((id) => remapProjectPath(id, previousId, nextId))))
    setSelectedDirectoryId((current) => current && projectEntryContainsPath(previousId, entryKind, current) ? remapProjectPath(current, previousId, nextId) : current)
    setTree((current) => renameProjectTreeEntry(current, previousId, nextId))
    bumpSessionRevision()
  }, [activeIdRef, bumpSessionRevision, renameCodeMirrorFile, setActiveId, setExpanded, setSelectedDirectoryId, setTabs, setTree, tabsRef, workspaceRef])

  const openRenameProjectEntry = useCallback((entryId: string, entryKind: ProjectEntryKind) => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    projectEntryDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectEntryDialog({
      busy: false,
      entryId,
      entryKind,
      error: null,
      mode: 'rename',
      value: entryId.split('/').at(-1) ?? entryId,
    })
  }, [projectEntryCanMutate])

  const openNewProjectDirectory = useCallback((parentId: string) => {
    if (!projectEntryCanMutate(parentId, 'directory')) return
    projectEntryDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setProjectEntryDialog({ busy: false, entryId: parentId, entryKind: 'directory', error: null, mode: 'new-directory', value: '' })
  }, [projectEntryCanMutate])

  const submitProjectEntryDialog = useCallback(async () => {
    const request = projectEntryDialog
    if (!request || request.busy || !request.value.trim()) return
    setProjectEntryDialog({ ...request, busy: true, error: null })
    try {
      if (request.mode === 'new-directory') {
        if (!projectEntryCanMutate(request.entryId, 'directory')) {
          setProjectEntryDialog((current) => current ? { ...current, busy: false } : current)
          return
        }
        const created = await editorBridge.files.createDirectory(request.entryId, request.value)
        await refreshMutationParent(created.id)
        setExpanded((current) => request.entryId ? new Set(current).add(request.entryId) : current)
        setSelectedDirectoryId(created.id)
        toast.success('Nuova cartella creata.', { description: created.id })
      } else {
        if (!projectEntryCanMutate(request.entryId, request.entryKind)) {
          setProjectEntryDialog((current) => current ? { ...current, busy: false } : current)
          return
        }
        const finishIdentityMutation = beginProjectIdentityMutation(request.entryId, request.entryKind)
        try {
          const renamed = await editorBridge.files.rename(request.entryId, request.value, request.entryKind)
          if (renamed.renamed) applyRenamedProjectEntry(renamed.previousId, renamed.id, request.entryKind)
          toast.success(renamed.renamed ? 'Elemento rinominato.' : 'Nome già aggiornato.', { description: renamed.id })
        } finally {
          finishIdentityMutation()
        }
      }
      setProjectEntryDialog(null)
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-entry-mutation',
          title: 'Elemento aggiornato, stato Git non disponibile',
          fallbackDescription: 'La modifica al filesystem è riuscita. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
    } catch (error) {
      const incident = reportEditorFailure(error, {
        category: 'filesystem',
        operation: request.mode === 'rename' ? 'rename-project-entry' : 'create-project-directory',
        title: request.mode === 'rename' ? 'Elemento non rinominato' : 'Cartella non creata',
        fallbackDescription: request.mode === 'rename'
          ? 'Il nome precedente e i file aperti sono rimasti invariati. Correggi il nome o verifica i permessi e riprova.'
          : 'La cartella scelta è rimasta invariata. Correggi il nome o verifica i permessi e riprova.',
      })
      setProjectEntryDialog((current) => current ? { ...current, busy: false, error: incident } : current)
    }
  }, [applyRenamedProjectEntry, beginProjectIdentityMutation, projectEntryCanMutate, projectEntryDialog, refreshGitStatus, refreshGitStatusFromWarning, refreshMutationParent, setExpanded, setSelectedDirectoryId])

  const duplicateProjectEntryFromMenu = useCallback(async (entryId: string, entryKind: ProjectEntryKind) => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    try {
      const duplicated = await editorBridge.files.duplicate(entryId, entryKind)
      await refreshMutationParent(duplicated.id)
      if (entryKind === 'file') void openFile(duplicated.id)
      toast.success(entryKind === 'file' ? 'File duplicato.' : 'Cartella duplicata.', { description: duplicated.id })
      try { await refreshGitStatus() } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-duplicate',
          title: 'Elemento duplicato, stato Git non disponibile',
          fallbackDescription: 'La copia è stata creata. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'duplicate-project-entry',
          title: 'Elemento non duplicato',
          fallbackDescription: 'L’elemento originale è rimasto invariato. Verifica dimensione, permessi e spazio disponibile, poi riprova.',
        }),
      })
    }
  }, [openFile, projectEntryCanMutate, refreshGitStatus, refreshGitStatusFromWarning, refreshMutationParent, setExplorerFailure])

  const requestTrashProjectEntry = useCallback((entryId: string, entryKind: ProjectEntryKind) => {
    if (!projectEntryCanMutate(entryId, entryKind)) return
    const entryName = entryId.split('/').at(-1) ?? entryId
    setConfirmation({
      title: `Sposta “${entryName}” nel Cestino`,
      detail: entryKind === 'directory'
        ? 'La cartella e tutto il suo contenuto verranno spostati nel Cestino di macOS. I file aperti coinvolti verranno chiusi soltanto dopo il completamento.'
        : 'Il file verrà spostato nel Cestino di macOS e chiuso nell’Editor soltanto dopo il completamento.',
      confirmLabel: 'Sposta nel Cestino',
      destructive: true,
      onConfirm: () => {
        if (!projectEntryCanMutate(entryId, entryKind)) return
        const finishIdentityMutation = beginProjectIdentityMutation(entryId, entryKind)
        void Promise.resolve().then(() => editorBridge.files.trash(entryId, entryKind)).then(async () => {
          for (const tab of affectedWorkspaceTabs(entryId, entryKind)) closeTabConfirmed(tab.id)
          setTree((current) => removeProjectTreeEntry(current, entryId))
          setExpanded((current) => new Set([...current].filter((id) => !projectEntryContainsPath(entryId, entryKind, id))))
          setSelectedDirectoryId((current) => current && projectEntryContainsPath(entryId, entryKind, current) ? null : current)
          toast.success(entryKind === 'file' ? 'File spostato nel Cestino.' : 'Cartella spostata nel Cestino.', { description: entryId })
          try { await refreshGitStatus() } catch (error) {
            showGitStatusWarning(error, {
              operation: 'refresh-git-status-after-trash',
              title: 'Elemento nel Cestino, stato Git non disponibile',
              fallbackDescription: 'Lo spostamento nel Cestino è riuscito. Gli indicatori Git potrebbero essere obsoleti.',
            }, refreshGitStatusFromWarning)
          }
        }).catch((error) => {
          setExplorerFailure({
            error: reportEditorFailure(error, {
              category: 'filesystem',
              operation: 'trash-project-entry',
              title: 'Elemento non spostato nel Cestino',
              fallbackDescription: 'Il file, i tab e le modifiche sono rimasti invariati. Verifica i permessi e riprova.',
            }),
          })
        }).finally(finishIdentityMutation)
      },
    })
  }, [affectedWorkspaceTabs, beginProjectIdentityMutation, closeTabConfirmed, projectEntryCanMutate, refreshGitStatus, refreshGitStatusFromWarning, setConfirmation, setExpanded, setExplorerFailure, setSelectedDirectoryId, setTree])

  const requestCloseEditorTabs = useCallback((fileIds: string[]) => {
    const ids = new Set(fileIds)
    const targets = tabsRef.current.filter((tab) => ids.has(tab.id))
    if (!targets.length) return
    if (targets.some((tab) => savingCountsRef.current.has(tab.id))) {
      toast.info('Attendi la conclusione dei salvataggi prima di chiudere i tab.')
      return
    }
    const close = () => targets.forEach((tab) => closeTabConfirmed(tab.id))
    const dirty = targets.filter((tab) => tab.content !== tab.savedContent)
    if (!dirty.length) { close(); return }
    setConfirmation({
      title: dirty.length === 1 ? 'Chiudi senza salvare' : `Chiudi ${dirty.length} file modificati`,
      detail: dirty.length === 1
        ? `Le modifiche a “${dirty[0].name}” verranno scartate.`
        : `Le modifiche non salvate in ${dirty.length} file verranno scartate. Gli altri tab selezionati verranno chiusi.`,
      confirmLabel: 'Scarta modifiche e chiudi',
      destructive: true,
      onConfirm: close,
    })
  }, [closeTabConfirmed, savingCountsRef, setConfirmation, tabsRef])

  return {
    duplicateProjectEntryFromMenu,
    openNewProjectDirectory,
    openRenameProjectEntry,
    projectEntryCanMutate,
    projectEntryDialog,
    projectEntryDialogInput,
    projectEntryDialogOpener,
    requestCloseEditorTabs,
    requestTrashProjectEntry,
    setProjectEntryDialog,
    submitProjectEntryDialog,
  }
}
