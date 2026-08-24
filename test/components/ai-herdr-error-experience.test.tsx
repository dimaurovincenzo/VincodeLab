import { describe, expect, it } from 'vitest'
import { normalizeAiSessionFailure } from '@/features/ai/services/ai-error'
import { aiTerminalRuntimeDescription, aiTerminalRuntimeLabel } from '@/features/ai/services/ai-terminal-runtime-label'

const failureContext = {
  fallbackDescription: 'Il Terminale AI non è stato avviato.',
  operation: 'start-ai-session',
  preserved: 'Il workspace e gli strumenti locali sono rimasti disponibili.',
  recovery: 'restart' as const,
  title: 'Terminale AI non disponibile',
}

describe('Error Experience Herdr', () => {
  it('offre il fallback Pi esplicito quando il client termina dopo il primo output e Pi è disponibile', () => {
    const failure = normalizeAiSessionFailure(new Error('Herdr closed after output'), {
      ...failureContext,
      code: 'HERDR_SESSION_ENDED_DURING_STARTUP',
    })

    expect(failure.error.title).toBe('Client Herdr chiuso durante l’avvio')
    expect(failure.error.description).toContain('La sessione condivisa non è stata arrestata')
    expect(failure.primaryRecovery).toBe('restart')
    expect(failure.secondaryRecovery).toBe('start-pi-direct')
  })

  it('non propone un fallback Pi impossibile quando Herdr è l’unico runtime', () => {
    const failure = normalizeAiSessionFailure(new Error('Herdr closed without local Pi'), {
      ...failureContext,
      code: 'HERDR_SESSION_ENDED_WITHOUT_FALLBACK',
      secondaryRecovery: 'start-pi-direct',
    })

    expect(failure.error.description).toContain('Pi diretto non è disponibile')
    expect(failure.primaryRecovery).toBe('restart')
    expect(failure.secondaryRecovery).toBeUndefined()
  })

  it('espone uno stato compatto e una motivazione sanitizzata per il fallback automatico', () => {
    const state = { runtime: 'pi' as const, fallbackReason: 'timeout' as const, piAvailable: true }

    expect(aiTerminalRuntimeLabel(state)).toBe('Pi diretto · Herdr non disponibile')
    expect(aiTerminalRuntimeDescription(state)).toBe('Herdr non ha completato la verifica iniziale in tempo.')
  })
})
