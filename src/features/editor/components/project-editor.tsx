import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Braces, ChevronRight, ChevronsUpDown, CloudUpload, FileCode2, FileDiff, FilePlus2, FileText, FolderTree, RefreshCw, Save, Search, Sparkles, X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, Field, IconButton, Spinner, Splitter, Tabs, TreeView, createTreeCollection, type ErrorNoticeAction, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { EmptyState } from '@/components/empty-state'
import { RemoteDiffDialog } from './remote-diff-dialog'
import { editorStyles } from '@/theme/styles/editor'
import { confirmationDialogStyles } from '@/theme/styles/dialogs'
import { cx } from '../../../../styled-system/css'
import { useEditorCommands } from '../hooks/use-editor-commands'
import { useEditorFilePersistence } from '../hooks/use-editor-file-persistence'
import { useEditorGitStatus } from '../hooks/use-editor-git-status'
import { useEditorSession } from '../hooks/use-editor-session'
import { useEditorTabStore } from '../hooks/use-editor-tab-store'
import { useEditorTabs } from '../hooks/use-editor-tabs'
import { useEditorWorkspaceReset } from '../hooks/use-editor-workspace-reset'
import { useEditorPreferences } from '../hooks/use-editor-preferences'
import { useEditorRemoteFiles } from '../hooks/use-editor-remote-files'
import { usePersistentCodeMirror } from '../hooks/use-persistent-code-mirror'
import { useProjectMutationLock } from '../hooks/use-project-mutation-lock'
import { useProjectExplorer } from '../hooks/use-project-explorer'
import { previewLabelFor, remoteStateLabel } from '../model/editor-document'
import type { EditorFailure } from '../model/editor-runtime.types'
import { toEditorTreeNodes } from '../model/editor-tree'
import type { EditorTreeNode, ProjectEditorProps } from '../model/editor.types'
import { defaultFolderIcon, defaultFolderOpenedIcon, fileIconFor, folderIconFor, gitFileStatusClass, gitFileStatusLabel, remoteStatusClass } from './editor-icons'
import { StartTreeNodeRename } from './start-tree-node-rename'

const editorPanels: SplitterPanelData[] = [
  { id: 'editor-explorer', minSize: '220px', maxSize: '720px', collapsible: true, collapsedSize: '0px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'editor-document', minSize: '420px' },
]

export function ProjectEditor({ workspace, initialState, remoteOpenRequest = null, workbenchRequest = null, onContextChange, onOpenGitDiff, onSendContextToAi, onSessionChange, onWorkspaceGuardChange }: ProjectEditorProps) {
  const { editorAutoSave, editorFontSize, editorTabSize, editorWordWrap, explorerWidth } = useEditorPreferences()
  const explorerTree = useRef<HTMLDivElement>(null)
  const tabStore = useEditorTabStore(workspace)
  const {
    activationIntentRef: activationIntent,
    activeId,
    activeIdRef,
    activeTab,
    confirmation,
    documentFailure,
    fileConflicts,
    loadingFile,
    remoteComparison,
    remoteDiffFile,
    saveActiveRef,
    savingFileIds,
    setActiveId,
    setConfirmation,
    setRemoteComparison,
    setRemoteDiffFile,
    setTabs,
    tabs,
    tabsRef,
    uploadingRemote,
    workspaceRef,
  } = tabStore
  const saving = Boolean(activeId && savingFileIds.has(activeId))
  const activeFileConflict = activeTab ? fileConflicts.get(activeTab.id) : undefined
  const {
    beginMutation: beginProjectIdentityMutation,
    clearMutations: clearProjectIdentityMutations,
    hasActiveMutation: hasActiveProjectIdentityMutation,
  } = useProjectMutationLock()
  const {
    refresh: refreshGitStatus,
    refreshFromWarning: refreshGitStatusFromWarning,
    statusByDirectory: gitStatusByDirectory,
    statusByPath: gitStatusByPath,
  } = useEditorGitStatus()
  const codeMirror = usePersistentCodeMirror({
    activeId,
    activeTab,
    editorFontSize,
    editorTabSize,
    editorWordWrap,
    saveActiveRef,
    setTabs,
    tabsRef,
    workspaceRef,
  })
  const {
    bumpSessionRevision,
    clearFile: clearCodeMirrorFile,
    collectFileViews,
    focus: focusEditor,
    hostRef: codeMirrorHostRef,
    openSearch: openEditorSearch,
    renameFile: renameCodeMirrorFile,
    restoreActiveFileView,
    restoreFileView,
    selection,
    sessionRevision,
  } = codeMirror

  const focusExplorer = useCallback(() => {
    requestAnimationFrame(() => {
      const tree = explorerTree.current
      const target = tree?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ?? tree
      target?.focus()
    })
  }, [])

  const {
    clearFileConflict,
    recordFileConflict,
    requestOverwriteWorkspaceFile,
    requestReloadWorkspaceFile,
    saveActive,
    saveAll,
    saveEditorTabById,
  } = useEditorFilePersistence({
    editorAutoSave,
    focusEditor,
    onWorkspaceGuardChange,
    refreshGitStatus,
    refreshGitStatusFromWarning,
    store: tabStore,
    workspace,
  })

  const {
    activateTab,
    canToggleTextPreview,
    closeTab,
    closeTabConfirmed,
    cycleOpenTab,
    openFile,
    openRemoteFile,
    toggleTextPreview,
  } = useEditorTabs({
    clearCodeMirrorFile,
    clearFileConflict,
    focusEditor,
    focusExplorer,
    hasActiveProjectIdentityMutation,
    recordFileConflict,
    remoteOpenRequest,
    store: tabStore,
    workspace,
  })
  const { compareRemoteFile, requestRemoteUpload, uploadRemoteFile } = useEditorRemoteFiles(tabStore)
  const {
    createFile,
    creatingFile,
    contentMatches,
    contentSearchError,
    contentSearchLoading,
    contentSearchTruncated,
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
    retryContentSearch,
    requestCloseEditorTabs,
    requestTrashProjectEntry,
    selectedDirectoryId,
    setExpanded,
    setExplorerFailure,
    setExplorerQuery,
    setNewFileName,
    setProjectEntryDialog,
    setSelectedDirectoryId,
    submitProjectEntryDialog,
    tree,
    truncated,
  } = useProjectExplorer({
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
    store: tabStore,
    workspace,
  })
  useEditorWorkspaceReset({ clearProjectIdentityMutations, setExplorerFailure, store: tabStore, workspace })

  useEffect(() => {
    onContextChange?.({
      activeFileId: activeTab?.id ?? null,
      activeFileName: activeTab?.name ?? null,
      dirty: Boolean(activeTab && activeTab.content !== activeTab.savedContent),
      source: activeTab?.source ?? null,
      selection: activeTab && !activeTab.preview && !activeTab.remote?.binary ? selection : null,
    })
  }, [activeTab, onContextChange, selection])

  const { restoreReady: sessionRestoreReady } = useEditorSession({
    activeId,
    activeIdRef,
    activationIntentRef: activationIntent,
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
  })
  useEditorCommands({
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
    store: tabStore,
    tree,
    workbenchRequest,
  })

  const recoveryActionFor = (failure: EditorFailure): ErrorNoticeAction | undefined => {
    const recovery = failure.recovery
    if (!recovery) return undefined
    switch (recovery.kind) {
      case 'refresh-explorer': return { label: 'Riprova', onClick: () => refreshExplorer(true) }
      case 'open-workspace-file': return { label: 'Riapri file', onClick: () => openFile(recovery.fileId) }
      case 'open-remote-file': return { label: 'Riapri file remoto', onClick: () => openRemoteFile(recovery.fileId) }
      case 'save-all': return { label: 'Salva i file', onClick: saveAll }
      case 'save-file': return { label: 'Riprova salvataggio', onClick: () => saveEditorTabById(recovery.fileId) }
      case 'compare-remote': return { label: 'Riprova confronto', onClick: compareRemoteFile }
      case 'upload-remote': return { label: 'Riprova caricamento', onClick: () => uploadRemoteFile(recovery.force) }
      case 'create-file': return { label: 'Riprova creazione', onClick: () => createFile(recovery.fileName) }
      case 'load-directory': return { label: 'Riprova apertura', onClick: () => loadDirectory(recovery.directoryId, recovery.directoryName) }
    }
  }

  const draftDirectoryId = newFileName === null ? undefined : selectedDirectoryId ?? ''
  const newFileNodeValue = draftDirectoryId === undefined ? null : `editor:new-file:${draftDirectoryId || 'root'}`
  const editorTreeCollection = useMemo(() => createTreeCollection<EditorTreeNode>({
    isNodeDisabled: (node) => (node.kind === 'file' && loadingFile !== null) || (node.kind === 'new-file' && creatingFile),
    nodeToChildren: (node) => 'children' in node ? node.children ?? [] : [],
    nodeToChildrenCount: (node) => node.kind === 'directory' ? node.loaded ? node.children?.length ?? 0 : 1 : undefined,
    nodeToString: (node) => node.name,
    nodeToValue: (node) => node.value,
    rootNode: {
      kind: 'root',
      value: 'editor:root',
      name: 'File del progetto',
      children: [
        ...(draftDirectoryId === '' ? [{ kind: 'new-file' as const, value: 'editor:new-file:root', name: newFileName ?? '', directoryId: '' }] : []),
        ...toEditorTreeNodes(filteredTree, draftDirectoryId, newFileName ?? ''),
      ],
    },
  }), [creatingFile, draftDirectoryId, filteredTree, loadingFile, newFileName])
  const editorExpandedValue = useMemo(() => [...expanded].filter((value) => editorTreeCollection.findNode(value)?.kind === 'directory'), [editorTreeCollection, expanded])
  const editorSelectedValue = useMemo(() => {
    const value = selectedDirectoryId ?? (activeTab?.source === 'workspace' ? activeTab.id : null)
    return value && editorTreeCollection.findNode(value) ? [value] : []
  }, [activeTab, editorTreeCollection, selectedDirectoryId])

  const renderEditorTreeNode = (node: EditorTreeNode, indexPath: number[]): ReactNode => <TreeView.NodeProvider indexPath={indexPath} key={node.value} node={node}>
    {node.kind === 'root' ? node.children.map((child, index) => renderEditorTreeNode(child, [index])) : node.kind === 'new-file' ? <TreeView.Item className={editorStyles.newFileForm}>
      {creatingFile ? <Spinner className={editorStyles.fileIcon} /> : <FilePlus2 aria-hidden="true" className={editorStyles.fileIcon} />}
      <TreeView.NodeContext>{({ renaming }) => <TreeView.ItemText className={editorStyles.treeLabel} hidden={renaming}>{creatingFile ? 'Creazione…' : node.name || 'Nuovo file'}</TreeView.ItemText>}</TreeView.NodeContext>
      <TreeView.Context>{({ cancelRenaming }) => <TreeView.NodeRenameInput aria-label="Nome del nuovo file" autoComplete="off" className={editorStyles.newFileInput} disabled={creatingFile} onBlurCapture={(event) => {
        if (event.currentTarget.value.trim()) return
        cancelRenaming()
        setNewFileName(null)
      }} onChange={(event) => {
        setNewFileName(event.currentTarget.value)
      }} onKeyDownCapture={(event) => {
        const cancelFromKeyboard = event.key === 'Escape' || (event.key === 'Enter' && !event.currentTarget.value.trim())
        if (!cancelFromKeyboard) return
        if (event.key === 'Enter') cancelRenaming()
        setNewFileName(null)
        window.setTimeout(() => newFileTrigger.current?.focus(), 0)
      }} placeholder="Nome file" value={newFileName ?? ''} />}</TreeView.Context>
      {!creatingFile && newFileNodeValue === node.value && <StartTreeNodeRename attempt={newFileRenameAttempt} value={node.value} />}
    </TreeView.Item> : node.kind === 'file' ? (() => {
      const gitFile = gitStatusByPath.get(node.id)
      const gitStatus = gitFile ? gitFileStatusLabel(gitFile) : null
      return <TreeView.Item className={activeId === node.id ? editorStyles.treeActive : editorStyles.treeFile} data-workspace-context-id={node.id} data-workspace-context-kind="workspace-file" title={node.id}>
        {loadingFile === node.id ? <Spinner size={14} /> : fileIconFor(node.name) ? <Icon icon={fileIconFor(node.name)!} aria-hidden="true" className={editorStyles.fileIcon} /> : <FileCode2 aria-hidden="true" size={14} />}<TreeView.ItemText className={editorStyles.treeLabel}>{node.name}</TreeView.ItemText>{gitFile && gitStatus && <small aria-label={gitFileStatusLabel(gitFile).description} className={gitFileStatusClass(gitFile)} title={gitStatus.description}>{gitStatus.code}</small>}
      </TreeView.Item>
    })() : (() => {
      const isExpanded = expanded.has(node.id)
      const changedFiles = gitStatusByDirectory.get(node.id)
      return <TreeView.Branch>
        <TreeView.BranchControl className={selectedDirectoryId === node.id ? editorStyles.treeDirectorySelected : editorStyles.treeDirectory} data-context-expanded={isExpanded ? 'true' : undefined} data-workspace-context-id={node.id} data-workspace-context-kind="workspace-directory" title={selectedDirectoryId === node.id ? 'Cartella selezionata per i nuovi file' : node.id}>
          <TreeView.BranchTrigger aria-label={`${node.name}: espandi o comprimi`}>{loadingDirectory === node.id ? <Spinner size={14} /> : <TreeView.BranchIndicator><ChevronRight aria-hidden="true" size={14} /></TreeView.BranchIndicator>}</TreeView.BranchTrigger>
          <TreeView.BranchText><Icon icon={folderIconFor(node.name) ?? (isExpanded ? defaultFolderOpenedIcon : defaultFolderIcon)} aria-hidden="true" className={editorStyles.fileIcon} /><span className={editorStyles.treeLabel}>{node.name}</span>{changedFiles && <small aria-label={`Git: ${changedFiles} file modificati nella cartella`} className={editorStyles.gitStatusModified} title={`Git: ${changedFiles} file modificati nella cartella`}>M</small>}</TreeView.BranchText>
        </TreeView.BranchControl>
        <TreeView.BranchContent>{node.children?.map((child, index) => renderEditorTreeNode(child, [...indexPath, index]))}</TreeView.BranchContent>
      </TreeView.Branch>
    })()}
  </TreeView.NodeProvider>

  return <Splitter.Root asChild defaultFixedSize={explorerWidth} panels={editorPanels} storageKey={`vincodelab.editor.explorer-width:${workspace}`}><section className={editorStyles.workbench} aria-label="Editor progetto">
    <Splitter.Panel asChild id="editor-explorer"><aside className={editorStyles.explorer}>
      <div className={editorStyles.explorerTitle}><span className={editorStyles.explorerTitleLabel}><FolderTree aria-hidden="true" size={14} /> Explorer</span><div className={editorStyles.explorerActions}><span className={editorStyles.explorerActionCount} aria-label={`${tree.length} elementi alla radice`}>{tree.length}</span><IconButton ref={newFileTrigger} tooltip="Nuovo file" className={editorStyles.explorerActionButton} aria-label="Nuovo file" disabled={newFileName !== null} onClick={() => { setExplorerQuery(''); setNewFileName('') }}><FilePlus2 aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Comprimi cartelle" className={editorStyles.explorerActionButton} aria-label="Comprimi cartelle" disabled={expanded.size === 0} onClick={() => { setExpanded(new Set()); setSelectedDirectoryId(null) }}><ChevronsUpDown aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Aggiorna explorer" className={editorStyles.explorerActionButton} aria-label="Aggiorna explorer" disabled={refreshingExplorer} onClick={() => void refreshExplorer()}>{refreshingExplorer ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" size={14} />}</IconButton></div></div>
      <Field.Root className={editorStyles.explorerSearch}><Search aria-hidden="true" size={14} /><Field.Input className={editorStyles.explorerSearchInput} aria-label="Cerca file e contenuti nell’explorer" value={explorerQuery} onChange={(event) => setExplorerQuery(event.target.value)} placeholder="Cerca file e contenuti…" type="search" />{contentSearchLoading && <Spinner aria-label="Ricerca nei contenuti" size={13} />}</Field.Root>
      {explorerFailure && <ErrorNotice action={recoveryActionFor(explorerFailure)} className={editorStyles.failure} error={explorerFailure.error} />}
      <TreeView.Root canRename={(node) => node.kind === 'new-file' && !creatingFile} collection={editorTreeCollection} data-workspace-context-id="" data-workspace-context-kind="workspace-root" expandedValue={editorExpandedValue} selectedValue={editorSelectedValue} selectionMode="single" translations={{ renameInputLabel: 'Nome del nuovo file', treeLabel: 'File del progetto' }} typeahead onExpandedChange={({ expandedNodes, expandedValue }) => {
        const nextExpanded = new Set(expandedValue)
        setExpanded(nextExpanded)
        if (selectedDirectoryId && expanded.has(selectedDirectoryId) && !nextExpanded.has(selectedDirectoryId)) setSelectedDirectoryId(null)
        for (const node of expandedNodes) if (node.kind === 'directory' && !node.loaded) void loadDirectory(node.id, node.name)
      }} onRenameComplete={({ label, value }) => {
        if (value !== newFileNodeValue) return
        setNewFileName(label)
        void createFile(label)
      }} onSelectionChange={({ selectedNodes }) => {
        const node = selectedNodes.at(-1)
        if (node?.kind === 'directory') setSelectedDirectoryId(node.id)
        if (node?.kind === 'file' && loadingFile === null) { setSelectedDirectoryId(null); void openFile(node.id) }
      }} className={editorStyles.tree}>
        <TreeView.Tree ref={explorerTree}>{editorTreeCollection.getNodeChildren(editorTreeCollection.rootNode).map((node, index) => renderEditorTreeNode(node, [index]))}</TreeView.Tree>
        {filteredTree.length === 0 && newFileName === null && <p className={editorStyles.treeMessage}>{explorerQuery ? 'Nessun nome o percorso corrispondente.' : 'Nessun file modificabile.'}</p>}
        {explorerQuery.trim().length > 0 && <section aria-label="Corrispondenze nei contenuti" className={editorStyles.contentSearchResults}>
          <header className={editorStyles.contentSearchHeader}><strong>Nel contenuto</strong><span>{contentSearchLoading ? 'Ricerca…' : `${contentMatches.length} file`}</span></header>
          {explorerQuery.trim().length < 2 ? <p className={editorStyles.contentSearchMessage}>Inserisci almeno 2 caratteri.</p> : contentSearchError ? <ErrorNotice action={{ label: 'Riprova', onClick: retryContentSearch }} className={editorStyles.contentSearchFailure} error={contentSearchError} /> : !contentSearchLoading && contentMatches.length === 0 ? <p className={editorStyles.contentSearchMessage}>Nessuna corrispondenza nei contenuti.</p> : <ul className={editorStyles.contentSearchList}>{contentMatches.map((match) => <li key={match.fileId}>
            <Button className={editorStyles.contentSearchResult} title={`${match.fileId}:${match.line}:${match.column}`} variant="plain" onClick={() => void openFile(match.fileId)}>
              <span className={editorStyles.contentSearchFile}><FileText aria-hidden="true" size={13} /><strong>{match.fileName}</strong><small>riga {match.line}</small></span>
              <code>{match.preview || '(riga vuota)'}</code>
              <span>{match.directory || 'radice'}</span>
            </Button>
          </li>)}</ul>}
          {contentSearchTruncated && <p className={editorStyles.contentSearchWarning}>Mostrati i primi 100 file. Restringi la ricerca.</p>}
        </section>}
        {truncated && <p className={editorStyles.treeWarning}>Elenco limitato a 2.000 elementi.</p>}
      </TreeView.Root>
    </aside></Splitter.Panel>
    <Splitter.ResizeTrigger aria-label="Ridimensiona Explorer" id="editor-explorer:editor-document" title="Trascina per ridimensionare l’Explorer. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
    <Splitter.Panel id="editor-document"><Tabs.Root className={editorStyles.document} value={activeId ?? ''} onValueChange={({ value }) => activateTab(value || null)}>
      <div className={editorStyles.tabsHeader}>
        <Splitter.CollapseTrigger collapseLabel="Nascondi Explorer" expandLabel="Mostra Explorer" panelId="editor-explorer" />
        <Tabs.List className={editorStyles.tabs} aria-label="File aperti">{tabs.map((tab) => {
        const contextId = tab.source === 'remote' && tab.remote ? tab.remote.file.id : tab.id
        return <div className={activeId === tab.id ? editorStyles.tabSelected : editorStyles.tab} data-context-dirty={tab.content !== tab.savedContent ? 'true' : undefined} data-context-has-other-tabs={tabs.length > 1 ? 'true' : undefined} data-context-has-right-tabs={tabs.indexOf(tab) < tabs.length - 1 ? 'true' : undefined} data-workspace-context-id={contextId} data-workspace-context-kind={tab.source === 'remote' ? 'editor-remote-tab' : 'editor-workspace-tab'} key={tab.id}><Tabs.Trigger className={editorStyles.tabTrigger} value={tab.id}>{fileIconFor(tab.name) ? <Icon icon={fileIconFor(tab.name)!} aria-hidden="true" className={editorStyles.fileIcon} /> : <FileText aria-hidden="true" size={13} />}{tab.name}{tab.content !== tab.savedContent && <i className={editorStyles.tabModified} aria-label="Modificato" />}</Tabs.Trigger><IconButton tooltip={`Chiudi ${tab.name}`} size="icon-xs" className={editorStyles.tabClose} aria-label={`Chiudi ${tab.name}`} disabled={savingFileIds.has(tab.id)} onClick={() => closeTab(tab.id)}><X aria-hidden="true" size={13} /></IconButton></div>
      })}<Tabs.Indicator /></Tabs.List>
      </div>
      <Tabs.Content className={editorStyles.filePanel} value={activeId ?? ''}>
        {documentFailure && <ErrorNotice action={recoveryActionFor(documentFailure)} className={editorStyles.failure} error={documentFailure.error} />}
        {activeTab ? <>
          <div className={editorStyles.toolbar}>
            <div className={editorStyles.fileMeta}>
              <span className={editorStyles.fileBreadcrumb} title={activeTab.remote?.file.remotePath ?? activeTab.id}>{activeTab.remote?.file.remotePath ?? activeTab.id}</span>
              <span className={editorStyles.languageBadge}><Braces aria-hidden="true" size={13} />{previewLabelFor(activeTab.preview, activeTab.name)}</span>
              {activeTab.remote
                ? <span className={remoteStatusClass(activeTab.remote.file.localState)} title={activeTab.remote.connectionTitle}>{remoteStateLabel(activeTab.remote.file.localState)}</span>
                : <span className={activeTab.content === activeTab.savedContent ? editorStyles.savedStatus : editorStyles.saveStatus}>{activeTab.preview ? 'Anteprima' : saving ? 'Salvataggio…' : activeTab.content === activeTab.savedContent ? 'Salvato' : 'Modifiche non salvate'}</span>}
            </div>
            {activeTab.source === 'workspace' && <div className={editorStyles.toolbarActions} aria-label="Azioni contestuali del file">
              {onOpenGitDiff && <Button size="sm" variant="plain" onClick={() => onOpenGitDiff(activeTab.id)} title="Apri il diff Git del file corrente"><FileDiff aria-hidden="true" /> Diff</Button>}
              {onSendContextToAi && <Button size="sm" variant="subtle" onClick={() => onSendContextToAi(Boolean(selection))} title={selection ? 'Invia file e righe selezionate a Pi' : 'Invia il file corrente a Pi'}><Sparkles aria-hidden="true" /> {selection ? 'Pi · selezione' : 'Chiedi a Pi'}</Button>}
            </div>}
            {canToggleTextPreview && <div className={editorStyles.toolbarActions}><Button aria-label={activeTab.preview ? 'Mostra sorgente' : 'Mostra anteprima'} title={activeTab.preview ? 'Mostra sorgente Markdown o CSV' : 'Mostra anteprima Markdown o CSV'} variant="outline" size="sm" onClick={toggleTextPreview}>{activeTab.preview ? 'Mostra sorgente' : 'Mostra anteprima'}</Button></div>}
            {!activeTab.preview && !activeTab.remote?.binary && <><span className={editorStyles.shortcuts}>⌘S salva · ⌘F cerca</span><div className={editorStyles.toolbarActions}><IconButton tooltip="Cerca nel file (⌘F)" aria-label="Cerca nel file" variant="outline" onClick={openEditorSearch}><Search aria-hidden="true" /></IconButton><IconButton tooltip={activeFileConflict ? 'Risolvi il conflitto prima di salvare' : activeTab.remote ? 'Salva nella cache locale (⌘S)' : 'Salva file (⌘S)'} aria-label={activeTab.remote ? 'Salva copia locale' : 'Salva file'} variant="solid" onClick={() => void saveActive()} disabled={saving || Boolean(activeFileConflict) || activeTab.content === activeTab.savedContent}><Save aria-hidden="true" /></IconButton></div></>}
            {activeTab.remote && <div className={cx(editorStyles.toolbarActions, editorStyles.remoteActions)}><Button aria-label="Confronta con il server" title="Confronta la copia locale con il server" variant="outline" size="sm" onClick={() => void compareRemoteFile()} disabled={activeTab.content !== activeTab.savedContent}><FileDiff aria-hidden="true" /> Confronta</Button><Button aria-label="Carica sul server" title={activeTab.content !== activeTab.savedContent ? 'Salva prima la copia locale' : 'Controlla le differenze prima del caricamento'} size="sm" onClick={() => void compareRemoteFile()} disabled={activeTab.content !== activeTab.savedContent}><CloudUpload aria-hidden="true" /> Carica</Button></div>}
          </div>
          {activeFileConflict?.instance === activeTab.instance && <ErrorNotice
            action={{ label: 'Ricarica dal disco', onClick: () => requestReloadWorkspaceFile(activeFileConflict) }}
            error={activeFileConflict.error}
            secondaryAction={{ label: 'Sovrascrivi file', onClick: () => requestOverwriteWorkspaceFile(activeFileConflict) }}
          />}
          {activeTab.remote?.binary && <EmptyState className={editorStyles.remoteBinary} eyebrow="File remoto binario" icon={<FileCode2 size={30} />} title="Anteprima non disponibile" description="Puoi confrontare gli hash e caricare una nuova versione dal pannello di confronto." />}
        </> : <EmptyState className={editorStyles.empty} eyebrow="Explorer" icon={<FileCode2 size={30} />} title="Apri un file" description="Seleziona un file testuale dall’explorer per iniziare a modificarlo." />}
        <div className={cx('codemirror-host', editorStyles.codeMirrorHost)} hidden={!activeTab || Boolean(activeTab.remote?.binary)} ref={codeMirrorHostRef} />
      </Tabs.Content>
    </Tabs.Root></Splitter.Panel>
    <Dialog.Root
      finalFocusEl={() => projectEntryDialogOpener.current}
      ids={{ title: 'project-entry-dialog-title' }}
      initialFocusEl={() => projectEntryDialogInput.current}
      lazyMount
      open={projectEntryDialog !== null}
      unmountOnExit
      onOpenChange={({ open }) => { if (!open && !projectEntryDialog?.busy) setProjectEntryDialog(null) }}
    >
      <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={confirmationDialogStyles.content}>
        <p className={confirmationDialogStyles.eyebrow}>{projectEntryDialog?.mode === 'rename' ? 'Elemento del workspace' : 'Explorer'}</p>
        <Dialog.Title id="project-entry-dialog-title">{projectEntryDialog?.mode === 'rename' ? 'Rinomina elemento' : 'Nuova cartella'}</Dialog.Title>
        <Field.Root invalid={Boolean(projectEntryDialog?.error)}>
          <Field.Label>{projectEntryDialog?.mode === 'rename' ? 'Nuovo nome' : 'Nome cartella'}</Field.Label>
          <Field.Input ref={projectEntryDialogInput} autoComplete="off" disabled={projectEntryDialog?.busy} value={projectEntryDialog?.value ?? ''} onChange={(event) => setProjectEntryDialog((current) => current ? { ...current, error: null, value: event.target.value } : current)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitProjectEntryDialog() } }} />
        </Field.Root>
        {projectEntryDialog?.error && <ErrorNotice action={{ label: 'Riprova', onClick: submitProjectEntryDialog }} error={projectEntryDialog.error} />}
        <div className={confirmationDialogStyles.actions}><Dialog.CloseTrigger asChild unstyled><Button disabled={projectEntryDialog?.busy} variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={projectEntryDialog?.busy || !projectEntryDialog?.value.trim()} onClick={() => void submitProjectEntryDialog()}>{projectEntryDialog?.busy ? <Spinner size={14} /> : null}{projectEntryDialog?.mode === 'rename' ? 'Rinomina' : 'Crea cartella'}</Button></div>
      </Dialog.Content></Dialog.Positioner></Dialog.Portal>
    </Dialog.Root>
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    {remoteDiffFile && remoteComparison && <RemoteDiffDialog file={remoteDiffFile} comparison={remoteComparison} busy={uploadingRemote} onClose={() => { setRemoteDiffFile(null); setRemoteComparison(null) }} onUpload={() => requestRemoteUpload(false)} onForceUpload={() => requestRemoteUpload(true)} />}
  </section></Splitter.Root>
}
