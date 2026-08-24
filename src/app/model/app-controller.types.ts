import type { DatabaseWorkbenchContext } from '@/features/database'
import type { EditorWorkbenchContext } from '@/features/editor'
import type { GitHubWorkbenchContext } from '@/features/github'
import type { RedisWorkbenchContext } from '@/features/redis'
import type { UserError } from '@/lib/user-error'

export type LaunchState = 'idle' | 'launching' | 'running' | 'ended' | 'error'
export type WorkspaceChangeRequest = { kind: 'choose' } | { kind: 'recent'; path: string }
export type WorkspaceOpenFailure = { request: WorkspaceChangeRequest; error: UserError }
export type WorkspaceSessionFailure = { error: UserError; kind: 'corrupt' | 'persistence' }
export type HomeFailure = { error: UserError; recovery: 'open-workspace' | 'refresh-recents' }
export type AiFailureRecovery = 'reload' | 'restart' | 'resume-output' | 'retry-terminal' | 'settings'
export type AiFailureContext = {
  category?: UserError['category']
  code?: string
  correlationId?: string
  fallbackDescription: string
  operation: string
  preserved: string
  recovery: AiFailureRecovery
  severity?: UserError['severity']
  title: string
}
export type AiSessionFailure = {
  error: UserError
  primaryRecovery: AiFailureRecovery
  secondaryRecovery?: AiFailureRecovery
}
export type AiFailureAction = { label: string; onClick: () => void | Promise<void>; pendingLabel?: string }
export type AiInputFailureContext = { description: string; operation: string; title: string }
export type TerminalPasteFailureRecovery = 'retry-paste' | 'retry-cancel' | 'restart-ai' | 'none'
export type TerminalPasteFailure = { error: UserError; recovery: TerminalPasteFailureRecovery }
export type WorkspaceGuardScope = 'editor' | 'skills' | 'instructions' | 'database' | 'settings'
export type AppSection = 'ai' | 'terminal' | 'editor' | 'github' | 'database' | 'redis' | 'settings'
export type WorkbenchCommandContext = {
  hasWorkspace: boolean
  section: AppSection
  aiTab: 'terminal' | 'skills' | 'instructions'
  editor: EditorWorkbenchContext
  github: GitHubWorkbenchContext
  database: DatabaseWorkbenchContext
  redis: RedisWorkbenchContext
}

export type FitAddonInstance = { fit: () => void }

export type SearchAddonInstance = {
  clearDecorations: () => void
  findNext: (term: string, options?: { incremental?: boolean }) => boolean
  findPrevious: (term: string) => boolean
}

export const emptyEditorContext: EditorWorkbenchContext = { activeFileId: null, activeFileName: null, dirty: false, source: null, selection: null }
export const emptyGitHubContext: GitHubWorkbenchContext = { tab: 'changes', branch: null, changedFiles: [], selectedDiffPath: null }
export const emptyDatabaseContext: DatabaseWorkbenchContext = { connectionId: null, connectionName: null, executing: false, sql: '', tableName: null, transactionActive: false }
export const emptyRedisContext: RedisWorkbenchContext = { connectionId: null, searching: false }
