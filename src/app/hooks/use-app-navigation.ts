import { useCallback, useEffect, useRef, useState } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import type { DatabaseWorkbenchContext } from '@/features/database'
import type { EditorWorkbenchContext, EditorWorkbenchRequest, RemoteOpenRequest } from '@/features/editor'
import type { GitHubWorkbenchContext, GitHubWorkbenchRequest } from '@/features/github'
import type { RedisWorkbenchContext } from '@/features/redis'
import type { TerminalWorkspaceAction, TerminalWorkspaceActionRequest } from '@/features/terminal'
import { createPersistentViewState, visitPersistentView } from '@/lib/persistent-view-state'
import type { WorkbenchUsageHistory } from '@/lib/workbench-history'
import {
  emptyDatabaseContext,
  emptyEditorContext,
  emptyGitHubContext,
  emptyRedisContext,
  type AppSection,
} from '../model/app-controller.types'

type UseAppNavigationOptions = {
  usageHistory: WorkbenchUsageHistory
  workspace: string | null
}

export function useAppNavigation({ usageHistory, workspace }: UseAppNavigationOptions) {
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [aiTab, setAiTab] = useState<'terminal' | 'skills' | 'instructions'>('terminal')
  const [appSection, setAppSection] = useState<AppSection>('ai')
  const [settingsRuntimeRequest, setSettingsRuntimeRequest] = useState(0)
  const [loadedSections, setLoadedSections] = useState(createPersistentViewState)
  const [editorContext, setEditorContext] = useState<EditorWorkbenchContext>(emptyEditorContext)
  const [githubContext, setGitHubContext] = useState<GitHubWorkbenchContext>(emptyGitHubContext)
  const [databaseContext, setDatabaseContext] = useState<DatabaseWorkbenchContext>(emptyDatabaseContext)
  const [redisContext, setRedisContext] = useState<RedisWorkbenchContext>(emptyRedisContext)
  const [editorWorkbenchRequest, setEditorWorkbenchRequest] = useState<EditorWorkbenchRequest | null>(null)
  const [githubWorkbenchRequest, setGitHubWorkbenchRequest] = useState<GitHubWorkbenchRequest | null>(null)
  const [aiFocusRequest, setAiFocusRequest] = useState(0)
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0)
  const [terminalActionRequest, setTerminalActionRequest] = useState<TerminalWorkspaceActionRequest | undefined>()
  const [databaseFocusRequest, setDatabaseFocusRequest] = useState(0)
  const [redisFocusRequest, setRedisFocusRequest] = useState(0)
  const [remoteOpenRequest, setRemoteOpenRequest] = useState<RemoteOpenRequest | null>(null)
  const remoteOpenNonce = useRef(0)
  const workbenchRequestNonce = useRef(0)

  const selectAppSection = useCallback((section: AppSection) => {
    setAppSection(section)
    if (section !== 'ai') setLoadedSections((current) => visitPersistentView(current, section))
  }, [])

  const selectAiTab = useCallback((tab: 'terminal' | 'skills' | 'instructions') => {
    setAiTab(tab)
    if (tab !== 'terminal') setLoadedSections((current) => visitPersistentView(current, tab))
  }, [])

  const navigateToAppSection = useCallback((section: AppSection, focusPrimary = false) => {
    selectAppSection(section)
    if (!focusPrimary) return
    workbenchRequestNonce.current += 1
    const nonce = workbenchRequestNonce.current
    if (section === 'ai') {
      selectAiTab('terminal')
      setAiFocusRequest(nonce)
    }
    if (section === 'editor') setEditorWorkbenchRequest({ kind: 'focus-editor', nonce })
    if (section === 'terminal') setTerminalFocusRequest(nonce)
    if (section === 'github') setGitHubWorkbenchRequest({ kind: 'focus-primary', nonce })
    if (section === 'database') setDatabaseFocusRequest(nonce)
    if (section === 'redis') setRedisFocusRequest(nonce)
  }, [selectAiTab, selectAppSection])

  const requestEditorAction = useCallback((kind: Exclude<EditorWorkbenchRequest['kind'], 'open-file'>) => {
    selectAppSection('editor')
    workbenchRequestNonce.current += 1
    setEditorWorkbenchRequest({ kind, nonce: workbenchRequestNonce.current })
  }, [selectAppSection])

  const requestTerminalAction = useCallback((action: TerminalWorkspaceAction) => {
    selectAppSection('terminal')
    workbenchRequestNonce.current += 1
    setTerminalActionRequest({ action, id: workbenchRequestNonce.current })
  }, [selectAppSection])

  const openWorkspaceFile = useCallback((fileId: string) => {
    selectAppSection('editor')
    workbenchRequestNonce.current += 1
    setEditorWorkbenchRequest({ kind: 'open-file', fileId, nonce: workbenchRequestNonce.current })
    if (workspace) usageHistory.recordFile(fileId, workspace)
  }, [selectAppSection, usageHistory, workspace])

  const openRemoteFileInEditor = useCallback((fileId: string) => {
    remoteOpenNonce.current += 1
    setRemoteOpenRequest({ id: fileId, nonce: remoteOpenNonce.current })
    selectAppSection('editor')
  }, [selectAppSection])

  const openGitDiffForFile = useCallback((filePath: string) => {
    selectAppSection('github')
    workbenchRequestNonce.current += 1
    setGitHubWorkbenchRequest({ kind: 'open-file-diff', filePath, nonce: workbenchRequestNonce.current })
  }, [selectAppSection])

  const openAiSettings = useCallback(() => {
    setSettingsRuntimeRequest((current) => current + 1)
    setAppSection('settings')
    setLoadedSections((current) => visitPersistentView(current, 'settings'))
  }, [])

  const resetForWorkspace = useCallback(() => {
    setLoadedSections(createPersistentViewState())
    setRemoteOpenRequest(null)
    setEditorWorkbenchRequest(null)
    setGitHubWorkbenchRequest(null)
    setTerminalActionRequest(undefined)
    setEditorContext(emptyEditorContext)
    setGitHubContext(emptyGitHubContext)
    setDatabaseContext(emptyDatabaseContext)
    setRedisContext(emptyRedisContext)
    setAppSection('ai')
    setAiTab('terminal')
  }, [])

  const restoreNavigation = useCallback((state: WorkspaceSessionState) => {
    setAppSection(state.navigation.section)
    setAiTab(state.navigation.aiTab)
    const restoredSection = state.navigation.section
    setLoadedSections((current) => {
      let next = current
      if (restoredSection !== 'ai') next = visitPersistentView(next, restoredSection)
      if (state.navigation.aiTab !== 'terminal') next = visitPersistentView(next, state.navigation.aiTab)
      return next
    })
  }, [])

  useEffect(() => {
    const section: AppMenuSection = workspace
      ? appSection === 'ai' && aiTab !== 'terminal' ? `ai-${aiTab}` : appSection
      : appSection === 'settings' ? 'settings' : 'home'
    appBridge.appMenu.setContext(section)
  }, [aiTab, appSection, workspace])

  return {
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
    resetForWorkspace,
    restoreNavigation,
    search,
    selectAiTab,
    selectAppSection,
    setAppSection,
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
  }
}

export type AppNavigationController = ReturnType<typeof useAppNavigation>
