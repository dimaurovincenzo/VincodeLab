import { Suspense } from 'react'
import { BookOpen, ChevronDown, ChevronUp, RefreshCw, ScrollText, Search, TerminalSquare, X } from 'lucide-react'
import { Button, Field, IconButton, Spinner, Tabs } from '@/components/ui'
import { TerminalToolbar } from '@/components/terminal-toolbar'
import { TerminalAttachments } from '@/features/ai'
import { TerminalPasteStatus } from '@/components/terminal-paste-status'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { shouldMountPersistentView } from '@/lib/persistent-view-state'
import { aiStyles } from '@/theme/styles/ai'
import { shellStyles } from '@/theme/styles/shell'
import { terminalStyles } from '@/theme/styles/terminal'
import { AiSessionErrorNotice } from './ai-session-error-notice'
import type { AppController } from '../hooks/use-app-controller'
import { terminalPasteRecoveryLabel } from '../services/app-controller-errors'
import { ProjectInstructions, ProjectSkills } from './lazy-workbench-views'
import '@xterm/xterm/css/xterm.css'

export function AiWorkbench({ controller }: { controller: AppController }) {
  const {
    aiContextActions,
    aiFailure,
    aiTab,
    cancelTerminalPaste,
    changeFontSize,
    clearTerminal,
    closeTerminalPasteStatus,
    closeTerminalSearch,
    copyTerminalSelection,
    fontSize,
    handleInstructionsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
    hasUnreadTerminalOutput,
    loadedSections,
    openAiSettings,
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
    selectAiTab,
    sendAiInput,
    setTerminalQuery,
    setTerminalSearchOpen,
    status,
    streamState,
    terminalElement,
    terminalQuery,
    terminalSearchOpen,
    terminalStatus,
    workspace,
  } = controller

  if (!workspace) return null

  return (
    <Tabs.Content asChild key="ai" value="ai">
      <section className={`${shellStyles.sectionPage} ${aiStyles.workbench}`} key={workspace}>
        <Tabs.Root className={aiStyles.tabsRoot} value={aiTab} onValueChange={({ value }) => selectAiTab(value as typeof aiTab)}>
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
                <TerminalAttachments contextActions={aiContextActions} onInsert={sendAiInput} />
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
                {aiFailure && <AiSessionErrorNotice failure={aiFailure} onOpenSettings={openAiSettings} onReload={reloadPi} onRestart={restartPi} onResumeOutput={retryAiOutput} onRetryTerminal={retryAiTerminal} />}
              </div>
            </ViewErrorBoundary>
          </Tabs.Content>
          {shouldMountPersistentView(loadedSections, 'skills', aiTab === 'skills') && (
            <Tabs.Content value="skills" className={aiStyles.tabPanel}>
              <ViewErrorBoundary viewName="Skill progetto">
                <Suspense fallback={<div className={terminalStyles.loading}>Caricamento Skill…</div>}>
                  <ProjectSkills workspace={workspace} onWorkspaceGuardChange={handleSkillsWorkspaceGuardChange} />
                </Suspense>
              </ViewErrorBoundary>
            </Tabs.Content>
          )}
          {shouldMountPersistentView(loadedSections, 'instructions', aiTab === 'instructions') && (
            <Tabs.Content value="instructions" className={aiStyles.tabPanel}>
              <ViewErrorBoundary viewName="Istruzioni progetto">
                <Suspense fallback={<div className={terminalStyles.loading}>Caricamento istruzioni…</div>}>
                  <ProjectInstructions onWorkspaceGuardChange={handleInstructionsWorkspaceGuardChange} />
                </Suspense>
              </ViewErrorBoundary>
            </Tabs.Content>
          )}
        </Tabs.Root>
      </section>
    </Tabs.Content>
  )
}
