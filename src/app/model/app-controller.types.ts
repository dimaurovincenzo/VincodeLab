import type { DatabaseWorkbenchContext } from '@/features/database'
import type { EditorWorkbenchContext } from '@/features/editor'
import type { GitHubWorkbenchContext } from '@/features/github'
import type { RedisWorkbenchContext } from '@/features/redis'
import type { AiTab } from '@/features/ai'
import type { UserError } from '@/lib/user-error'

export type WorkspaceChangeRequest = { kind: 'choose' } | { kind: 'recent'; path: string }
export type WorkspaceOpenFailure = { request: WorkspaceChangeRequest; error: UserError }
export type WorkspaceSessionFailure = { error: UserError; kind: 'corrupt' | 'persistence' }
export type HomeFailure = { error: UserError; recovery: 'open-workspace' | 'refresh-recents' }
export type AiInputFailureContext = { description: string; operation: string; title: string }
export type WorkspaceGuardScope = 'editor' | 'skills' | 'instructions' | 'database' | 'settings'
export type AppSection = 'ai' | 'terminal' | 'editor' | 'github' | 'database' | 'redis' | 'settings'
export type WorkbenchCommandContext = {
  hasWorkspace: boolean
  section: AppSection
  aiTab: AiTab
  editor: EditorWorkbenchContext
  github: GitHubWorkbenchContext
  database: DatabaseWorkbenchContext
  redis: RedisWorkbenchContext
}

export const emptyEditorContext: EditorWorkbenchContext = { activeFileId: null, activeFileName: null, dirty: false, source: null, selection: null }
export const emptyGitHubContext: GitHubWorkbenchContext = { tab: 'changes', branch: null, changedFiles: [], selectedDiffPath: null }
export const emptyDatabaseContext: DatabaseWorkbenchContext = { connectionId: null, connectionName: null, executing: false, sql: '', tableName: null, transactionActive: false }
export const emptyRedisContext: RedisWorkbenchContext = { connectionId: null, searching: false }
