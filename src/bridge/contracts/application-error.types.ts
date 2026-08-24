export type ApplicationErrorCategory =
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

export type ApplicationErrorSeverity = 'info' | 'warning' | 'error'

export interface PublicApplicationError {
  category: ApplicationErrorCategory
  code: string
  correlationId: string
  message: string
  recoverable: boolean
  severity: ApplicationErrorSeverity
}
