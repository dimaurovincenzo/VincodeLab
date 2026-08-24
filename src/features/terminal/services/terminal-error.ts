import type { ShellSessionErrorEvent, ShellSessionOneWayOperation } from '@/bridge'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import type {
  TerminalClipboardFailure,
  TerminalFailure,
  TerminalPreferenceFailure,
} from '../model/terminal-session'

type TerminalFailureCategory = 'process' | 'persistence' | 'remote'

const shellSessionErrorCopy: Readonly<Record<ShellSessionOneWayOperation, { title: string; fallbackDescription: string }>> = Object.freeze({
  ready: { title: 'Output del terminale non collegato', fallbackDescription: 'Recupera lo storico per riallineare la sessione.' },
  ack: { title: 'Output del terminale non confermato', fallbackDescription: 'Recupera lo storico per continuare a ricevere l’output.' },
  disconnect: { title: 'Output del terminale non scollegato', fallbackDescription: 'Riapri la sessione per riallineare il collegamento.' },
  write: { title: 'Testo non inviato', fallbackDescription: 'La sessione e lo storico sono rimasti disponibili. Riavvia la shell se non risponde.' },
  resize: { title: 'Terminale non ridimensionato', fallbackDescription: 'La sessione è rimasta attiva. Adatta nuovamente il terminale.' },
})

export function reportTerminalFailure(
  error: unknown,
  operation: string,
  title: string,
  description: string,
  category: TerminalFailureCategory = 'process',
) {
  return reportUserError(normalizeUserError(error, {
    category,
    component: 'terminal',
    operation,
    title,
    fallbackDescription: description,
  }))
}

export function reportTerminalPreferenceFailure(
  error: unknown,
  recovery: TerminalPreferenceFailure['recovery'],
) {
  return reportTerminalFailure(
    error,
    recovery === 'load' ? 'load-terminal-preferences' : 'save-terminal-preferences',
    recovery === 'load' ? 'Preferenze del terminale non caricate' : 'Preferenze del terminale non salvate',
    recovery === 'load'
      ? 'È stata applicata la dimensione predefinita. La sessione e l’output sono rimasti disponibili.'
      : 'La nuova dimensione resta attiva in questa sessione, ma potrebbe non essere ripristinata alla prossima apertura.',
    'persistence',
  )
}

export function terminalFailureFromEvent(event: ShellSessionErrorEvent): TerminalFailure {
  const copy = shellSessionErrorCopy[event.operation]
  return {
    error: normalizeUserError(event.error, {
      category: event.error.category,
      code: event.error.code,
      component: 'terminal',
      correlationId: event.error.correlationId,
      fallbackDescription: copy.fallbackDescription,
      operation: event.operation,
      recoverable: event.error.recoverable,
      severity: event.error.severity,
      title: copy.title,
    }),
    recovery: event.recovery,
  }
}

export function reportTerminalClipboardFailure(
  cause: unknown,
  action: TerminalClipboardFailure['action'],
): TerminalClipboardFailure {
  const copy = action === 'copy'
    ? {
        operation: 'copy-selection',
        title: 'Selezione non copiata',
        description: 'Gli appunti non sono accessibili. La selezione resta disponibile nel terminale.',
      }
    : {
        operation: 'paste',
        title: 'Testo non incollato',
        description: 'Gli appunti non sono accessibili. La sessione del terminale è rimasta attiva.',
      }

  return {
    action,
    error: reportUserError(normalizeUserError(cause, {
      category: 'permission',
      component: 'terminal',
      ...copy,
    })),
  }
}
