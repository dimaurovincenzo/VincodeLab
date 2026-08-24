import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError } from '@/lib/user-error'

type RemoteFailureCategory = 'filesystem' | 'remote'

export function reportRemoteFailure(error: unknown, operation: string, title: string, description: string, category?: RemoteFailureCategory) {
  return reportUserError(normalizeUserError(error, {
    ...(category ? { category } : {}),
    component: 'remote-files',
    operation,
    title,
    fallbackDescription: description,
  }))
}

export function showRemoteFailure(
  error: unknown,
  operation: string,
  title: string,
  description: string,
  category?: RemoteFailureCategory,
  recoveryAction?: { label: string; onClick: () => void },
) {
  const incident = reportRemoteFailure(error, operation, title, description, category)
  toast.error(incident.title, {
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    dedupeKey: operation,
    recoveryAction,
  })
  return incident
}
