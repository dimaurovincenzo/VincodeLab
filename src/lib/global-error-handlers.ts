import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

type GlobalErrorHandlerOptions = {
  reload?: () => void
}

function presentUnhandledError(error: UserError, reload: () => void) {
  if (error.category === 'cancelled') return
  toast.error(error.title, {
    dedupeKey: `${error.category}:${error.code ?? 'runtime'}:${error.operation ?? 'unknown'}`,
    description: `${error.description} Riferimento ${error.correlationId}.`,
    recoveryAction: { label: 'Ricarica interfaccia', onClick: reload },
  })
}

export function installGlobalErrorHandlers({ reload = () => window.location.reload() }: GlobalErrorHandlerOptions = {}) {
  const handleError = (event: ErrorEvent) => {
    event.preventDefault()
    const error = reportUserError(normalizeUserError(event.error ?? event.message, {
      component: 'renderer-global',
      operation: 'uncaught-error',
      title: 'Azione interrotta da un problema imprevisto',
      description: 'La shell dell’app resta operativa. Riprova l’ultima azione nella sezione interessata.',
    }))
    presentUnhandledError(error, reload)
  }

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    event.preventDefault()
    const error = reportUserError(normalizeUserError(event.reason, {
      component: 'renderer-global',
      operation: 'unhandled-rejection',
      title: 'Operazione asincrona non completata',
      description: 'L’interfaccia resta disponibile. Riprova l’operazione nella sezione in cui stavi lavorando.',
    }))
    presentUnhandledError(error, reload)
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
}
