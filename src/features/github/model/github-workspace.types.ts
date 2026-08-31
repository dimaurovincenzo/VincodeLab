import type { WorkspaceSessionState } from '@/bridge'

export type GitHubTab = 'changes' | 'graph' | 'issues' | 'projects'

export type GitHubWorkbenchRequest =
  | { kind: 'focus-primary'; nonce: number }
  | { kind: 'open-file-diff'; filePath: string; nonce: number }

export type GitHubWorkbenchContext = {
  tab: GitHubTab
  branch: string | null
  changedFiles: string[]
  selectedDiffPath: string | null
}

export type GitHubWorkspaceProps = {
  active: boolean
  workspace: string
  initialState?: WorkspaceSessionState['github']
  workbenchRequest?: GitHubWorkbenchRequest | null
  onContextChange?: (context: GitHubWorkbenchContext) => void
  onOpenFile?: (filePath: string) => void
  onSessionChange?: (state: Pick<WorkspaceSessionState['github'], 'tab' | 'selectedDiffPath' | 'selectedProjectNumber' | 'issueStateFilter'>) => void
}

export type GitHubErrorSurface =
  | 'branches'
  | 'git-changes'
  | 'git-commit'
  | 'git-remote'
  | 'diff'
  | 'github-data'
  | 'github-diagnostic'
  | 'issues'
  | 'projects'
  | 'projects-diagnostic'
  | 'board'
  | 'project-item-create'
  | 'project-fields'

export type GitHubErrorContext = {
  action: string
  notFoundTitle?: string
  operation: string
  preserved?: string
  recovery: string
  title: string
}

export type RefreshOutcome = { accepted: boolean; stale: boolean; error?: unknown }
