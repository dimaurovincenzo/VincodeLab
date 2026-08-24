import { useCallback, useRef, useState } from 'react'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import type { AiFailureContext, AiSessionFailure } from '../model/ai-runtime.types'
import { normalizeAiSessionFailure, sameAiSessionFailure } from '../services/ai-error'

export function useAiFailure() {
  const aiFailureRef = useRef<AiSessionFailure | null>(null)
  const [aiFailure, setAiFailure] = useState<AiSessionFailure | null>(null)

  const clearAiFailure = useCallback((operation?: string) => {
    const current = aiFailureRef.current
    if (!current || (operation && current.error.operation !== operation)) return
    aiFailureRef.current = null
    setAiFailure(null)
  }, [])

  const restoreAiFailure = useCallback((failure: AiSessionFailure | null) => {
    aiFailureRef.current = failure
    setAiFailure(failure)
  }, [])

  const publishAiFailure = useCallback((cause: unknown, context: AiFailureContext) => {
    const next = normalizeAiSessionFailure(cause, context)
    if (sameAiSessionFailure(aiFailureRef.current, next)) return aiFailureRef.current!
    const incident = { ...next, error: reportUserError(next.error) }
    aiFailureRef.current = incident
    setAiFailure(incident)
    return incident
  }, [])

  const showEndedAiSession = useCallback((runtime: 'herdr' | 'pi', piAvailable = true) => {
    const herdr = runtime === 'herdr'
    const notice: AiSessionFailure = {
      error: normalizeUserError(new Error(herdr ? 'Il client Herdr è stato chiuso.' : 'La sessione Pi è terminata normalmente.'), {
        category: 'process',
        code: 'AI_SESSION_ENDED',
        component: 'ai-terminal',
        description: herdr
          ? 'Il client Herdr è stato chiuso. La sessione condivisa e i suoi processi non sono stati arrestati.'
          : 'La sessione AI è terminata normalmente. L’output resta disponibile e puoi riavviarla quando vuoi.',
        operation: 'session-exit',
        severity: 'info',
        title: herdr ? 'Client Herdr chiuso' : 'Sessione AI terminata',
      }),
      primaryRecovery: 'restart',
      secondaryRecovery: herdr ? piAvailable ? 'start-pi-direct' : 'settings' : undefined,
    }
    aiFailureRef.current = notice
    setAiFailure(notice)
  }, [])

  return { aiFailure, aiFailureRef, clearAiFailure, publishAiFailure, restoreAiFailure, showEndedAiSession }
}

export type AiFailureController = ReturnType<typeof useAiFailure>
