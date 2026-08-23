export type UserErrorCategory =
  | 'validation'
  | 'not-found'
  | 'permission'
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'conflict'
  | 'process'
  | 'database'
  | 'filesystem'
  | 'git'
  | 'github'
  | 'remote'
  | 'configuration'
  | 'persistence'
  | 'internal'

export type UserErrorSeverity = 'info' | 'warning' | 'error'

export type UserError = Readonly<{
  category: UserErrorCategory
  code?: string
  component?: string
  correlationId: string
  description: string
  operation?: string
  recoverable: boolean
  severity: UserErrorSeverity
  technicalMessage: string
  timestamp: string
  title: string
}>

export type NormalizeUserErrorOptions = {
  category?: UserErrorCategory
  code?: string
  component?: string
  correlationId?: string
  description?: string
  fallbackDescription?: string
  operation?: string
  recoverable?: boolean
  severity?: UserErrorSeverity
  timestamp?: string
  title?: string
}

export const USER_ERROR_CATEGORIES: readonly UserErrorCategory[]
export function createErrorCorrelationId(): string
export function normalizeUserError(error: unknown, options?: NormalizeUserErrorOptions): UserError
export function reportUserError(userError: UserError): UserError
export function sanitizeDiagnosticText(value: unknown): string
export function userErrorDiagnostic(userError: UserError): string
export function userErrorMessage(error: unknown, fallback: string): string
