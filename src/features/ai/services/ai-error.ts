import type { TerminalPasteProgress } from './terminal-paste-controller.js'
import { normalizeUserError } from '@/lib/user-error'
import { reportRendererFailure } from '@/lib/renderer-error'
import type {
  AiFailureContext,
  AiSessionFailure,
  TerminalPasteFailure,
  TerminalPasteFailureRecovery,
} from '../model/ai-runtime.types'

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
  const terminalRuntimeUnavailable = classified.code === 'AI_TERMINAL_RUNTIME_UNAVAILABLE'
  const herdrNotRunnable = classified.code === 'HERDR_NOT_RUNNABLE'
  const herdrEndedDuringStartup = classified.code === 'HERDR_SESSION_ENDED_DURING_STARTUP'
  const herdrEndedWithoutFallback = classified.code === 'HERDR_SESSION_ENDED_WITHOUT_FALLBACK'
  const rateLimited = /RATE.?LIMIT|TOO_MANY_REQUESTS|\b429\b/iu.test(signature)
  const configurationRequired = classified.category === 'authentication'
    || classified.category === 'configuration'
    || classified.category === 'permission'
    || piMissing
    || terminalRuntimeUnavailable
    || herdrNotRunnable
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
    : terminalRuntimeUnavailable
      ? {
          description: `Herdr non è disponibile e Pi Coding Agent non è installato o utilizzabile. ${context.preserved} Installa almeno uno dei due runtime e aggiorna la verifica nelle Impostazioni.`,
          title: 'Runtime del Terminale AI non disponibile',
        }
      : herdrNotRunnable
        ? {
            description: `Herdr è stato rilevato ma non è riuscito ad avviarsi, e Pi diretto non è disponibile come recovery. ${context.preserved} Verifica Herdr oppure installa Pi Coding Agent.`,
            title: 'Herdr non avviabile',
          }
        : herdrEndedDuringStartup
          ? {
              description: `Il client Herdr si è chiuso dopo aver mostrato la fleet. ${context.preserved} La sessione condivisa non è stata arrestata: ricollega Herdr oppure avvia Pi diretto.`,
              title: 'Client Herdr chiuso durante l’avvio',
            }
          : herdrEndedWithoutFallback
            ? {
                description: `Il client Herdr si è chiuso dopo aver mostrato la fleet. ${context.preserved} La sessione condivisa non è stata arrestata; ricollega Herdr per continuare. Pi diretto non è disponibile su questo Mac.`,
                title: 'Client Herdr chiuso durante l’avvio',
              }
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
    primaryRecovery: herdrEndedDuringStartup || herdrEndedWithoutFallback
      ? 'restart'
      : configurationRequired
        ? 'settings'
        : context.recovery,
    secondaryRecovery: herdrEndedDuringStartup
      ? 'start-pi-direct'
      : herdrEndedWithoutFallback
        ? undefined
        : configurationRequired && context.recovery !== 'settings'
          ? context.recovery
          : context.secondaryRecovery,
  }
}

export function sameAiSessionFailure(left: AiSessionFailure | null, right: AiSessionFailure) {
  return Boolean(left
    && left.error.category === right.error.category
    && left.error.code === right.error.code
    && left.error.operation === right.error.operation
    && left.error.title === right.error.title)
}
