import type { ShellSessionErrorRecovery, ShellSessionStatus } from '@/bridge'
import type { UserError } from '@/lib/user-error'

export type TerminalSessionUiStatus = 'starting' | 'ready' | 'exited' | 'error'

export type TerminalFailure = {
  error: UserError
  recovery: ShellSessionErrorRecovery
}

export type TerminalPreferenceFailure = {
  error: UserError
  recovery: 'load' | 'save'
}

export type TerminalClipboardFailure = {
  action: 'copy' | 'paste'
  error: UserError
}

const terminalSessionStatusCopy: Readonly<Record<TerminalSessionUiStatus, string>> = Object.freeze({
  starting: 'Avvio shell…',
  ready: 'Shell pronta',
  exited: 'Shell terminata',
  error: 'Shell non disponibile',
})

export function terminalSessionUiStatus(status: ShellSessionStatus | undefined): TerminalSessionUiStatus {
  if (status === 'starting') return 'starting'
  if (status === 'exited') return 'exited'
  return 'ready'
}

export function terminalSessionStatusLabel(status: TerminalSessionUiStatus): string {
  return terminalSessionStatusCopy[status]
}
