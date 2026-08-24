import { useCallback, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { CommandPaletteMode } from '@/components/command-palette'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { WorkbenchCommandRegistry } from '@/lib/workbench-command-registry'
import { WorkbenchUsageHistory } from '@/lib/workbench-history'
import {
  emptyDatabaseContext,
  emptyEditorContext,
  emptyGitHubContext,
  emptyRedisContext,
  type WorkbenchCommandContext,
} from '../model/app-controller.types'
import { useAppNavigation } from './use-app-navigation'
import { useAppContextMenu } from './use-app-context-menu'
import { useWorkspacePersistence } from './use-workspace-persistence'
import { useWorkspaceCloseGuards } from './use-workspace-close-guards'
import { useWorkbenchCommands } from './use-workbench-commands'
import { useWorkspaceLifecycle, useWorkspaceLifecycleState } from './use-workspace-lifecycle'
import { useAiFailure } from './use-ai-failure'
import { useAppAppearance } from './use-app-appearance'
import { useAiTerminalRuntime } from './use-ai-terminal-runtime'
import { useAiContext } from './use-ai-context'

export function useAppController() {
  const { preferences: appPreferences } = useAppPreferences()
  const [commandRegistry] = useState(() => new WorkbenchCommandRegistry<WorkbenchCommandContext>({
    hasWorkspace: false,
    section: 'ai',
    aiTab: 'terminal',
    editor: emptyEditorContext,
    github: emptyGitHubContext,
    database: emptyDatabaseContext,
    redis: emptyRedisContext,
  }))
  const [usageHistory] = useState(() => new WorkbenchUsageHistory())
  const preferredTerminalFontSize = effectivePreference(appPreferences, 'terminal.fontSize', 11)
  const preferredTerminalFontFamily = effectivePreference(appPreferences, 'terminal.fontFamily', 'system-mono')
  const preferredTerminalCursorStyle = effectivePreference(appPreferences, 'terminal.cursorStyle', 'bar') as 'bar' | 'block' | 'underline'
  const preferredTerminalScrollback = effectivePreference(appPreferences, 'terminal.scrollback', 10_000)
  const terminalElement = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const getTerminal = useCallback(() => terminal.current, [])
  const getTerminalElement = useCallback(() => terminalElement.current, [])
  const setTerminalInstance = useCallback((instance: Terminal | null) => { terminal.current = instance }, [])
  const lifecycleState = useWorkspaceLifecycleState()
  const {
    homeFailure,
    openingWorkspacePath,
    recents,
    setStatus,
    status,
    workspace,
    workspaceOpenFailure,
  } = lifecycleState
  const {
    aiTab,
    appSection,
    databaseContext,
    databaseFocusRequest,
    editorContext,
    editorWorkbenchRequest,
    githubContext,
    githubWorkbenchRequest,
    loadedSections,
    navigateToAppSection,
    openAiSettings,
    openGitDiffForFile,
    openRemoteFileInEditor,
    openWorkspaceFile,
    redisContext,
    redisFocusRequest,
    remoteOpenRequest,
    requestEditorAction,
    requestTerminalAction,
    resetForWorkspace: resetNavigationForWorkspace,
    restoreNavigation,
    search,
    selectAiTab,
    selectAppSection,
    setDatabaseContext,
    setEditorContext,
    setGitHubContext,
    setRedisContext,
    setSearch,
    setView,
    settingsRuntimeRequest,
    terminalActionRequest,
    terminalFocusRequest,
    view,
  } = useAppNavigation({ terminal, usageHistory, workspace })
  const {
    flushUntilClean,
    recoverWorkspaceSession,
    refreshWorkspaceSessionForRecovery,
    resetWorkspaceSession,
    restoreWorkspaceSession,
    setWorkspaceSessionRecovery,
    updateDatabaseSession,
    updateEditorSession,
    updateGitHubSession,
    updateRedisSession,
    updateTerminalSession,
    workspaceSession,
    workspaceSessionRecovery,
    workspaceSessionState,
  } = useWorkspacePersistence({ aiTab, appSection, workspace })
  const { aiFailure, aiFailureRef, clearAiFailure, publishAiFailure, restoreAiFailure, showEndedAiSession } = useAiFailure()
  const { appearance, changeAppearance } = useAppAppearance(selectAppSection)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteMode, setPaletteMode] = useState<CommandPaletteMode>('commands')
  const [indexedFiles, setIndexedFiles] = useState<ProjectFileIndexEntry[]>([])
  const [indexingFiles, setIndexingFiles] = useState(false)
  const fileIndexRequest = useRef(0)
  const beginFileIndexRequest = useCallback(() => {
    fileIndexRequest.current += 1
    return fileIndexRequest.current
  }, [])
  const isCurrentFileIndexRequest = useCallback((request: number) => request === fileIndexRequest.current, [])
  const resetCommandSurfaceForWorkspace = useCallback(() => {
    setIndexedFiles([])
    fileIndexRequest.current += 1
    setPaletteOpen(false)
  }, [])
  const {
    cancelTerminalPaste,
    changeFontSize,
    clearTerminal,
    closeTerminalPasteStatus,
    closeTerminalSearch,
    copyTerminalSelection,
    fontSize,
    hasUnreadTerminalOutput,
    loadAiTerminalPreferences,
    pasteFailure,
    pasteIntoTerminal,
    pasteProgress,
    recoverTerminalPaste,
    reloadPi,
    resetTerminalZoom,
    restartPi,
    retryAiOutput,
    retryAiTerminal,
    revealTerminalOutput,
    searchAddon,
    sendAiInput,
    setTerminalQuery,
    setTerminalSearchOpen,
    streamState,
    terminalQuery,
    terminalSearchOpen,
    updateHasUnreadTerminalOutput,
    updateTerminalStreamState,
  } = useAiTerminalRuntime({
    aiFailureRef,
    aiTab,
    appSection,
    clearAiFailure,
    getTerminal,
    getTerminalElement,
    paletteOpen,
    preferredTerminalCursorStyle,
    preferredTerminalFontFamily,
    preferredTerminalFontSize,
    preferredTerminalScrollback,
    publishAiFailure,
    setStatus,
    setTerminalInstance,
    showEndedAiSession,
    terminal,
    workspace,
  })



  const {
    openWorkspaceInNewInstance,
    performWorkspaceChange,
    refreshRecents,
    revealWorkspace,
  } = useWorkspaceLifecycle({
    aiFailure,
    clearAiFailure,
    lifecycleState,
    loadAiTerminalPreferences,
    publishAiFailure,
    resetCommandSurfaceForWorkspace,
    resetNavigationForWorkspace,
    resetWorkspaceSession,
    restoreAiFailure,
    restoreNavigation,
    restoreWorkspaceSession,
    setWorkspaceSessionRecovery,
    updateHasUnreadTerminalOutput,
    updateTerminalStreamState,
    workspaceSession,
  })

  const {
    cancelLifecycleClose,
    completeLifecycleClose,
    discardAndChangeWorkspace,
    handleDatabaseWorkspaceGuardChange,
    handleEditorWorkspaceGuardChange,
    handleInstructionsWorkspaceGuardChange,
    handleSettingsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
    lifecycleCloseRequest,
    openRecentWorkspace,
    openWorkspace,
    requestWorkspaceChange,
    saveWorkspaceGuardScope,
    saveAndChangeWorkspace,
    savingBeforeLifecycleClose,
    savingBeforeWorkspaceChange,
    setWorkspaceChangeRequest,
    workspaceChangeRequest,
  } = useWorkspaceCloseGuards({ flushUntilClean, performWorkspaceChange })


  useAppContextMenu({ commandRegistry, openRecentWorkspace, openWorkspaceInNewInstance })


  const { aiContextActions, sendEditorContextToAi } = useAiContext({
    databaseContext,
    editorContext,
    githubContext,
    navigateToAppSection,
    sendAiInput,
  })


  const { paletteItems, selectPaletteItem } = useWorkbenchCommands({
    aiTab,
    appSection,
    changeFontSize,
    clearTerminal,
    commandRegistry,
    copyTerminalSelection,
    databaseContext,
    editorContext,
    beginFileIndexRequest,
    githubContext,
    indexedFiles,
    isCurrentFileIndexRequest,
    navigateToAppSection,
    openGitDiffForFile,
    openRecentWorkspace,
    openWorkspace,
    openWorkspaceFile,
    paletteMode,
    paletteOpen,
    pasteIntoTerminal,
    recents,
    redisContext,
    reloadPi,
    requestEditorAction,
    requestTerminalAction,
    resetTerminalZoom,
    restartPi,
    revealWorkspace,
    saveWorkspaceGuardScope,
    selectAiTab,
    selectAppSection,
    sendEditorContextToAi,
    setIndexedFiles,
    setIndexingFiles,
    setPaletteMode,
    setPaletteOpen,
    setTerminalSearchOpen,
    terminal,
    usageHistory,
    workspace,
  })



  const filteredRecents = recents.filter((recent) => recent.path.toLocaleLowerCase('it-IT').includes(search.toLocaleLowerCase('it-IT')))
  const terminalStatus = status === 'running' ? 'Pi pronto' : status === 'launching' ? 'Avvio Pi…' : status === 'ended' ? 'Sessione terminata' : status === 'error' ? 'Errore Pi' : 'In attesa'

  return {
    aiContextActions,
    aiFailure,
    aiTab,
    appSection,
    appearance,
    cancelLifecycleClose,
    cancelTerminalPaste,
    changeAppearance,
    changeFontSize,
    clearTerminal,
    closeTerminalPasteStatus,
    closeTerminalSearch,
    completeLifecycleClose,
    copyTerminalSelection,
    databaseFocusRequest,
    discardAndChangeWorkspace,
    editorWorkbenchRequest,
    filteredRecents,
    fontSize,
    githubWorkbenchRequest,
    handleDatabaseWorkspaceGuardChange,
    handleEditorWorkspaceGuardChange,
    handleInstructionsWorkspaceGuardChange,
    handleSettingsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
    hasUnreadTerminalOutput,
    homeFailure,
    indexingFiles,
    lifecycleCloseRequest,
    loadedSections,
    openAiSettings,
    openRecentWorkspace,
    openRemoteFileInEditor,
    openWorkspace,
    openWorkspaceFile,
    openWorkspaceInNewInstance,
    openingWorkspacePath,
    paletteItems,
    paletteMode,
    paletteOpen,
    pasteFailure,
    pasteIntoTerminal,
    pasteProgress,
    recents,
    recoverTerminalPaste,
    recoverWorkspaceSession,
    redisFocusRequest,
    refreshRecents,
    refreshWorkspaceSessionForRecovery,
    reloadPi,
    remoteOpenRequest,
    requestWorkspaceChange,
    resetTerminalZoom,
    restartPi,
    retryAiOutput,
    retryAiTerminal,
    saveAndChangeWorkspace,
    savingBeforeLifecycleClose,
    savingBeforeWorkspaceChange,
    search,
    searchAddon,
    selectAiTab,
    selectAppSection,
    selectPaletteItem,
    sendAiInput,
    sendEditorContextToAi,
    setDatabaseContext,
    setEditorContext,
    setGitHubContext,
    setPaletteOpen,
    setRedisContext,
    setSearch,
    setTerminalQuery,
    setTerminalSearchOpen,
    setView,
    setWorkspaceChangeRequest,
    settingsRuntimeRequest,
    status,
    streamState,
    terminalActionRequest,
    terminalElement,
    terminalFocusRequest,
    terminalQuery,
    terminalSearchOpen,
    terminalStatus,
    updateDatabaseSession,
    updateEditorSession,
    updateGitHubSession,
    updateRedisSession,
    updateTerminalSession,
    view,
    workspace,
    workspaceChangeRequest,
    workspaceOpenFailure,
    workspaceSessionRecovery,
    workspaceSessionState,
    openGitDiffForFile,
    revealTerminalOutput,
  }
}

export type AppController = ReturnType<typeof useAppController>
