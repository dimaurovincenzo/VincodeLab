import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

export type DatabaseToastRecovery = { label: string; onClick: () => void }

export function reportDatabaseFailure(error: unknown, operation: string, title: string, description: string, severity: 'warning' | 'error' = 'error') {
  return reportUserError(normalizeUserError(error, {
    component: 'database-workspace',
    operation,
    severity,
    title,
    fallbackDescription: description,
  }))
}

export function showDatabaseErrorToast(incident: UserError, recoveryAction?: DatabaseToastRecovery) {
  toast.error(incident.title, {
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    dedupeKey: incident.operation,
    recoveryAction,
  })
}

export function showDatabaseWarningToast(incident: UserError, recoveryAction?: DatabaseToastRecovery) {
  toast.warning(incident.title, {
    action: recoveryAction,
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    id: incident.operation,
  })
}
