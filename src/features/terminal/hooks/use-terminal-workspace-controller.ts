import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellSessionList, ShellSessionMetadata, WorkspaceSessionState } from '@/bridge'
import { dispatchApplicationMenuCommand } from '@/lib/app-menu-command'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { terminalBridge } from '../api/terminal.bridge'
import { terminalSessionUiStatus, type TerminalSessionUiStatus } from '../model/terminal-session'
import type { TerminalWorkspaceActionRequest } from '../model/terminal-workspace'

const MAX_TERMINAL_SESSIONS = 8

type TerminalWorkspaceControllerOptions = {
  workspace: string
  focusRequest: number
  actionRequest?: TerminalWorkspaceActionRequest
  initialState?: WorkspaceSessionState['terminal']
  onSessionChange?: (state: Pick<WorkspaceSessionState['terminal'], 'tab' | 'openSessionCount' | 'activeSessionOrdinal'>) => void
}

type LocalFeedback = {
  kind: 'status'
  message: string
} | {
  kind: 'error'
  error: UserError
  recovery?:
    | { kind: 'bootstrap'; label: string }
    | { kind: 'focus'; label: string; sessionId: string }
    | { kind: 'create'; label: string }
    | { kind: 'close'; label: string; sessionId: string }
}

function terminalWorkspaceError(error: unknown, operation: string, title: string, description: string) {
  return reportUserError(normalizeUserError(error, {
    category: 'process',
    component: 'terminal-workspace',
    operation,
    title,
    fallbackDescription: description,
  }))
}

export function useTerminalWorkspaceController({
  actionRequest,
  focusRequest,
  initialState,
  onSessionChange,
  workspace,
}: TerminalWorkspaceControllerOptions) {
  const restoredOpenSessionCount = initialState?.openSessionCount ?? 0
  const restoredActiveSessionOrdinal = initialState?.activeSessionOrdinal ?? null
  const [tab, setTab] = useState<'shell' | 'remote'>(() => initialState?.tab ?? 'shell')
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [profileComposerRequests, setProfileComposerRequests] = useState<Record<string, number>>({})
  const [sessions, setSessions] = useState<ShellSessionMetadata[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, TerminalSessionUiStatus>>({})
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [closingSessionIds, setClosingSessionIds] = useState<Set<string>>(() => new Set())
  const [feedback, setFeedback] = useState<LocalFeedback | null>(null)
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const sessionsRef = useRef<ShellSessionMetadata[]>([])
  const activeSessionRef = useRef<string | null>(null)
  const mruSessionIds = useRef<string[]>([])
  const creatingRef = useRef(false)
  const bootstrapGeneration = useRef(0)
  const handledActionRequest = useRef<number | null>(null)
  const actionRequestRef = useRef(actionRequest)

  useEffect(() => {
    actionRequestRef.current = actionRequest
  }, [actionRequest])

  const replaceSessions = useCallback((nextSessions: ShellSessionMetadata[]) => {
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
  }, [])

  const touchMru = useCallback((sessionId: string) => {
    mruSessionIds.current = [sessionId, ...mruSessionIds.current.filter((candidate) => candidate !== sessionId)]
  }, [])

  const commitActiveSession = useCallback((sessionId: string | null) => {
    activeSessionRef.current = sessionId
    setActiveSessionId(sessionId)
    setSessions((current) => {
      const next = current.map((session) => ({ ...session, active: session.sessionId === sessionId }))
      sessionsRef.current = next
      return next
    })
    if (sessionId) touchMru(sessionId)
  }, [touchMru])

  const installSnapshot = useCallback((snapshot: ShellSessionList) => {
    const nextSessions = [...snapshot.sessions]
    const availableIds = new Set(nextSessions.map((session) => session.sessionId))
    const nextActiveSessionId = snapshot.activeSessionId && availableIds.has(snapshot.activeSessionId)
      ? snapshot.activeSessionId
      : nextSessions[0]?.sessionId ?? null
    replaceSessions(nextSessions.map((session) => ({ ...session, active: session.sessionId === nextActiveSessionId })))
    activeSessionRef.current = nextActiveSessionId
    setActiveSessionId(nextActiveSessionId)
    mruSessionIds.current = [
      ...(nextActiveSessionId ? [nextActiveSessionId] : []),
      ...nextSessions
        .filter((session) => session.sessionId !== nextActiveSessionId)
        .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)
        .map((session) => session.sessionId),
    ]
    setSessionStatuses(Object.fromEntries(nextSessions.map((session) => [session.sessionId, terminalSessionUiStatus(session.status)])))
    if (nextActiveSessionId) setTerminalFocusRequest((current) => current + 1)
  }, [replaceSessions])

  useEffect(() => {
    let cancelled = false
    const generation = ++bootstrapGeneration.current
    const isCurrent = () => !cancelled && bootstrapGeneration.current === generation

    void (async () => {
      // Un confine asincrono evita render a cascata e fa sì che il primo effect di StrictMode
      // venga annullato prima di poter creare una sessione duplicata.
      await Promise.resolve()
      if (!isCurrent()) return
      setLoading(true)
      setFeedback(null)
      replaceSessions([])
      activeSessionRef.current = null
      setActiveSessionId(null)
      setSessionStatuses({})
      mruSessionIds.current = []

      try {
        let snapshot = await terminalBridge.shellSessions.list()
        if (!isCurrent()) return
        if (snapshot.sessions.length === 0) {
          const pendingAction = actionRequestRef.current
          const requestedNewSession = pendingAction?.action === 'new'
          if (requestedNewSession) {
            handledActionRequest.current = pendingAction.id
            setTab('shell')
          }
          creatingRef.current = true
          setCreating(true)
          const targetCount = Math.min(
            MAX_TERMINAL_SESSIONS,
            Math.max(1, restoredOpenSessionCount + (requestedNewSession ? 1 : 0)),
          )
          setFeedback({
            kind: 'status',
            message: targetCount === 1 ? 'Avvio del primo terminale…' : `Ripristino di ${targetCount} terminali…`,
          })
          const restoredSessions: ShellSessionMetadata[] = []
          for (let index = 0; index < targetCount; index += 1) {
            restoredSessions.push(await terminalBridge.shellSessions.create())
            if (!isCurrent()) return
          }
          const activeOrdinal = restoredActiveSessionOrdinal === null
            ? restoredSessions.length - 1
            : Math.min(restoredActiveSessionOrdinal, restoredSessions.length - 1)
          const restoredActiveSession = restoredSessions[activeOrdinal]
          if (restoredActiveSession && activeOrdinal !== restoredSessions.length - 1) {
            const focused = await terminalBridge.shellSessions.focus(restoredActiveSession.sessionId)
            if (!isCurrent()) return
            restoredSessions[activeOrdinal] = focused
          }
          snapshot = {
            activeSessionId: restoredActiveSession?.sessionId ?? null,
            sessions: restoredSessions,
          }
        }
        installSnapshot(snapshot)
        setFeedback(null)
      } catch (error) {
        if (!isCurrent()) return
        setFeedback({
          kind: 'error',
          error: terminalWorkspaceError(error, 'initialize-sessions', 'Terminali non inizializzati', 'Il workspace è rimasto aperto. Riprova senza perdere le altre viste.'),
          recovery: { kind: 'bootstrap', label: 'Riprova' },
        })
      } finally {
        if (isCurrent()) {
          creatingRef.current = false
          setCreating(false)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [bootstrapAttempt, installSnapshot, replaceSessions, restoredActiveSessionOrdinal, restoredOpenSessionCount, workspace])

  const focusSession = useCallback(async (sessionId: string) => {
    if (!sessionsRef.current.some((session) => session.sessionId === sessionId)) return false
    setTab('shell')
    commitActiveSession(sessionId)
    setTerminalFocusRequest((current) => current + 1)
    try {
      const focused = await terminalBridge.shellSessions.focus(sessionId)
      setSessions((current) => {
        const next = current.map((session) => session.sessionId === sessionId ? { ...session, ...focused, active: true } : { ...session, active: false })
        sessionsRef.current = next
        return next
      })
      setFeedback((current) => current?.kind === 'error' ? null : current)
      return true
    } catch (error) {
      setFeedback({
        kind: 'error',
        error: terminalWorkspaceError(error, 'focus-session', 'Terminale non attivato', 'La sessione è rimasta aperta. Riprova ad attivarla.'),
        recovery: { kind: 'focus', label: 'Riprova', sessionId },
      })
      return false
    }
  }, [commitActiveSession])

  const createSession = useCallback(async () => {
    setTab('shell')
    if (sessionsRef.current.length >= MAX_TERMINAL_SESSIONS) {
      setFeedback({ kind: 'status', message: `Limite di ${MAX_TERMINAL_SESSIONS} terminali raggiunto.` })
      return null
    }
    if (creatingRef.current) return null

    creatingRef.current = true
    setCreating(true)
    setFeedback({ kind: 'status', message: 'Avvio di un nuovo terminale…' })
    try {
      const created = await terminalBridge.shellSessions.create()
      const nextSessions = sessionsRef.current.some((session) => session.sessionId === created.sessionId)
        ? sessionsRef.current
        : [...sessionsRef.current, created]
      replaceSessions(nextSessions.map((session) => ({ ...session, active: session.sessionId === created.sessionId })))
      setSessionStatuses((current) => ({ ...current, [created.sessionId]: terminalSessionUiStatus(created.status) }))
      commitActiveSession(created.sessionId)
      setTerminalFocusRequest((current) => current + 1)
      setFeedback(null)
      return created
    } catch (error) {
      setFeedback({
        kind: 'error',
        error: terminalWorkspaceError(error, 'create-session', 'Nuovo terminale non avviato', 'Le sessioni già aperte non sono state modificate. Riprova.'),
        recovery: { kind: 'create', label: 'Riprova' },
      })
      return null
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [commitActiveSession, replaceSessions])

  const cycleSession = useCallback((direction: -1 | 1) => {
    const currentSessions = sessionsRef.current
    if (currentSessions.length === 0) return
    const currentIndex = currentSessions.findIndex((session) => session.sessionId === activeSessionRef.current)
    const baseIndex = currentIndex < 0 ? 0 : currentIndex
    const nextIndex = (baseIndex + direction + currentSessions.length) % currentSessions.length
    void focusSession(currentSessions[nextIndex].sessionId)
  }, [focusSession])

  const closeSession = useCallback(async (sessionId: string) => {
    if (!sessionsRef.current.some((session) => session.sessionId === sessionId)) return
    setTab('shell')
    setClosingSessionIds((current) => new Set(current).add(sessionId))
    try {
      const result = await terminalBridge.shellSessions.close(sessionId)
      const remainingSessions = sessionsRef.current.filter((session) => session.sessionId !== sessionId)
      replaceSessions(remainingSessions)
      setSessionStatuses((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      setProfileComposerRequests((current) => {
        const next = { ...current }
        delete next[sessionId]
        return next
      })
      mruSessionIds.current = mruSessionIds.current.filter((candidate) => candidate !== sessionId)

      if (activeSessionRef.current === sessionId) {
        const availableIds = new Set(remainingSessions.map((session) => session.sessionId))
        const fallbackSessionId = result.activeSessionId && availableIds.has(result.activeSessionId)
          ? result.activeSessionId
          : mruSessionIds.current.find((candidate) => availableIds.has(candidate)) ?? remainingSessions.at(-1)?.sessionId ?? null
        commitActiveSession(fallbackSessionId)
        if (fallbackSessionId) void focusSession(fallbackSessionId)
        else setFeedback({ kind: 'status', message: 'Nessun terminale aperto.' })
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        error: terminalWorkspaceError(error, 'close-session', 'Terminale non chiuso', 'La sessione è rimasta aperta. Riprova la chiusura.'),
        recovery: { kind: 'close', label: 'Riprova', sessionId },
      })
    } finally {
      setClosingSessionIds((current) => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }
  }, [commitActiveSession, focusSession, replaceSessions])

  const reportSessionStatus = useCallback((sessionId: string, status: TerminalSessionUiStatus) => {
    setSessionStatuses((current) => current[sessionId] === status ? current : { ...current, [sessionId]: status })
  }, [])

  useEffect(() => {
    if (focusRequest <= 0) return
    if (activeSessionRef.current) void focusSession(activeSessionRef.current)
    else queueMicrotask(() => {
      setTab('shell')
      setTerminalFocusRequest((current) => current + 1)
    })
  }, [focusRequest, focusSession])

  useEffect(() => {
    if (loading || !actionRequest || handledActionRequest.current === actionRequest.id) return
    handledActionRequest.current = actionRequest.id
    if (actionRequest.action === 'focus') {
      if (activeSessionRef.current) void focusSession(activeSessionRef.current)
      else queueMicrotask(() => setTab('shell'))
      return
    }
    if (actionRequest.action === 'next') {
      cycleSession(1)
      return
    }
    if (actionRequest.action === 'previous') {
      cycleSession(-1)
      return
    }
    if (actionRequest.action === 'new') {
      queueMicrotask(() => { void createSession() })
      return
    }
    if (activeSessionRef.current) void closeSession(activeSessionRef.current)
  }, [actionRequest, closeSession, createSession, cycleSession, focusSession, loading])

  useEffect(() => terminalBridge.contextMenu?.onAction?.((action) => {
    if (action.contextKind !== 'terminal-tab' || !action.contextId) return
    if (action.command === 'terminalTab.new') { void createSession(); return }
    if (!sessionsRef.current.some((session) => session.sessionId === action.contextId)) return
    if (action.command === 'terminalTab.activate') { void focusSession(action.contextId); return }
    if (action.command === 'terminalTab.close') { void closeSession(action.contextId); return }
    if (action.command === 'terminalTab.restart') {
      void focusSession(action.contextId).then((focused) => {
        if (focused) dispatchApplicationMenuCommand('terminal.restart')
      })
    }
  }) ?? (() => undefined), [closeSession, createSession, focusSession])

  useEffect(() => {
    if (!initialState || focusRequest > 0) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setTab(initialState.tab) })
    return () => { cancelled = true }
  }, [focusRequest, initialState])

  useEffect(() => {
    if (loading) return
    const activeSessionOrdinal = activeSessionId === null
      ? null
      : sessions.findIndex((session) => session.sessionId === activeSessionId)
    onSessionChange?.({
      tab,
      openSessionCount: sessions.length,
      activeSessionOrdinal: activeSessionOrdinal === -1 ? null : activeSessionOrdinal,
    })
  }, [activeSessionId, loading, onSessionChange, sessions, tab])

  const connectProfile = async (commandId: string) => {
    // L'autenticazione resta nel PTY: mostrare e focalizzare la sessione evita un prompt nascosto.
    setTab('shell')
    let targetSessionId = activeSessionRef.current
    if (!targetSessionId) targetSessionId = (await createSession())?.sessionId ?? null
    if (!targetSessionId || !await focusSession(targetSessionId)) throw new Error('Nessun terminale disponibile per la connessione SSH.')
    const result = await terminalBridge.workspaceCommands.run(commandId)
    if (result.managedConnectionId) setConnectionId(result.managedConnectionId)
    return result.managedConnectionId ?? null
  }

  const openProfileComposer = async () => {
    setTab('shell')
    let targetSessionId = activeSessionRef.current
    if (!targetSessionId) targetSessionId = (await createSession())?.sessionId ?? null
    if (!targetSessionId) return
    await focusSession(targetSessionId)
    setProfileComposerRequests((current) => ({
      ...current,
      [targetSessionId]: (current[targetSessionId] ?? 0) + 1,
    }))
  }

  const recoverFromFeedback = async () => {
    const recovery = feedback?.kind === 'error' ? feedback.recovery : undefined
    if (!recovery) return
    if (recovery.kind === 'bootstrap') {
      setBootstrapAttempt((current) => current + 1)
      return
    }
    if (recovery.kind === 'focus') {
      await focusSession(recovery.sessionId)
      return
    }
    if (recovery.kind === 'create') {
      await createSession()
      return
    }
    await closeSession(recovery.sessionId)
  }

  const closeActiveSession = () => {
    if (activeSessionRef.current) void closeSession(activeSessionRef.current)
  }

  return {
    activeSessionId,
    atSessionLimit: sessions.length >= MAX_TERMINAL_SESSIONS,
    closeActiveSession,
    closeSession,
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
    sessionLimit: MAX_TERMINAL_SESSIONS,
    sessions,
    sessionStatuses,
    setConnectionId,
    setTab,
    tab,
    terminalFocusRequest,
  }
}
