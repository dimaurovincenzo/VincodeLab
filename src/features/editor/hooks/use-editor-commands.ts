import { useEffect, useRef } from 'react'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { editorBridge } from '../api/editor.bridge'
import { editorTabCloseTargets, editorWorkbenchCycleDirection } from '../model/editor.commands'
import { findProjectTreeEntry } from '../model/editor-tree'
import type { ProjectEditorProps } from '../model/editor.types'
import { reportEditorFailure } from '../services/editor-error'
import type { EditorTabStore } from './use-editor-tab-store'

type EditorCommandOptions = {
  activeId: string | null
  closeTab: (fileId: string) => void
  compareRemoteFile: () => Promise<void>
  cycleOpenTab: (offset: -1 | 1) => void
  duplicateProjectEntryFromMenu: (entryId: string, entryKind: 'file' | 'directory') => Promise<void>
  focusEditor: () => void
  focusExplorer: () => void
  loadDirectory: (directoryId: string, directoryName: string) => Promise<void>
  openEditorSearch: () => void
  openFile: (fileId: string, focusAfterOpen?: boolean, activateAfterOpen?: boolean) => Promise<void>
  openNewProjectDirectory: (parentId: string) => void
  openRenameProjectEntry: (entryId: string, entryKind: 'file' | 'directory') => void
  projectEntryCanMutate: (entryId: string, entryKind: 'file' | 'directory') => boolean
  refreshExplorer: (quiet?: boolean) => Promise<void>
  requestCloseEditorTabs: (fileIds: string[]) => void
  requestTrashProjectEntry: (entryId: string, entryKind: 'file' | 'directory') => void
  saveActive: () => Promise<void>
  saveEditorTabById: (fileId: string, options?: { force?: boolean }) => Promise<void>
  sessionRestoreReady: boolean
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>
  setExplorerQuery: React.Dispatch<React.SetStateAction<string>>
  setNewFileName: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedDirectoryId: React.Dispatch<React.SetStateAction<string | null>>
  store: EditorTabStore
  tree: ProjectFileTreeNode[]
  workbenchRequest: ProjectEditorProps['workbenchRequest']
}

export function useEditorCommands({
  activeId,
  closeTab,
  compareRemoteFile,
  cycleOpenTab,
  duplicateProjectEntryFromMenu,
  focusEditor,
  focusExplorer,
  loadDirectory,
  openEditorSearch,
  openFile,
  openNewProjectDirectory,
  openRenameProjectEntry,
  projectEntryCanMutate,
  refreshExplorer,
  requestCloseEditorTabs,
  requestTrashProjectEntry,
  saveActive,
  saveEditorTabById,
  sessionRestoreReady,
  setExpanded,
  setExplorerQuery,
  setNewFileName,
  setSelectedDirectoryId,
  store,
  tree,
  workbenchRequest,
}: EditorCommandOptions) {
  const {
    activationIntentRef,
    activeIdRef,
    setActiveId,
    setDocumentFailure,
    tabsRef,
  } = store
  const handledWorkbenchRequest = useRef<number | null>(null)

  useEffect(() => {
    if (!sessionRestoreReady || !workbenchRequest || handledWorkbenchRequest.current === workbenchRequest.nonce) return
    handledWorkbenchRequest.current = workbenchRequest.nonce

    if (workbenchRequest.kind === 'open-file') {
      void openFile(workbenchRequest.fileId)
      return
    }
    if (workbenchRequest.kind === 'focus-editor') {
      if (activeId) focusEditor()
      else focusExplorer()
      return
    }
    if (workbenchRequest.kind === 'focus-explorer') {
      focusExplorer()
      return
    }
    if (workbenchRequest.kind === 'close-active') {
      const fileId = activeIdRef.current
      if (fileId) closeTab(fileId)
      return
    }

    const cycleDirection = editorWorkbenchCycleDirection(workbenchRequest)
    if (cycleDirection) cycleOpenTab(cycleDirection)
  }, [activeId, activeIdRef, closeTab, cycleOpenTab, focusEditor, focusExplorer, openFile, sessionRestoreReady, workbenchRequest])

  useEffect(() => editorBridge.contextMenu?.onAction?.((action) => {
    const contextId = action.contextId ?? ''
    if (action.command === 'workspaceFile.open' && contextId) { void openFile(contextId); return }
    if (action.command === 'workspaceFile.rename' && contextId) { openRenameProjectEntry(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.rename' && contextId) { openRenameProjectEntry(contextId, 'directory'); return }
    if (action.command === 'workspaceFile.duplicate' && contextId) { void duplicateProjectEntryFromMenu(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.duplicate' && contextId) { void duplicateProjectEntryFromMenu(contextId, 'directory'); return }
    if (action.command === 'workspaceFile.trash' && contextId) { requestTrashProjectEntry(contextId, 'file'); return }
    if (action.command === 'workspaceDirectory.trash' && contextId) { requestTrashProjectEntry(contextId, 'directory'); return }
    if (action.command === 'workspaceDirectory.newFile') {
      if (!projectEntryCanMutate(contextId, 'directory')) return
      setExplorerQuery('')
      setSelectedDirectoryId(contextId || null)
      setNewFileName('')
      return
    }
    if (action.command === 'workspaceDirectory.newDirectory') { openNewProjectDirectory(contextId); return }
    if (action.command === 'workspaceDirectory.expand' && contextId) {
      setExpanded((current) => new Set(current).add(contextId))
      const directory = findProjectTreeEntry(tree, contextId)
      if (directory?.kind === 'directory' && directory.children === undefined) void loadDirectory(contextId, directory.name)
      return
    }
    if (action.command === 'workspaceDirectory.collapse' && contextId) {
      setExpanded((current) => { const next = new Set(current); next.delete(contextId); return next })
      setSelectedDirectoryId((current) => current === contextId ? null : current)
      return
    }
    if (action.command === 'workspaceExplorer.collapseAll') { setExpanded(new Set()); setSelectedDirectoryId(null); return }
    if (action.command === 'workspaceExplorer.refresh') { void refreshExplorer(); return }

    const tabId = action.contextKind === 'editor-remote-tab' ? `remote:${contextId}` : contextId
    const tabIndex = tabsRef.current.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) return
    const targetTab = tabsRef.current[tabIndex]
    if (action.command === 'editorTab.save') { void saveEditorTabById(tabId); return }
    const closeTargets = editorTabCloseTargets(action.command, tabsRef.current.map((tab) => tab.id), tabId)
    if (closeTargets) { requestCloseEditorTabs(closeTargets); return }
    if (targetTab.source !== 'remote' || !targetTab.remote) return
    activationIntentRef.current += 1
    activeIdRef.current = targetTab.id
    setActiveId(targetTab.id)
    if (action.command === 'editorRemote.compare' || action.command === 'editorRemote.upload') { void compareRemoteFile(); return }
    if (action.command === 'editorRemote.reveal') {
      void editorBridge.remoteFiles.revealLocal(targetTab.remote.file.id).catch((error) => {
        setDocumentFailure({
          error: reportEditorFailure(error, {
            category: 'filesystem',
            operation: 'reveal-remote-local-copy',
            title: 'Copia locale non mostrata',
            fallbackDescription: 'Il file è rimasto aperto nell’Editor. Verifica il Finder e riprova.',
          }),
          fileId: targetTab.id,
        })
      })
    }
  }) ?? (() => undefined), [activationIntentRef, activeIdRef, compareRemoteFile, duplicateProjectEntryFromMenu, loadDirectory, openFile, openNewProjectDirectory, openRenameProjectEntry, projectEntryCanMutate, refreshExplorer, requestCloseEditorTabs, requestTrashProjectEntry, saveEditorTabById, setActiveId, setDocumentFailure, setExpanded, setExplorerQuery, setNewFileName, setSelectedDirectoryId, tabsRef, tree])

  useApplicationMenuCommand('editor.save', () => { void saveActive() })
  useApplicationMenuCommand('editor.search', openEditorSearch)
  useApplicationMenuCommand('editor.focusExplorer', focusExplorer)
  useApplicationMenuCommand('editor.nextTab', () => cycleOpenTab(1))
  useApplicationMenuCommand('editor.previousTab', () => cycleOpenTab(-1))
  useApplicationMenuCommand('editor.close', () => { if (activeIdRef.current) closeTab(activeIdRef.current) })
  useApplicationMenuCommand('editor.refresh', () => { void refreshExplorer() })
}
