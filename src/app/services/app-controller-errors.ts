import { toast } from '@/components/ui'
import type { TerminalPasteProgress } from '@/lib/terminal-paste-controller.js'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import type { AiFailureContext, AiSessionFailure, TerminalPasteFailure, TerminalPasteFailureRecovery } from '../model/app-controller.types'

export function reportRendererFailure(error: unknown, options: Parameters<typeof normalizeUserError>[1]) {
  return reportUserError(normalizeUserError(error, options))
}

export function showUserErrorToast(error: UserError, recoveryAction?: { label: string; onClick: () => void }) {
  const description = `${error.description} Riferimento ${error.correlationId}.`
  const dedupeKey = `${error.component ?? 'renderer'}:${error.operation ?? error.category}:${error.code ?? ''}`
  if (error.severity === 'info') {
    toast.info(error.title, { dedupeKey, description, recoveryAction })
    return
  }
  if (error.severity === 'warning') {
    toast.warning(error.title, { dedupeKey, description, recoveryAction })
    return
  }
  toast.error(error.title, { dedupeKey, description, recoveryAction })
}

export function reportTransientFailure(
  error: unknown,
  options: Parameters<typeof normalizeUserError>[1],
  recoveryAction?: { label: string; onClick: () => void },
) {
  const incident = reportRendererFailure(error, options)
  showUserErrorToast(incident, recoveryAction)
  return incident
}

export function reportTerminalPasteFailure(progress: TerminalPasteProgress): TerminalPasteFailure {
  const reason = progress.reason ?? 'incomplete'
  const context = reason === 'too-large'
    ? {
        category: 'validation' as const,
        code: 'AI_PASTE_TOO_LARGE',
        description: 'Il contenuto supera il limite di sicurezza e non è stato inviato. Riducilo negli appunti e riprova.',
        recovery: 'none' as const,
        title: 'Contenuto troppo grande',
      }
    : reason === 'not-running'
      ? {
          category: 'process' as const,
          code: 'AI_SESSION_NOT_RUNNING',
          description: 'La sessione AI non è disponibile. Il contenuto è rimasto negli appunti e puoi riavviare la sessione.',
          recovery: 'restart-ai' as const,
          title: 'Sessione AI non disponibile',
        }
      : reason === 'busy'
        ? {
            category: 'conflict' as const,
            code: 'AI_PASTE_ALREADY_RUNNING',
            description: 'È già in corso un altro incolla. Il nuovo contenuto non è stato inviato e puoi riprovare quando termina.',
            recovery: 'retry-paste' as const,
            title: 'Incolla già in corso',
          }
        : reason === 'cancel-unavailable'
          ? {
              category: 'process' as const,
              code: 'AI_PASTE_CANCEL_UNCONFIRMED',
              description: 'L’invio locale è stato fermato, ma la sessione AI non ha confermato l’annullamento. I blocchi già trasferiti potrebbero essere presenti nel prompt.',
              recovery: 'retry-cancel' as const,
              title: 'Annullamento non confermato',
            }
          : {
              category: 'process' as const,
              code: 'AI_PASTE_INCOMPLETE',
              description: 'Il trasferimento non è stato completato. Il contenuto non inviato è rimasto negli appunti e puoi riprovare.',
              recovery: 'retry-paste' as const,
              title: 'Contenuto non incollato',
            }
  const cause = progress.error ?? new Error(`Terminal paste ${reason} [${context.code}]`)
  return {
    error: reportRendererFailure(cause, {
      category: context.category,
      code: context.code,
      component: 'ai-terminal',
      description: context.description,
      operation: reason === 'cancel-unavailable' ? 'cancel-terminal-paste' : 'paste-terminal-content',
      recoverable: context.recovery !== 'none',
      title: context.title,
    }),
    recovery: context.recovery,
  }
}

export function terminalPasteRecoveryLabel(recovery: TerminalPasteFailureRecovery) {
  if (recovery === 'retry-cancel') return 'Riprova annullamento'
  if (recovery === 'restart-ai') return 'Riavvia sessione'
  return 'Riprova incolla'
}

export function normalizeAiSessionFailure(cause: unknown, context: AiFailureContext): AiSessionFailure {
  const classified = normalizeUserError(cause, {
    category: context.category,
    code: context.code,
    component: 'ai-terminal',
    correlationId: context.correlationId,
    operation: context.operation,
    severity: context.severity,
  })
  const signature = `${classified.code ?? ''} ${classified.technicalMessage}`
  const piMissing = classified.code === 'PI_NOT_INSTALLED'
  const rateLimited = /RATE.?LIMIT|TOO_MANY_REQUESTS|\b429\b/iu.test(signature)
  const configurationRequired = classified.category === 'authentication'
    || classified.category === 'configuration'
    || classified.category === 'permission'
    || piMissing
    || /CONFIG|CREDENTIAL|API.?KEY|TOKEN_(?:EXPIRED|INVALID|MISSING)|NOT_CONFIGURED/iu.test(signature)
  const providerFailure = /PROVIDER|MODEL|UPSTREAM|AI_API|API_(?:FAILURE|UNAVAILABLE)/iu.test(signature)
  const category = configurationRequired
    ? 'configuration' as const
    : providerFailure && (classified.category === 'internal' || classified.category === 'persistence')
      ? 'network' as const
      : classified.category === 'internal' || classified.category === 'persistence'
        ? 'process' as const
        : classified.category
  const copy = classified.category === 'cancelled'
    ? { description: `L’operazione AI è stata annullata. ${context.preserved}`, title: 'Operazione AI annullata' }
    : piMissing
      ? {
          description: `Pi Coding Agent non è installato o non è rilevabile. ${context.preserved} Editor, Terminale locale, GitHub, Database e Redis restano disponibili. Installa Pi, quindi aggiorna la verifica nelle Impostazioni.`,
          title: 'Pi Coding Agent non installato',
        }
      : rateLimited
        ? { description: `Il provider sta limitando temporaneamente le richieste. ${context.preserved} Attendi qualche minuto prima di riprovare.`, title: 'Limite del provider AI raggiunto' }
        : configurationRequired
          ? { description: `La configurazione del runtime o del provider AI non consente di continuare. ${context.preserved} Apri le Impostazioni per verificarla.`, title: 'Configurazione AI da completare' }
          : classified.category === 'timeout'
            ? { description: `La sessione AI non ha risposto entro il tempo disponibile. ${context.preserved}`, title: 'Sessione AI senza risposta' }
            : providerFailure
              ? { description: `Il provider AI non ha completato la richiesta. ${context.preserved} Controlla lo stato del provider e riprova.`, title: 'Provider AI non disponibile' }
              : { description: `${context.fallbackDescription} ${context.preserved}`, title: context.title }
  const error = normalizeUserError(cause, {
    category,
    code: classified.code,
    component: 'ai-terminal',
    correlationId: classified.correlationId,
    description: copy.description,
    operation: context.operation,
    severity: context.severity ?? (classified.category === 'cancelled' ? 'info' : classified.severity),
    title: copy.title,
  })
  return {
    error,
    primaryRecovery: configurationRequired ? 'settings' : context.recovery,
    secondaryRecovery: configurationRequired && context.recovery !== 'settings' ? context.recovery : undefined,
  }
}

export function sameAiSessionFailure(left: AiSessionFailure | null, right: AiSessionFailure) {
  return Boolean(left
    && left.error.category === right.error.category
    && left.error.code === right.error.code
    && left.error.operation === right.error.operation
    && left.error.title === right.error.title)
}

export function reportWorkspaceResultError(result: WorkspaceOpenResult, fallback: string) {
  if (!result.error) return null
  return reportRendererFailure(result.errorIncident ?? new Error(result.error), {
    component: 'workspace-shell',
    operation: result.path ? 'start-ai-session' : 'open-workspace',
    title: result.path ? 'Sessione AI non disponibile' : 'Workspace non aperto',
    fallbackDescription: fallback,
  })
}
