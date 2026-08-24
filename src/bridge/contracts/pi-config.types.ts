import type { ApplicationErrorCategory, ApplicationErrorSeverity } from './application-error.types'
import type { TerminalExitStatus } from './terminal.types'

export type PiConfigOneWayOperation = 'input' | 'resize'
export type PiConfigErrorRecovery = 'restart' | 'resize'

export interface PiConfigErrorEvent {
  operation: PiConfigOneWayOperation
  recovery: PiConfigErrorRecovery
  error: {
    category: ApplicationErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: ApplicationErrorSeverity
  }
}

export type PiConfigApi = {
  start: () => Promise<{ started: boolean; reused: boolean }>
  close: () => Promise<{ closed: true }>
  write: (data: string) => void
  resize: (dimensions: { cols: number; rows: number }) => void
  onData: (listener: (data: string) => void) => () => void
  onExit: (listener: (status: TerminalExitStatus) => void) => () => void
  onError: (listener: (event: PiConfigErrorEvent) => void) => () => void
}
