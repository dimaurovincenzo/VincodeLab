export type ShellSessionStatus = 'starting' | 'running' | 'exited'

export interface ShellSessionMetadata {
  sessionId: string
  title: string
  status: ShellSessionStatus
  active: boolean
  createdAt: number
  lastFocusedAt: number
  cols: number
  rows: number
  pid: number | null
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}

export interface ShellSessionList {
  activeSessionId: string | null
  sessions: ShellSessionMetadata[]
}

export interface ShellSessionDataEvent {
  sessionId: string
  attachmentId: string
  generation: number
  sequence: number
  data: string
}

export interface ShellSessionOutputAck {
  attachmentId: string
  generation: number
  sequence: number
}

export interface ShellSessionRendererReady {
  attachmentId: string
  generation: number
  watermark: number
}

export interface ShellSessionOutputBlock {
  sequence: number
  data: string
}

export interface ShellSessionResumeSnapshot {
  sessionId: string
  attachmentId: string
  generation: number
  blocks: ShellSessionOutputBlock[]
  firstSequence: number
  watermark: number
  bytes: number
  truncated: boolean
  droppedBytes: number
  status: ShellSessionStatus
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}

export interface ShellSessionExitEvent {
  sessionId: string
  exitCode: number | null
  signal: number | string | null
  reason: 'exit' | 'closed'
}

export type ShellSessionOneWayOperation = 'ready' | 'ack' | 'disconnect' | 'write' | 'resize'
export type ShellSessionErrorRecovery = 'resume' | 'restart' | 'resize'
export type ShellSessionErrorCategory =
  | 'validation'
  | 'not-found'
  | 'permission'
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'conflict'
  | 'process'
  | 'database'
  | 'filesystem'
  | 'git'
  | 'github'
  | 'remote'
  | 'configuration'
  | 'persistence'
  | 'internal'

export interface ShellSessionErrorEvent {
  sessionId: string
  operation: ShellSessionOneWayOperation
  recovery: ShellSessionErrorRecovery
  error: {
    category: ShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}

export type ShellSessionsApi = {
  list: () => Promise<ShellSessionList>
  resume: (sessionId: string) => Promise<ShellSessionResumeSnapshot>
  ready: (sessionId: string, message: ShellSessionRendererReady) => void
  ack: (sessionId: string, message: ShellSessionOutputAck) => void
  disconnect: (sessionId: string, message: { attachmentId: string; generation: number }) => void
  create: () => Promise<ShellSessionMetadata>
  focus: (sessionId: string) => Promise<ShellSessionMetadata>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, dimensions: { cols: number; rows: number }) => void
  restart: (sessionId: string) => Promise<ShellSessionMetadata>
  close: (sessionId: string) => Promise<{ closed: boolean; activeSessionId: string | null }>
  onData: (listener: (event: ShellSessionDataEvent) => void) => () => void
  onExit: (listener: (event: ShellSessionExitEvent) => void) => () => void
  onError: (listener: (event: ShellSessionErrorEvent) => void) => () => void
}
