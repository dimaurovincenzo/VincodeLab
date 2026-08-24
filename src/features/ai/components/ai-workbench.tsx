import { Suspense } from 'react'
import { BookOpen, ChevronDown, ChevronUp, RefreshCw, ScrollText, Search, TerminalSquare, X } from 'lucide-react'
import { Button, Field, IconButton, Spinner, Tabs } from '@/components/ui'
import { TerminalToolbar } from '@/components/terminal-toolbar'
import { TerminalPasteStatus } from './terminal-paste-status'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { shouldMountPersistentView, type PersistentViewState } from '@/lib/persistent-view-state'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { aiStyles } from '@/theme/styles/ai'
import { shellStyles } from '@/theme/styles/shell'
import { terminalStyles } from '@/theme/styles/terminal'
import { AiSessionErrorNotice } from './ai-session-error-notice'
import { ProjectInstructions, ProjectSkills } from './lazy-ai-views'
import { TerminalAttachments } from './terminal-attachments'
import type { AiRuntimeController } from '../hooks/use-ai-runtime'
import type { AiTab, TerminalContextAction } from '../model/ai-runtime.types'
import { terminalPasteRecoveryLabel } from '../services/ai-error'
import '@xterm/xterm/css/xterm.css'

type AiWorkbenchProps = {
  contextActions: TerminalContextAction[]
  loadedSections: PersistentViewState
  onInstructionsWorkspaceGuardChange: (guard: WorkspaceChangeGuard | null) => void
  onOpenSettings: () => void
  onSelectTab: (tab: AiTab) => void
  onSkillsWorkspaceGuardChange: (guard: WorkspaceChangeGuard | null) => void
  runtime: AiRuntimeController
  aiTab: AiTab
  workspace: string
}

export function AiWorkbench({
  contextActions,
  loadedSections,
  onInstructionsWorkspaceGuardChange,
  onOpenSettings,
  onSelectTab,
  onSkillsWorkspaceGuardChange,
  runtime,
  aiTab,
  workspace,
}: AiWorkbenchProps) {
  const {
    aiFailure,
    cancelTerminalPaste,
    changeFontSize,
    clearTerminal,
    closeTerminalPasteStatus,
    closeTerminalSearch,
    copyTerminalSelection,
    fontSize,
    hasUnreadTerminalOutput,
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
    status,
    streamState,
    terminalElement,
    terminalQuery,
    terminalSearchOpen,
    terminalStatus,
  } = runtime

  return (
    <Tabs.Content asChild key="ai" value="ai">
      <section className={`${shellStyles.sectionPage} ${aiStyles.workbench}`} key={workspace}>
        <Tabs.Root className={aiStyles.tabsRoot} value={aiTab} onValueChange={({ value }) => onSelectTab(value as AiTab)}>
          <Tabs.List className={aiStyles.tabsList} aria-label="Sezioni AI">
            <Tabs.Trigger value="terminal"><TerminalSquare aria-hidden="true" size={15} /> Terminale AI</Tabs.Trigger>
            <Tabs.Trigger value="skills"><BookOpen aria-hidden="true" size={15} /> Skill progetto</Tabs.Trigger>
            <Tabs.Trigger value="instructions"><ScrollText aria-hidden="true" size={15} /> Istruzioni progetto</Tabs.Trigger>
            <Tabs.Indicator />
          </Tabs.List>
          <Tabs.Content value="terminal" className={aiStyles.tabPanel}>
            <ViewErrorBoundary viewName="Terminale AI">
              <div className={terminalStyles.workspace} aria-label={`Terminale Pi: ${workspace}`}>
                <div className={terminalStyles.meta}>
                  <span className={`${terminalStyles.statusDot} ${status === 'launching' ? terminalStyles.statusLaunching : status === 'error' ? terminalStyles.statusError : status !== 'running' ? terminalStyles.statusInactive : ''}`} aria-hidden="true" />
                  <span>{workspace}</span>
                </div>
                <div className={terminalStyles.controls} aria-label="Controlli terminale">
                  {(streamState?.status === 'paused' || streamState?.status === 'stalled') && <div className={terminalStyles.streamStatus} role="status"><Spinner size={14} /> Rendering rallentato · recupero automatico in corso</div>}
                  {terminalSearchOpen ? (
                    <Field.Root className={terminalStyles.find}>
                      <Search aria-hidden="true" size={14} />
                      <Field.Input className={terminalStyles.findInput} autoFocus aria-label="Cerca nel terminale" onChange={(event) => setTerminalQuery(event.target.value)} placeholder="Cerca nel terminale" value={terminalQuery} />
                      <IconButton size="icon-xs" tooltip="Risultato precedente" onClick={() => terminalQuery && searchAddon.current?.findPrevious(terminalQuery)}><ChevronUp aria-hidden="true" size={14} /></IconButton>
                      <IconButton size="icon-xs" tooltip="Risultato successivo" onClick={() => terminalQuery && searchAddon.current?.findNext(terminalQuery)}><ChevronDown aria-hidden="true" size={14} /></IconButton>
                      <IconButton size="icon-xs" tooltip="Chiudi ricerca" onClick={closeTerminalSearch}><X aria-hidden="true" size={14} /></IconButton>
                    </Field.Root>
                  ) : <span className={terminalStyles.hint}>⌘F cerca · ⌘± zoom</span>}
                  <IconButton className={terminalStyles.reload} tooltip="Ricarica Pi" onClick={() => void reloadPi()}><RefreshCw aria-hidden="true" size={15} /></IconButton>
                  <TerminalToolbar fontSize={fontSize} statusLabel={terminalStatus} onClear={clearTerminal} onCopy={() => void copyTerminalSelection()} onPaste={() => void pasteIntoTerminal()} onResetZoom={resetTerminalZoom} onRestart={() => void restartPi()} onSearch={() => setTerminalSearchOpen(true)} onZoom={changeFontSize} />
                </div>
                <TerminalAttachments contextActions={contextActions} onInsert={sendAiInput} />
                <div className={terminalStyles.surface}><div className={terminalStyles.xtermHost} data-xterm-host="ai" key={workspace} ref={terminalElement} /></div>
                {pasteProgress && <TerminalPasteStatus
                  failure={pasteFailure?.error}
                  failureAction={pasteFailure && pasteFailure.recovery !== 'none'
                    ? { label: terminalPasteRecoveryLabel(pasteFailure.recovery), onClick: recoverTerminalPaste }
                    : undefined}
                  progress={pasteProgress}
                  onCancel={() => { void cancelTerminalPaste() }}
                  onClose={closeTerminalPasteStatus}
                />}
                {hasUnreadTerminalOutput && <Button className={terminalStyles.newOutput} size="sm" variant="subtle" onClick={revealTerminalOutput}>Nuovo output</Button>}
                {aiFailure && <AiSessionErrorNotice failure={aiFailure} onOpenSettings={onOpenSettings} onReload={reloadPi} onRestart={restartPi} onResumeOutput={retryAiOutput} onRetryTerminal={retryAiTerminal} />}
              </div>
            </ViewErrorBoundary>
          </Tabs.Content>
          {shouldMountPersistentView(loadedSections, 'skills', aiTab === 'skills') && (
            <Tabs.Content value="skills" className={aiStyles.tabPanel}>
              <ViewErrorBoundary viewName="Skill progetto">
                <Suspense fallback={<div className={terminalStyles.loading}>Caricamento Skill…</div>}>
                  <ProjectSkills workspace={workspace} onWorkspaceGuardChange={onSkillsWorkspaceGuardChange} />
                </Suspense>
              </ViewErrorBoundary>
            </Tabs.Content>
          )}
          {shouldMountPersistentView(loadedSections, 'instructions', aiTab === 'instructions') && (
            <Tabs.Content value="instructions" className={aiStyles.tabPanel}>
              <ViewErrorBoundary viewName="Istruzioni progetto">
                <Suspense fallback={<div className={terminalStyles.loading}>Caricamento istruzioni…</div>}>
                  <ProjectInstructions onWorkspaceGuardChange={onInstructionsWorkspaceGuardChange} />
                </Suspense>
              </ViewErrorBoundary>
            </Tabs.Content>
          )}
        </Tabs.Root>
      </section>
    </Tabs.Content>
  )
}
