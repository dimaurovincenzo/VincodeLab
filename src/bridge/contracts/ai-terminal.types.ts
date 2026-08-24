export type AiTerminalReloadResult = { reloaded: true }

export type AiTerminalRestartResult = { restarted: true; sessionId: string }

export type PiSessionStatus = 'starting' | 'running' | 'exited' | 'error'
export type PiSessionActivity = 'ready' | 'working' | 'completed' | 'unknown'
export type PiSession = {
  sessionId: string
  title: string
  status: PiSessionStatus
  activity: PiSessionActivity
  active: boolean
  createdAt: number
  lastFocusedAt: number
  pid: number | null
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
export type PiSessionsState = { workspacePath: string; activeSessionId: string | null; sessions: PiSession[] }

export type PiApi = {
  listSessions: () => Promise<PiSessionsState>
  createSession: () => Promise<PiSession>
  focusSession: (sessionId: string) => Promise<PiSession>
  renameSession: (sessionId: string, title: string) => Promise<PiSession>
  closeSession: (sessionId: string) => Promise<{ closed: true; activeSessionId: string | null }>
  reload: (sessionId?: string) => Promise<AiTerminalReloadResult>
  restart: (sessionId: string) => Promise<AiTerminalRestartResult>
  onSessionsChanged: (listener: (state: PiSessionsState) => void) => () => void
}
