import { normalizeUserError, reportUserError, type UserError, type UserErrorCategory } from '@/lib/user-error'

export function settingsUserError(cause: unknown, {
  category,
  code,
  correlationId,
  description,
  fallbackDescription,
  operation,
  severity,
  title,
}: {
  category?: UserErrorCategory
  code?: string
  correlationId?: string
  description?: string
  fallbackDescription?: string
  operation: string
  severity?: UserError['severity']
  title: string
}) {
  return reportUserError(normalizeUserError(cause, {
    category,
    code,
    component: 'settings',
    correlationId,
    description,
    fallbackDescription,
    operation,
    severity,
    title,
  }))
}
