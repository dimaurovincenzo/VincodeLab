export type BenchmarkFault =
  | 'ipc-rejection'
  | 'persistence-corrupt'
  | 'ai-crash'
  | 'pty-failure'
  | 'file-not-found'
  | 'file-permission'
  | 'git-failure'
  | 'github-network'
  | 'database-connection'
  | 'database-query'
  | 'sftp-failure'

export type BenchmarkWindowRectangle = {
  height: number
  width: number
  x: number
  y: number
}

export type BenchmarkWindowBounds = {
  bounds: BenchmarkWindowRectangle
  contentBounds: BenchmarkWindowRectangle
  maximized: boolean
  visible: boolean
}

export type BenchmarkApi = {
  captureWindowBounds?: () => Promise<BenchmarkWindowBounds>
  dispatchCommand: (command: 'workbench.commandPalette' | 'workbench.quickOpen') => Promise<{ dispatched: true }>
  injectFault?: <Fault extends BenchmarkFault>(fault: Fault) => Promise<{ armed: true; fault: Fault }>
  probe?: () => Promise<{ ok: true }>
  shutdown: () => Promise<{ accepted: true }>
}
