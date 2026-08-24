import type { ShellSessionErrorCategory } from './shell-sessions.types'
import type { TerminalExitStatus } from './terminal.types'

export type PiConfigOneWayOperation = 'input' | 'resize'
export type PiConfigErrorRecovery = 'restart' | 'resize'

export interface PiConfigErrorEvent {
  operation: PiConfigOneWayOperation
  recovery: PiConfigErrorRecovery
  error: {
    category: ShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
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
