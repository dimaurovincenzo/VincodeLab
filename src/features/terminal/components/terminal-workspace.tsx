import { ChevronLeft, ChevronRight, FolderOpen, Plus, TerminalSquare, X } from 'lucide-react'
import { RemoteFiles } from '@/features/remote-files'
import { Button, ErrorNotice, IconButton, Spinner, Tabs } from '@/components/ui'
import { terminalStyles } from '@/theme/styles/terminal'
import { useTerminalWorkspaceController } from '../hooks/use-terminal-workspace-controller'
import { terminalSessionUiStatus, type TerminalSessionUiStatus } from '../model/terminal-session'
import type { TerminalWorkspaceActionRequest } from '../model/terminal-workspace'
import { FreeTerminal } from './free-terminal'

export type {
  TerminalWorkspaceAction,
  TerminalWorkspaceActionRequest,
} from '../model/terminal-workspace'

type Props = {
  active: boolean
  workspace: string
  focusRequest?: number
  actionRequest?: TerminalWorkspaceActionRequest
  initialState?: WorkspaceSessionState['terminal']
  onSessionChange?: (state: Pick<WorkspaceSessionState['terminal'], 'tab' | 'openSessionCount' | 'activeSessionOrdinal'>) => void
  onOpenRemoteFile: (fileId: string) => void
}

function statusLabel(status: TerminalSessionUiStatus) {
  if (status === 'starting') return 'Avvio in corso'
  if (status === 'ready') return 'Pronto'
  if (status === 'exited') return 'Terminato'
  return 'Errore'
}

function statusClassName(status: TerminalSessionUiStatus) {
  if (status === 'starting') return terminalStyles.sessionStatusStarting
  if (status === 'ready') return terminalStyles.sessionStatusReady
  if (status === 'exited') return terminalStyles.sessionStatusExited
  return terminalStyles.sessionStatusError
}

export function TerminalWorkspace({
  active,
  workspace,
  focusRequest = 0,
  actionRequest,
  initialState,
  onSessionChange,
  onOpenRemoteFile,
}: Props) {
  const {
    activeSessionId,
    atSessionLimit,
    closeActiveSession,
    closingSessionIds,
    connectProfile,
    connectionId,
    createSession,
    creating,
    cycleSession,
    feedback,
    focusSession,
    loading,
    openProfileComposer,
    profileComposerRequests,
    recoverFromFeedback,
    reportSessionStatus,
    sessionLimit,
    sessions,
    sessionStatuses,
    setConnectionId,
    setTab,
    tab,
    terminalFocusRequest,
  } = useTerminalWorkspaceController({
    actionRequest,
    focusRequest,
    initialState,
    onSessionChange,
    workspace,
  })

  return (
    <Tabs.Root
      aria-label="Terminale e file remoti"
      className={terminalStyles.sectionWorkspace}
      lazyMount={false}
      unmountOnExit={false}
      value={tab}
      onValueChange={({ value }) => setTab(value as typeof tab)}
    >
      <Tabs.List className={terminalStyles.secondaryTabs} aria-label="Strumenti terminale">
        <Tabs.Trigger value="shell"><TerminalSquare aria-hidden="true" size={14} /> Terminali</Tabs.Trigger>
        <Tabs.Trigger value="remote"><FolderOpen aria-hidden="true" size={14} /> File remoti</Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>

      <Tabs.Content value="shell" className={terminalStyles.toolPanel}>
        <section className={terminalStyles.sessionWorkspace} aria-label="Sessioni terminale">
          {loading && sessions.length === 0 ? (
            <div className={terminalStyles.sessionEmpty} role="status">
              <Spinner size={16} /> Inizializzazione terminali…
            </div>
          ) : sessions.length > 0 ? (
            <Tabs.Root
              className={terminalStyles.sessionRoot}
              lazyMount={false}
              unmountOnExit={false}
              value={activeSessionId ?? undefined}
              onValueChange={({ value }) => { if (value) void focusSession(value) }}
            >
              <div className={terminalStyles.sessionBar}>
                <IconButton
                  disabled={sessions.length < 2}
                  size="icon-xs"
                  tooltip="Terminale precedente"
                  onClick={() => cycleSession(-1)}
                >
                  <ChevronLeft aria-hidden="true" size={14} />
                </IconButton>
                <Tabs.List className={terminalStyles.sessionTabs} aria-label="Terminali aperti">
                  {sessions.map((session) => {
                    const currentStatus = sessionStatuses[session.sessionId] ?? terminalSessionUiStatus(session.status)
                    return (
                      <Tabs.Trigger
                        aria-label={`${session.title}, ${statusLabel(currentStatus)}`}
                        className={terminalStyles.sessionTrigger}
                        data-context-can-create={!atSessionLimit && !creating ? 'true' : undefined}
                        data-context-menu-id={session.sessionId}
                        data-context-menu-kind="terminal-tab"
                        data-context-operable={!closingSessionIds.has(session.sessionId) && currentStatus !== 'starting' ? 'true' : undefined}
                        key={session.sessionId}
                        value={session.sessionId}
                      >
                        <span aria-hidden="true" className={`${terminalStyles.sessionStatusDot} ${statusClassName(currentStatus)}`} />
                        <span className={terminalStyles.sessionTitle}>{session.title}</span>
                      </Tabs.Trigger>
                    )
                  })}
                </Tabs.List>
                <div className={terminalStyles.sessionActions}>
                  <IconButton
                    disabled={sessions.length < 2}
                    size="icon-xs"
                    tooltip="Terminale successivo"
                    onClick={() => cycleSession(1)}
                  >
                    <ChevronRight aria-hidden="true" size={14} />
                  </IconButton>
                  <IconButton
                    disabled={creating || atSessionLimit}
                    size="icon-xs"
                    tooltip={atSessionLimit ? `Limite di ${sessionLimit} terminali raggiunto` : 'Nuovo terminale'}
                    onClick={() => void createSession()}
                  >
                    <Plus aria-hidden="true" size={14} />
                  </IconButton>
                  <IconButton
                    disabled={!activeSessionId || closingSessionIds.has(activeSessionId)}
                    size="icon-xs"
                    tooltip="Chiudi terminale attivo"
                    onClick={closeActiveSession}
                  >
                    <X aria-hidden="true" size={14} />
                  </IconButton>
                </div>
              </div>
              <div className={terminalStyles.sessionPanels}>
                {sessions.map((session) => (
                  <Tabs.Content className={terminalStyles.sessionPanel} key={session.sessionId} value={session.sessionId}>
                    <FreeTerminal
                      active={active && tab === 'shell' && activeSessionId === session.sessionId}
                      focusRequest={activeSessionId === session.sessionId ? terminalFocusRequest : 0}
                      initialStatus={session.status}
                      profileComposerRequest={profileComposerRequests[session.sessionId] ?? 0}
                      sessionId={session.sessionId}
                      workspace={workspace}
                      onManagedConnection={setConnectionId}
                      onStatusChange={reportSessionStatus}
                    />
                  </Tabs.Content>
                ))}
              </div>
            </Tabs.Root>
          ) : (
            <div className={terminalStyles.sessionEmpty} role="status">
              <TerminalSquare aria-hidden="true" size={20} />
              <span>Nessun terminale aperto.</span>
              <Button size="sm" onClick={() => void createSession()}>
                <Plus aria-hidden="true" size={14} /> Nuovo terminale
              </Button>
            </div>
          )}

          {atSessionLimit && (
            <div className={terminalStyles.sessionLimit} role="status">
              Limite di {sessionLimit} terminali raggiunto.
            </div>
          )}
          {feedback?.kind === 'status' && (
            <div className={terminalStyles.sessionFeedback} role="status"><span>{feedback.message}</span></div>
          )}
          {feedback?.kind === 'error' && (
            <ErrorNotice
              action={feedback.recovery ? { label: feedback.recovery.label, onClick: recoverFromFeedback } : undefined}
              error={feedback.error}
            />
          )}
        </section>
      </Tabs.Content>

      <Tabs.Content value="remote" className={terminalStyles.toolPanel}>
        <RemoteFiles
          active={active && tab === 'remote'}
          preferredConnectionId={connectionId}
          workspace={workspace}
          onConnectProfile={connectProfile}
          onCreateSshProfile={() => { void openProfileComposer() }}
          onOpenRemoteFile={onOpenRemoteFile}
        />
      </Tabs.Content>
    </Tabs.Root>
  )
}
