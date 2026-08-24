import type { PublicApplicationError } from './application-error.types'

export interface WorkspaceOpenResult {
  path?: string
  error?: string
  errorIncident?: PublicApplicationError
}

export interface RecentWorkspace {
  path: string
  lastOpenedAt: number
}

export interface WorkspaceInstanceStatus {
  activeCount: number
  maxInstances: 2
  canOpenNew: boolean
  workspaceOpenElsewhere: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path'
}

export interface WorkspaceLaunchResult {
  launched: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path' | 'launch-failed'
  message?: string
}

export type WorkspaceApi = {
  open: () => Promise<WorkspaceOpenResult | null>
  getActive: () => Promise<WorkspaceOpenResult | null>
  listRecent: () => Promise<RecentWorkspace[]>
  reveal: () => Promise<{ revealed: true }>
  openRecent: (workspacePath: string) => Promise<WorkspaceOpenResult>
  instanceStatus: (workspacePath?: string) => Promise<WorkspaceInstanceStatus>
  openInNewInstance: (workspacePath: string) => Promise<WorkspaceLaunchResult>
  onOpened: (listener: (result: WorkspaceOpenResult | null) => void) => () => void
}
