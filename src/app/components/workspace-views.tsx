import { Suspense } from 'react'
import { Tabs } from '@/components/ui'
import { BenchmarkViewFaultProbe } from '@/components/benchmark-view-fault-probe'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { AiWorkbench } from '@/features/ai'
import { shouldMountPersistentView } from '@/lib/persistent-view-state'
import { shellStyles } from '@/theme/styles/shell'
import { terminalStyles } from '@/theme/styles/terminal'
import type { AppController } from '../hooks/use-app-controller'
import { AppSettings, DatabaseWorkspace, GitHubWorkspace, ProjectEditor, RedisWorkspace, TerminalWorkspace } from './lazy-workbench-views'

export function WorkspaceViews({ controller }: { controller: AppController }) {
  const {
    aiContextActions,
    aiRuntime,
    aiTab,
    appSection,
    appearance,
    databaseFocusRequest,
    editorWorkbenchRequest,
    githubWorkbenchRequest,
    handleDatabaseWorkspaceGuardChange,
    handleEditorWorkspaceGuardChange,
    handleInstructionsWorkspaceGuardChange,
    handleSettingsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
    loadedSections,
    openAiSettings,
    openGitDiffForFile,
    openRemoteFileInEditor,
    openWorkspaceFile,
    redisFocusRequest,
    refreshWorkspaceSessionForRecovery,
    remoteOpenRequest,
    sendEditorContextToAi,
    selectAiTab,
    setDatabaseContext,
    setEditorContext,
    setGitHubContext,
    setRedisContext,
    settingsRuntimeRequest,
    terminalActionRequest,
    terminalFocusRequest,
    updateDatabaseSession,
    updateEditorSession,
    updateGitHubSession,
    updateRedisSession,
    updateTerminalSession,
    workspace,
    workspaceSessionState,
    changeAppearance,
  } = controller

  if (!workspace) return null

  return (
    <div className={shellStyles.sectionStack}>
      {shouldMountPersistentView(loadedSections, 'settings', appSection === 'settings') && (
        <Tabs.Content asChild key="settings" value="settings">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="Impostazioni">
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento impostazioni…</div>}>
                <AppSettings active={appSection === 'settings'} appearance={appearance} openRuntimeRequest={settingsRuntimeRequest} onAppearanceChange={changeAppearance} onWorkspaceGuardChange={handleSettingsWorkspaceGuardChange} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      <AiWorkbench
        contextActions={aiContextActions}
        aiTab={aiTab}
        loadedSections={loadedSections}
        runtime={aiRuntime}
        workspace={workspace}
        onInstructionsWorkspaceGuardChange={handleInstructionsWorkspaceGuardChange}
        onOpenSettings={openAiSettings}
        onSelectTab={selectAiTab}
        onSkillsWorkspaceGuardChange={handleSkillsWorkspaceGuardChange}
      />
      {(loadedSections.editor || appSection === 'editor') && (
        <Tabs.Content asChild key="editor" value="editor">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="Editor" onRetry={refreshWorkspaceSessionForRecovery}>
              <BenchmarkViewFaultProbe viewName="Editor" />
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento editor…</div>}>
                <ProjectEditor initialState={workspaceSessionState?.editor} key={workspace} remoteOpenRequest={remoteOpenRequest} workspace={workspace} workbenchRequest={editorWorkbenchRequest} onContextChange={setEditorContext} onOpenGitDiff={openGitDiffForFile} onSendContextToAi={sendEditorContextToAi} onSessionChange={updateEditorSession} onWorkspaceGuardChange={handleEditorWorkspaceGuardChange} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      {(loadedSections.terminal || appSection === 'terminal') && (
        <Tabs.Content asChild key="terminal" value="terminal">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="Terminale" onRetry={refreshWorkspaceSessionForRecovery}>
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento terminale…</div>}>
                <TerminalWorkspace actionRequest={terminalActionRequest} active={appSection === 'terminal'} focusRequest={terminalFocusRequest} initialState={workspaceSessionState?.terminal} key={workspace} workspace={workspace} onSessionChange={updateTerminalSession} onOpenRemoteFile={openRemoteFileInEditor} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      {(loadedSections.github || appSection === 'github') && (
        <Tabs.Content asChild key="github" value="github">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="GitHub" onRetry={refreshWorkspaceSessionForRecovery}>
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento GitHub…</div>}>
                <GitHubWorkspace active={appSection === 'github'} initialState={workspaceSessionState?.github} key={workspace} workspace={workspace} workbenchRequest={githubWorkbenchRequest} onContextChange={setGitHubContext} onOpenFile={openWorkspaceFile} onSessionChange={updateGitHubSession} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      {(loadedSections.database || appSection === 'database') && (
        <Tabs.Content asChild key="database" value="database">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="Database" onRetry={refreshWorkspaceSessionForRecovery}>
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento Database…</div>}>
                <DatabaseWorkspace focusRequest={databaseFocusRequest} initialState={workspaceSessionState?.database} key={workspace} workspace={workspace} onContextChange={setDatabaseContext} onSessionChange={updateDatabaseSession} onWorkspaceGuardChange={handleDatabaseWorkspaceGuardChange} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      {(loadedSections.redis || appSection === 'redis') && (
        <Tabs.Content asChild key="redis" value="redis">
          <section className={shellStyles.sectionPage}>
            <ViewErrorBoundary viewName="Redis" onRetry={refreshWorkspaceSessionForRecovery}>
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento Redis…</div>}>
                <RedisWorkspace focusRequest={redisFocusRequest} initialState={workspaceSessionState?.redis} key={workspace} workspace={workspace} onContextChange={setRedisContext} onSessionChange={updateRedisSession} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
    </div>
  )
}
