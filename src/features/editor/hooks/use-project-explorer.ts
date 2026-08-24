import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/components/ui'
import { resolveNewFileDraft } from '@/lib/editor-new-file'
import { editorBridge } from '../api/editor.bridge'
import type { EditorFailure } from '../model/editor-runtime.types'
import {
  filterEditorTree,
  findProjectTreeEntry,
  replaceDirectoryChildren,
} from '../model/editor-tree'
import type { EditorTab, ProjectEditorProps } from '../model/editor.types'
import { createdFileExplorerWarningToastId, reportEditorFailure, showGitStatusWarning } from '../services/editor-error'
import { useProjectEntryActions, type ProjectEntryKind } from './use-project-entry-actions'
import type { EditorTabStore } from './use-editor-tab-store'

type ProjectExplorerOptions = {
  beginProjectIdentityMutation: (entryId: string, entryKind: ProjectEntryKind) => () => void
  bumpSessionRevision: () => void
  closeTabConfirmed: (fileId: string) => void
  focusEditor: () => void
  hasActiveProjectIdentityMutation: (entryId: string, entryKind: ProjectEntryKind) => boolean
  initialState: ProjectEditorProps['initialState']
  openFile: (fileId: string, focusAfterOpen?: boolean, activateAfterOpen?: boolean) => Promise<void>
  refreshGitStatus: () => Promise<void>
  refreshGitStatusFromWarning: () => void
  renameCodeMirrorFile: (previous: EditorTab, renamed: EditorTab) => void
  store: EditorTabStore
  workspace: string
}
export function useProjectExplorer({
  beginProjectIdentityMutation,
  bumpSessionRevision,
  closeTabConfirmed,
  focusEditor,
  hasActiveProjectIdentityMutation,
  initialState,
  openFile,
  refreshGitStatus,
  refreshGitStatusFromWarning,
  renameCodeMirrorFile,
  store,
  workspace,
}: ProjectExplorerOptions) {
  const [tree, setTree] = useState<ProjectFileTreeNode[]>([])
  const [explorerQuery, setExplorerQuery] = useState('')
  const [newFileName, setNewFileName] = useState<string | null>(null)
  const [newFileRenameAttempt, setNewFileRenameAttempt] = useState(0)
  const [creatingFile, setCreatingFile] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedDirectoryId, setSelectedDirectoryId] = useState<string | null>(null)
  const [loadingDirectory, setLoadingDirectory] = useState<string | null>(null)
  const [refreshingExplorer, setRefreshingExplorer] = useState(false)
  const [explorerFailure, setExplorerFailure] = useState<EditorFailure | null>(null)
  const newFileTrigger = useRef<HTMLButtonElement>(null)
  const loadingDirectories = useRef(new Set<string>())
  const restoredExpandedKey = useRef<string | null>(null)
  const {
    activationIntentRef,
    activeIdRef,
    editorAliveRef,
    nextTabInstanceRef,
    setActiveId,
    setTabs,
    tabsRef,
    workspaceRef,
  } = store

  const refreshExplorer = useCallback(async (quiet = false) => {
    setRefreshingExplorer(true)
    try {
      const result = await editorBridge.files.list()
      setTree(result.entries)
      setTruncated(result.truncated)
      toast.remove(createdFileExplorerWarningToastId)
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-explorer',
          title: 'Explorer aggiornato, stato Git non disponibile',
          fallbackDescription: 'L’elenco dei file è aggiornato. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
      setExpanded(new Set())
      setSelectedDirectoryId(null)
      setExplorerFailure(null)
      if (!quiet) toast.success('Explorer aggiornato.')
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'refresh-explorer',
          title: 'Explorer non aggiornato',
          fallbackDescription: 'I file già aperti restano disponibili. Verifica l’accesso al workspace e riprova.',
        }),
        recovery: { kind: 'refresh-explorer' },
      })
    } finally {
      setRefreshingExplorer(false)
    }
  }, [refreshGitStatus, refreshGitStatusFromWarning])

  useEffect(() => {
    let active = true
    void editorBridge.files.list().then((result) => {
      if (!active) return
      setTree(result.entries)
      setTruncated(result.truncated)
    }).catch((error) => {
      if (active) setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'load-explorer',
          title: 'Explorer non disponibile',
          fallbackDescription: 'L’Editor resta operativo per i file già aperti. Verifica l’accesso al workspace e riprova.',
        }),
        recovery: { kind: 'refresh-explorer' },
      })
    })
    return () => { active = false }
  }, [])

  const refreshCreatedFileInExplorer = async (fileId: string) => {
    const segments = fileId.split('/')
    const directorySegments = segments.slice(0, -1)
    if (!directorySegments.length) {
      const result = await editorBridge.files.list()
      setTree(result.entries)
      setTruncated(result.truncated)
      return
    }

    let nextTree = tree
    const directoriesToExpand: string[] = []
    for (let index = 1; index <= directorySegments.length; index += 1) {
      const directoryId = directorySegments.slice(0, index).join('/')
      const result = await editorBridge.files.listDirectory(directoryId)
      nextTree = replaceDirectoryChildren(nextTree, directoryId, result.entries)
      directoriesToExpand.push(directoryId)
      if (result.truncated) toast.info(`La cartella ${directoryId} è limitata a 1.000 elementi.`)
    }
    setTree(nextTree)
    setExpanded((current) => new Set([...current, ...directoriesToExpand]))
  }

  const createFile = async (fileName: string) => {
    const draft = resolveNewFileDraft(fileName)
    if (draft.action === 'cancel') {
      setNewFileName(null)
      return
    }
    if (creatingFile) return
    const requestWorkspace = workspace
    const intent = ++activationIntentRef.current
    setCreatingFile(true)
    try {
      const file = await editorBridge.files.create(selectedDirectoryId ?? '', draft.fileName)
      if (!editorAliveRef.current || workspaceRef.current !== requestWorkspace) return
      const tab: EditorTab = {
        id: file.id,
        name: file.name,
        content: file.content,
        savedContent: file.content,
        revision: 0,
        savedRevision: 0,
        instance: ++nextTabInstanceRef.current,
        source: 'workspace',
        diskRevision: file.revision,
      }
      const next = [...tabsRef.current, tab]
      tabsRef.current = next
      setTabs(next)
      if (editorAliveRef.current && workspaceRef.current === requestWorkspace && activationIntentRef.current === intent) {
        activeIdRef.current = file.id
        setActiveId(file.id)
        focusEditor()
      }
      setExplorerQuery('')
      setNewFileName(null)
      setExplorerFailure(null)
      try {
        await refreshCreatedFileInExplorer(file.id)
        toast.remove(createdFileExplorerWarningToastId)
      } catch (error) {
        const incident = reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'refresh-explorer-after-create',
          severity: 'warning',
          title: 'File creato, Explorer non aggiornato',
          fallbackDescription: 'Il file è aperto e al sicuro. Aggiorna Explorer per riallineare l’elenco dei file.',
        })
        toast.warning(incident.title, {
          action: { label: 'Aggiorna', onClick: () => { void refreshExplorer(true) } },
          description: `${incident.description} Riferimento ${incident.correlationId}.`,
          id: createdFileExplorerWarningToastId,
        })
      }
      try {
        await refreshGitStatus()
      } catch (error) {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status-after-create',
          title: 'File creato, stato Git non aggiornato',
          fallbackDescription: 'Il file è aperto e al sicuro. Gli indicatori Git potrebbero essere obsoleti.',
        }, refreshGitStatusFromWarning)
      }
      toast.success('Nuovo file creato.', { description: file.id })
    } catch (error) {
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'create-file',
          title: 'File non creato',
          fallbackDescription: 'Il nome e la cartella scelti sono rimasti nell’Explorer. Correggili oppure verifica i permessi e riprova.',
        }),
        recovery: { kind: 'create-file', fileName: draft.fileName },
      })
      setNewFileRenameAttempt((current) => current + 1)
    } finally {
      if (editorAliveRef.current && workspaceRef.current === requestWorkspace) setCreatingFile(false)
    }
  }

  const loadDirectory = useCallback(async (directoryId: string, directoryName: string) => {
    if (hasActiveProjectIdentityMutation(directoryId, 'directory')) {
      toast.info('Attendi la conclusione della modifica prima di aprire questa cartella.', { description: directoryName })
      return
    }
    if (loadingDirectories.current.has(directoryId)) return
    const directory = findProjectTreeEntry(tree, directoryId)
    if (!directory || directory.children !== undefined) return
    loadingDirectories.current.add(directoryId)
    setLoadingDirectory(directoryId)
    try {
      const result = await editorBridge.files.listDirectory(directoryId)
      setTree((current) => replaceDirectoryChildren(current, directoryId, result.entries))
      setExplorerFailure((current) => current?.recovery?.kind === 'load-directory' && current.recovery.directoryId === directoryId ? null : current)
      if (result.truncated) toast.info(`La cartella ${directoryName} è limitata a 1.000 elementi.`)
    } catch (error) {
      setExpanded((current) => { const next = new Set(current); next.delete(directoryId); return next })
      setExplorerFailure({
        error: reportEditorFailure(error, {
          category: 'filesystem',
          operation: 'load-directory',
          title: 'Cartella non aperta',
          fallbackDescription: `La cartella “${directoryName}” non è stata caricata. I file già aperti restano disponibili.`,
        }),
        recovery: { kind: 'load-directory', directoryId, directoryName },
      })
    } finally {
      loadingDirectories.current.delete(directoryId)
      setLoadingDirectory((current) => current === directoryId ? null : current)
    }
  }, [hasActiveProjectIdentityMutation, tree])


  const {
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
  } = useProjectEntryActions({
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
  })

  useEffect(() => {
    if (!initialState || initialState.expandedDirectoryIds.length === 0 || tree.length === 0) return
    const restoreKey = initialState.expandedDirectoryIds.join('\0')
    if (restoredExpandedKey.current === restoreKey) return
    restoredExpandedKey.current = restoreKey
    let cancelled = false

    void (async () => {
      const directoryIds = [...initialState.expandedDirectoryIds]
        .sort((left, right) => left.split('/').length - right.split('/').length)
      for (const directoryId of directoryIds) {
        try {
          const result = await editorBridge.files.listDirectory(directoryId)
          if (cancelled) return
          setTree((current) => replaceDirectoryChildren(current, directoryId, result.entries))
        } catch (error) {
          if (cancelled) return
          setExpanded((current) => {
            const next = new Set(current)
            next.delete(directoryId)
            return next
          })
          setExplorerFailure({
            error: reportEditorFailure(error, {
              category: 'filesystem',
              operation: 'restore-expanded-directory',
              severity: 'warning',
              title: 'Cartella non ripristinata',
              fallbackDescription: 'Una cartella salvata non è più disponibile. Gli altri file e tab sono stati ripristinati.',
            }),
            recovery: { kind: 'load-directory', directoryId, directoryName: directoryId.split('/').at(-1) ?? directoryId },
          })
        }
      }
    })()

    return () => { cancelled = true }
  }, [initialState, tree.length])

  const filteredTree = useMemo(() => filterEditorTree(tree, explorerQuery), [explorerQuery, tree])

  return {
    createFile,
    creatingFile,
    duplicateProjectEntryFromMenu,
    expanded,
    explorerFailure,
    explorerQuery,
    filteredTree,
    loadDirectory,
    loadingDirectory,
    newFileName,
    newFileRenameAttempt,
    newFileTrigger,
    openNewProjectDirectory,
    openRenameProjectEntry,
    projectEntryCanMutate,
    projectEntryDialog,
    projectEntryDialogInput,
    projectEntryDialogOpener,
    refreshExplorer,
    refreshingExplorer,
    requestCloseEditorTabs,
    requestTrashProjectEntry,
    selectedDirectoryId,
    setExpanded,
    setExplorerFailure,
    setExplorerQuery,
    setNewFileName,
    setProjectEntryDialog,
    setSelectedDirectoryId,
    setTree,
    submitProjectEntryDialog,
    tree,
    truncated,
  }
}
