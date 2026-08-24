import type { ShellSessionsApi, VincodeLabBridge } from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedShellSessionStatus = 'starting' | 'running' | 'exited'
interface ExpectedShellSessionMetadata {
  sessionId: string
  title: string
  status: ExpectedShellSessionStatus
  active: boolean
  createdAt: number
  lastFocusedAt: number
  cols: number
  rows: number
  pid: number | null
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
interface ExpectedShellSessionList {
  activeSessionId: string | null
  sessions: ExpectedShellSessionMetadata[]
}
interface ExpectedShellSessionDataEvent {
  sessionId: string
  attachmentId: string
  generation: number
  sequence: number
  data: string
}
interface ExpectedShellSessionOutputAck {
  attachmentId: string
  generation: number
  sequence: number
}
interface ExpectedShellSessionRendererReady {
  attachmentId: string
  generation: number
  watermark: number
}
interface ExpectedShellSessionOutputBlock {
  sequence: number
  data: string
}
interface ExpectedShellSessionResumeSnapshot {
  sessionId: string
  attachmentId: string
  generation: number
  blocks: ExpectedShellSessionOutputBlock[]
  firstSequence: number
  watermark: number
  bytes: number
  truncated: boolean
  droppedBytes: number
  status: ExpectedShellSessionStatus
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
interface ExpectedShellSessionExitEvent {
  sessionId: string
  exitCode: number | null
  signal: number | string | null
  reason: 'exit' | 'closed'
}
type ExpectedShellSessionOneWayOperation = 'ready' | 'ack' | 'disconnect' | 'write' | 'resize'
type ExpectedShellSessionErrorRecovery = 'resume' | 'restart' | 'resize'
type ExpectedShellSessionErrorCategory =
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
interface ExpectedShellSessionErrorEvent {
  sessionId: string
  operation: ExpectedShellSessionOneWayOperation
  recovery: ExpectedShellSessionErrorRecovery
  error: {
    category: ExpectedShellSessionErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}
type ExpectedShellSessionsApi = {
  list: () => Promise<ExpectedShellSessionList>
  resume: (sessionId: string) => Promise<ExpectedShellSessionResumeSnapshot>
  ready: (sessionId: string, message: ExpectedShellSessionRendererReady) => void
  ack: (sessionId: string, message: ExpectedShellSessionOutputAck) => void
  disconnect: (sessionId: string, message: { attachmentId: string; generation: number }) => void
  create: () => Promise<ExpectedShellSessionMetadata>
  focus: (sessionId: string) => Promise<ExpectedShellSessionMetadata>
  write: (sessionId: string, data: string) => void
  resize: (sessionId: string, dimensions: { cols: number; rows: number }) => void
  restart: (sessionId: string) => Promise<ExpectedShellSessionMetadata>
  close: (sessionId: string) => Promise<{ closed: boolean; activeSessionId: string | null }>
  onData: (listener: (event: ExpectedShellSessionDataEvent) => void) => () => void
  onExit: (listener: (event: ExpectedShellSessionExitEvent) => void) => () => void
  onError: (listener: (event: ExpectedShellSessionErrorEvent) => void) => () => void
}

export type ShellSessionsBridgeContractAssertions = [
  Expect<Equal<ShellSessionsApi, ExpectedShellSessionsApi>>,
  Expect<Equal<Window['vincodeLab']['shellSessions'], ShellSessionsApi>>,
  Expect<Equal<VincodeLabBridge['shellSessions'], ShellSessionsApi>>,
  Expect<Equal<keyof ShellSessionsApi,
    | 'list'
    | 'resume'
    | 'ready'
    | 'ack'
    | 'disconnect'
    | 'create'
    | 'focus'
    | 'write'
    | 'resize'
    | 'restart'
    | 'close'
    | 'onData'
    | 'onExit'
    | 'onError'
  >>,
]

// @ts-expect-error Lo stato sessione deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionStatusContractMustNotBeGlobal = ShellSessionStatus
// @ts-expect-error I metadati sessione devono essere importati dal bridge, non dichiarati globalmente.
export type ShellSessionMetadataContractMustNotBeGlobal = ShellSessionMetadata
// @ts-expect-error La lista sessioni deve essere importata dal bridge, non dichiarata globalmente.
export type ShellSessionListContractMustNotBeGlobal = ShellSessionList
// @ts-expect-error L’evento dati deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionDataEventContractMustNotBeGlobal = ShellSessionDataEvent
// @ts-expect-error L’ack deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionOutputAckContractMustNotBeGlobal = ShellSessionOutputAck
// @ts-expect-error Il ready renderer deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionRendererReadyContractMustNotBeGlobal = ShellSessionRendererReady
// @ts-expect-error Il blocco output deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionOutputBlockContractMustNotBeGlobal = ShellSessionOutputBlock
// @ts-expect-error Lo snapshot deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionResumeSnapshotContractMustNotBeGlobal = ShellSessionResumeSnapshot
// @ts-expect-error L’evento exit deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionExitEventContractMustNotBeGlobal = ShellSessionExitEvent
// @ts-expect-error L’operazione one-way deve essere importata dal bridge, non dichiarata globalmente.
export type ShellSessionOneWayOperationContractMustNotBeGlobal = ShellSessionOneWayOperation
// @ts-expect-error La recovery deve essere importata dal bridge, non dichiarata globalmente.
export type ShellSessionErrorRecoveryContractMustNotBeGlobal = ShellSessionErrorRecovery
// @ts-expect-error La categoria deve essere importata dal bridge, non dichiarata globalmente.
export type ShellSessionErrorCategoryContractMustNotBeGlobal = ShellSessionErrorCategory
// @ts-expect-error L’evento errore deve essere importato dal bridge, non dichiarato globalmente.
export type ShellSessionErrorEventContractMustNotBeGlobal = ShellSessionErrorEvent
