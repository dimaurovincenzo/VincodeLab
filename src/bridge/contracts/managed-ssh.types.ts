export interface ManagedSshConnection {
  id: string
  commandId: string
  title: string
  destination: string
  remoteRoot: string
  state: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
}

export type ManagedSshApi = {
  list: () => Promise<ManagedSshConnection[]>
  check: (connectionId: string) => Promise<boolean>
  disconnect: (connectionId: string) => Promise<{ disconnected: true }>
  onStatus: (listener: (status: ManagedSshConnection) => void) => () => void
}
