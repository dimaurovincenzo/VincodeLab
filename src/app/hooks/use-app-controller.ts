import { useCallback, useRef, useState } from 'react'
import type { ProjectFileIndexEntry } from '@/bridge'
import type { CommandPaletteMode } from '@/components/command-palette'
import { useAiRuntime } from '@/features/ai'
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
import { useAppAppearance } from './use-app-appearance'
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
    aiFocusRequest,
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
  } = useAppNavigation({ usageHistory, workspace })
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
  const aiRuntime = useAiRuntime({
    active: appSection === 'ai' && aiTab === 'terminal',
    focusRequest: aiFocusRequest,
    paletteOpen,
    preferredTerminalCursorStyle,
    preferredTerminalFontFamily,
    preferredTerminalFontSize,
    preferredTerminalScrollback,
    setStatus,
    status,
    workspace,
  })



  const {
    openWorkspaceInNewInstance,
    performWorkspaceChange,
    refreshRecents,
    revealWorkspace,
  } = useWorkspaceLifecycle({
    aiFailure: aiRuntime.aiFailure,
    clearAiFailure: aiRuntime.clearAiFailure,
    lifecycleState,
    loadAiTerminalPreferences: aiRuntime.loadAiTerminalPreferences,
    publishAiFailure: aiRuntime.publishAiFailure,
    resetCommandSurfaceForWorkspace,
    resetNavigationForWorkspace,
    resetWorkspaceSession,
    restoreAiFailure: aiRuntime.restoreAiFailure,
    restoreNavigation,
    restoreWorkspaceSession,
    setWorkspaceSessionRecovery,
    updateHasUnreadTerminalOutput: aiRuntime.updateHasUnreadTerminalOutput,
    updateTerminalStreamState: aiRuntime.updateTerminalStreamState,
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
    sendAiInput: aiRuntime.sendAiInput,
  })


  const { paletteItems, selectPaletteItem } = useWorkbenchCommands({
    aiTab,
    appSection,
    changeFontSize: aiRuntime.changeFontSize,
    clearTerminal: aiRuntime.clearTerminal,
    commandRegistry,
    copyTerminalSelection: aiRuntime.copyTerminalSelection,
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
    pasteIntoTerminal: aiRuntime.pasteIntoTerminal,
    recents,
    redisContext,
    reloadPi: aiRuntime.reloadPi,
    requestEditorAction,
    requestTerminalAction,
    resetTerminalZoom: aiRuntime.resetTerminalZoom,
    restartPi: aiRuntime.restartPi,
    revealWorkspace,
    saveWorkspaceGuardScope,
    selectAllTerminal: aiRuntime.selectAllTerminal,
    selectAiTab,
    selectAppSection,
    sendEditorContextToAi,
    setIndexedFiles,
    setIndexingFiles,
    setPaletteMode,
    setPaletteOpen,
    setTerminalSearchOpen: aiRuntime.setTerminalSearchOpen,
    usageHistory,
    workspace,
  })



  const filteredRecents = recents.filter((recent) => recent.path.toLocaleLowerCase('it-IT').includes(search.toLocaleLowerCase('it-IT')))
  return {
    aiContextActions,
    aiRuntime,
    aiTab,
    appSection,
    appearance,
    cancelLifecycleClose,
    changeAppearance,
    completeLifecycleClose,
    databaseFocusRequest,
    discardAndChangeWorkspace,
    editorWorkbenchRequest,
    filteredRecents,
    githubWorkbenchRequest,
    handleDatabaseWorkspaceGuardChange,
    handleEditorWorkspaceGuardChange,
    handleInstructionsWorkspaceGuardChange,
    handleSettingsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
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
    recents,
    recoverWorkspaceSession,
    redisFocusRequest,
    refreshRecents,
    refreshWorkspaceSessionForRecovery,
    remoteOpenRequest,
    requestWorkspaceChange,
    saveAndChangeWorkspace,
    savingBeforeLifecycleClose,
    savingBeforeWorkspaceChange,
    search,
    selectAiTab,
    selectAppSection,
    selectPaletteItem,
    sendEditorContextToAi,
    setDatabaseContext,
    setEditorContext,
    setGitHubContext,
    setPaletteOpen,
    setRedisContext,
    setSearch,
    setView,
    setWorkspaceChangeRequest,
    settingsRuntimeRequest,
    status,
    terminalActionRequest,
    terminalFocusRequest,
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
  }
}

export type AppController = ReturnType<typeof useAppController>
