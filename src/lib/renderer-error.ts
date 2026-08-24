import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

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
