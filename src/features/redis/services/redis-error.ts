import { normalizeUserError, reportUserError } from '@/lib/user-error'

export function reportRedisFailure(error: unknown, operation: string, title: string, fallbackDescription: string) {
  return reportUserError(normalizeUserError(error, {
    category: 'database',
    component: 'redis-workspace',
    operation,
    title,
    fallbackDescription,
  }))
}
