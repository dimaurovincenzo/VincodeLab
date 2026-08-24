import { useCallback, useEffect, useState } from 'react'
import type { PiSession, PiSessionsState } from '@/bridge'
import { toast } from '@/components/ui'
import { reportRendererFailure, showUserErrorToast } from '@/lib/renderer-error'
import { aiBridge } from '../api/ai.bridge'

const EMPTY_STATE: PiSessionsState = { workspacePath: '', activeSessionId: null, sessions: [] }

function reportSessionFailure(error: unknown, operation: string, title: string, description: string) {
  const incident = reportRendererFailure(error, {
    category: 'process',
    component: 'ai-sessions',
    operation,
    title,
    fallbackDescription: description,
  })
  showUserErrorToast(incident)
}

export function useAiSessions(workspace: string | null) {
  const [state, setState] = useState<PiSessionsState>(EMPTY_STATE)
  const [pending, setPending] = useState(false)

  const install = useCallback((nextState: PiSessionsState) => {
    setState(nextState)
  }, [])

  useEffect(() => {
    if (!workspace) return
    let cancelled = false
    const unsubscribe = aiBridge.pi.onSessionsChanged((nextState) => {
      if (!cancelled && nextState.workspacePath === workspace) install(nextState)
    })
    void aiBridge.pi.listSessions().then((nextState) => {
      if (!cancelled) install(nextState)
    }).catch((error) => {
      if (!cancelled) reportSessionFailure(error, 'list-ai-sessions', 'Sessioni AI non disponibili', 'Il workspace resta aperto. Riprova entrando nuovamente nel Terminale AI.')
    })
    return () => { cancelled = true; unsubscribe() }
  }, [install, workspace])

  const run = useCallback(async <T,>(operation: () => Promise<T>, failure: [string, string, string]) => {
    if (pending) return null
    setPending(true)
    try { return await operation() }
    catch (error) { reportSessionFailure(error, ...failure); return null }
    finally { setPending(false) }
  }, [pending])

  const createSession = useCallback(async () => {
    const created = await run(
      () => aiBridge.pi.createSession(),
      ['create-ai-session', 'Nuovo agente non avviato', 'Gli agenti già aperti sono rimasti attivi. Riprova.'],
    )
    if (created) toast.success(`${created.title} avviato.`)
    return created
  }, [run])

  const focusSession = useCallback((sessionId: string) => run(
    () => aiBridge.pi.focusSession(sessionId),
    ['focus-ai-session', 'Agente non attivato', 'La sessione è rimasta aperta. Riprova a selezionarla.'],
  ), [run])

  const renameSession = useCallback((sessionId: string, title: string) => run(
    () => aiBridge.pi.renameSession(sessionId, title),
    ['rename-ai-session', 'Agente non rinominato', 'La sessione è rimasta aperta con il nome precedente.'],
  ), [run])

  const restartSession = useCallback(async (sessionId: string) => {
    const result = await run(
      () => aiBridge.pi.restart(sessionId),
      ['restart-ai-session', 'Agente non riavviato', 'La sessione è rimasta disponibile. Riprova.'],
    )
    if (result) toast.success('Sessione Pi riavviata.')
    return result
  }, [run])

  const closeSession = useCallback(async (sessionId: string) => {
    const result = await run(
      () => aiBridge.pi.closeSession(sessionId),
      ['close-ai-session', 'Agente non chiuso', 'La sessione è rimasta attiva. Riprova.'],
    )
    if (result) toast.success('Sessione Pi chiusa.')
    return result
  }, [run])

  const currentState = workspace && state.workspacePath === workspace ? state : EMPTY_STATE
  const activeSession = currentState.sessions.find((session) => session.sessionId === currentState.activeSessionId) ?? null
  const workingCount = currentState.sessions.filter((session) => session.status === 'running' && session.activity === 'working').length

  return {
    activeSession,
    activeSessionId: currentState.activeSessionId,
    closeSession,
    createSession,
    focusSession,
    pending,
    renameSession,
    restartSession,
    sessions: currentState.sessions as PiSession[],
    workingCount,
  }
}

export type AiSessionsController = ReturnType<typeof useAiSessions>
