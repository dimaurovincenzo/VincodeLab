export interface ManagedUpdate {
  id: string
  kind: 'skill' | 'pi-extension' | 'pi-runtime'
  name: string
  sourceType: 'github' | 'runtime'
  owner: string | null
  repository: string | null
  ref: string | null
  channel: string
  activeVersion: string
  rollbackVersion: string | null
  availableVersion: string | null
  stagedVersion: string | null
  changelog: string | null
  policy: 'manual' | 'automatic'
  status: string
  restartRequired: boolean
  lastCheckedAt: number | null
  lastError: string | null
}

export type UpdatesApi = {
  list: () => Promise<ManagedUpdate[]>
  check: (id?: string) => Promise<ManagedUpdate[]>
  download: (id: string) => Promise<ManagedUpdate>
  downloadAll: () => Promise<ManagedUpdate[]>
  setPolicy: (id: string, policy: 'manual' | 'automatic') => Promise<ManagedUpdate>
  rollback: (id: string) => Promise<ManagedUpdate>
  activatePending: () => Promise<Array<{
    id: string
    success: boolean
    error?: string
    update?: ManagedUpdate
  }>>
}
