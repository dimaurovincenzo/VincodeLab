import { useEffect, useRef, useState } from 'react'
import { ErrorNotice } from '@/components/ui'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import {
  retryVolatileDraftPersistence,
  subscribeVolatileDraftPersistence,
  type VolatileDraftPersistenceState,
} from '@/lib/volatile-draft-store'
import { errorNoticeStyles } from '@/theme/styles/error-notice'

function volatileDraftPersistenceError(state: VolatileDraftPersistenceState) {
  const cause = state.failures[0]?.error ?? new Error('Volatile draft persistence unavailable [DRAFT_PERSISTENCE_UNAVAILABLE]')
  const classified = normalizeUserError(cause, { category: 'persistence' })
  const code = classified.code ?? 'DRAFT_PERSISTENCE_UNAVAILABLE'
  const diagnosticCause = new Error(`Volatile draft persistence acknowledgement failed [${code}] [${classified.correlationId}]`)
  return reportUserError(normalizeUserError(diagnosticCause, {
    category: 'persistence',
    code,
    component: 'renderer-bootstrap',
    correlationId: classified.correlationId,
    operation: 'persist-volatile-drafts',
    severity: 'warning',
    title: 'Protezione delle bozze temporaneamente degradata',
    description: 'Le bozze restano disponibili in memoria, ma il recupero dopo un arresto imprevisto non è garantito finché la protezione non viene ripristinata.',
  }))
}

export function BootstrapHydrationNotice({ error, onRetry }: { error: UserError | null; onRetry?: () => Promise<UserError | null> }) {
  const [dismissedCorrelationId, setDismissedCorrelationId] = useState<string | null>(null)
  const [currentHydrationError, setCurrentHydrationError] = useState(error)
  const [persistenceError, setPersistenceError] = useState<UserError | null>(null)
  const persistenceIncident = useRef<UserError | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = subscribeVolatileDraftPersistence((state) => {
      if (state.degraded && !persistenceIncident.current) persistenceIncident.current = volatileDraftPersistenceError(state)
      if (!state.degraded) persistenceIncident.current = null
      const incident = persistenceIncident.current
      queueMicrotask(() => { if (active) setPersistenceError(incident) })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const retryHydration = async () => {
    if (!onRetry) return
    const nextError = await onRetry()
    setCurrentHydrationError(nextError)
    if (!nextError) setDismissedCorrelationId(null)
  }

  const hydrationError = currentHydrationError && dismissedCorrelationId !== currentHydrationError.correlationId ? currentHydrationError : null
  if (!hydrationError && !persistenceError) return null

  return <aside aria-label="Stato protezione bozze" className={errorNoticeStyles.bootstrapBannerGroup}>
    {hydrationError && <ErrorNotice
      action={onRetry ? { label: 'Riprova ripristino', onClick: retryHydration, pendingLabel: 'Ripristino…' } : undefined}
      error={hydrationError}
      secondaryAction={{ label: 'Chiudi avviso', onClick: () => setDismissedCorrelationId(hydrationError.correlationId) }}
    />}
    {persistenceError && <ErrorNotice
      action={{ label: 'Ripristina protezione', onClick: retryVolatileDraftPersistence, pendingLabel: 'Ripristino…' }}
      error={persistenceError}
    />}
  </aside>
}
