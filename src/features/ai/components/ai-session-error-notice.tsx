import { ErrorNotice } from '@/components/ui'
import type { AiFailureAction, AiFailureRecovery, AiSessionFailure } from '../model/ai-runtime.types'

export function AiSessionErrorNotice({ failure, onOpenSettings, onReload, onRestart, onResumeOutput, onRetryTerminal, onStartPiDirect }: {
  failure: AiSessionFailure
  onOpenSettings: () => void
  onReload: () => Promise<void>
  onRestart: () => Promise<void>
  onResumeOutput: () => Promise<void>
  onRetryTerminal: () => void
  onStartPiDirect: () => Promise<void>
}) {
  const actionFor = (recovery: AiFailureRecovery): AiFailureAction => {
    if (recovery === 'settings') return { label: 'Apri impostazioni', onClick: onOpenSettings }
    if (recovery === 'reload') return { label: 'Riprova', pendingLabel: 'Ricaricamento…', onClick: onReload }
    if (recovery === 'resume-output') return { label: 'Riprova', pendingLabel: 'Collegamento output…', onClick: onResumeOutput }
    if (recovery === 'retry-terminal') return { label: 'Riprova', pendingLabel: 'Preparazione terminale…', onClick: onRetryTerminal }
    if (recovery === 'start-pi-direct') return { label: 'Avvia Pi diretto', pendingLabel: 'Avvio Pi…', onClick: onStartPiDirect }
    return {
      label: failure.error.title.includes('Herdr') ? 'Ricollega Herdr' : failure.error.operation === 'start-ai-session' ? 'Riprova avvio' : 'Riavvia',
      pendingLabel: 'Riavvio sessione…',
      onClick: onRestart,
    }
  }
  return <ErrorNotice
    action={actionFor(failure.primaryRecovery)}
    error={failure.error}
    secondaryAction={failure.secondaryRecovery ? actionFor(failure.secondaryRecovery) : undefined}
  />
}
