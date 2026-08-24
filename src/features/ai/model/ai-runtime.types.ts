import type { UserError } from '@/lib/user-error'

export type AiTab = 'terminal' | 'skills' | 'instructions'
export type LaunchState = 'idle' | 'launching' | 'running' | 'ended' | 'error'
export type AiFailureRecovery = 'reload' | 'restart' | 'resume-output' | 'retry-terminal' | 'settings'
export type AiFailureContext = {
  category?: UserError['category']
  code?: string
  correlationId?: string
  fallbackDescription: string
  operation: string
  preserved: string
  recovery: AiFailureRecovery
  secondaryRecovery?: AiFailureRecovery
  severity?: UserError['severity']
  title: string
}
export type AiSessionFailure = {
  error: UserError
  primaryRecovery: AiFailureRecovery
  secondaryRecovery?: AiFailureRecovery
}
export type AiFailureAction = { label: string; onClick: () => void | Promise<void>; pendingLabel?: string }

export type TerminalPasteFailureRecovery = 'retry-paste' | 'retry-cancel' | 'restart-ai' | 'none'
export type TerminalPasteFailure = { error: UserError; recovery: TerminalPasteFailureRecovery }

export type FitAddonInstance = { fit: () => void }
export type SearchAddonInstance = {
  clearDecorations: () => void
  findNext: (term: string, options?: { incremental?: boolean }) => boolean
  findPrevious: (term: string) => boolean
}

export type TerminalContextAction = {
  id: string
  label: string
  description: string
  disabled?: boolean
  onSelect: () => void
}
