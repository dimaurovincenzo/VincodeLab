import type {
  ApplicationErrorCategory as BridgeApplicationErrorCategory,
  ApplicationErrorSeverity as BridgeApplicationErrorSeverity,
  PiApi,
  PiConfigApi,
  PiConfigErrorEvent as BridgePiConfigErrorEvent,
  TerminalApi,
  TerminalErrorEvent as BridgeTerminalErrorEvent,
  VincodeLabBridge,
} from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedAiTerminalReloadResult = { reloaded: true }
type ExpectedAiTerminalRestartResult = { restarted: true; sessionId: string }
type ExpectedPiSession = {
  sessionId: string
  title: string
  status: 'starting' | 'running' | 'exited' | 'error'
  activity: 'ready' | 'working' | 'completed' | 'unknown'
  active: boolean
  createdAt: number
  lastFocusedAt: number
  pid: number | null
  exitStatus: { exitCode: number | null; signal: number | string | null } | null
}
type ExpectedPiSessionsState = { workspacePath: string; activeSessionId: string | null; sessions: ExpectedPiSession[] }
type ExpectedPiApi = {
  listSessions: () => Promise<ExpectedPiSessionsState>
  createSession: () => Promise<ExpectedPiSession>
  focusSession: (sessionId: string) => Promise<ExpectedPiSession>
  renameSession: (sessionId: string, title: string) => Promise<ExpectedPiSession>
  closeSession: (sessionId: string) => Promise<{ closed: true; activeSessionId: string | null }>
  reload: (sessionId?: string) => Promise<ExpectedAiTerminalReloadResult>
  restart: (sessionId: string) => Promise<ExpectedAiTerminalRestartResult>
  onSessionsChanged: (listener: (state: ExpectedPiSessionsState) => void) => () => void
}

type ExpectedTerminalErrorCategory =
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
interface ExpectedTerminalExitStatus {
  sessionId?: string
  exitCode: number | null
  signal: number | string | null
}
type ExpectedTerminalOneWayOperation = 'ready' | 'ack' | 'key' | 'resize'
type ExpectedTerminalErrorRecovery = 'resume' | 'restart' | 'resize'
interface ExpectedTerminalErrorEvent {
  sessionId?: string
  operation: ExpectedTerminalOneWayOperation
  recovery: ExpectedTerminalErrorRecovery
  error: {
    category: ExpectedTerminalErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}
type ExpectedTerminalStreamStatus = 'running' | 'paused' | 'stalled' | 'recovering' | 'ended'
type ExpectedTerminalOutputBlock = { sessionId: string; sequence: number; data: string }
type ExpectedTerminalOutputAck = { sessionId: string; sequence: number }
type ExpectedTerminalResumeSnapshot = {
  sessionId: string
  snapshot: { data: string; firstSequence: number; watermark: number; bytes: number }
  status: ExpectedTerminalStreamStatus
  exitStatus?: ExpectedTerminalExitStatus
}
type ExpectedTerminalStreamState = { sessionId: string; status: ExpectedTerminalStreamStatus; queuedBytes: number }
interface ExpectedTerminalAttachment {
  absolutePath: string
  name: string
}
type ExpectedTerminalPasteStartResult =
  | { accepted: true; transferId: string; totalBytes: number }
  | { accepted: false; reason: 'invalid' | 'too-large' | 'not-running'; totalBytes: number; limit: number }
type ExpectedTerminalPasteChunkResult =
  | { accepted: true; complete: boolean; sentBytes: number; totalBytes: number }
  | { accepted: false; reason: 'invalid-chunk' | 'cancelled' | 'not-running'; sentBytes: number; totalBytes: number }
type ExpectedTerminalPasteCancelResult = { cancelled: boolean; sentBytes: number; totalBytes: number }
type ExpectedTerminalRendererMetrics = {
  queuedBlocks: number
  ackP50Ms: number
  ackP95Ms: number
  ackP99Ms: number
  slowFrames: number
  restoreCount: number
  mode: 'standard' | 'webgl'
}
interface ExpectedTerminalDiagnosticsReport {
  version: 1
  generatedAt: string
  pipeline: {
    receivedBytes: number
    renderedBytes: number
    averageBlockBytes: number
    maxBlockBytes: number
    queuedBytes: number
    peakQueuedBytes: number
    pauseCount: number
    pausedMs: number
  }
  renderer: ExpectedTerminalRendererMetrics
  paste: {
    started: number
    completed: number
    cancelled: number
    rejected: number
    acceptedBytes: number
    activeTransfers: number
    pendingBytes: number
  }
}
type ExpectedTerminalApi = {
  resume: (sessionId: string) => Promise<ExpectedTerminalResumeSnapshot>
  ready: (sessionId: string, message: { sessionId: string; watermark: number }) => void
  ack: (sessionId: string, message: ExpectedTerminalOutputAck) => void
  disconnect: (sessionId: string, message: { sessionId: string }) => void
  chooseAttachments: () => Promise<ExpectedTerminalAttachment[]>
  prepareDroppedAttachments: (files: File[]) => Promise<ExpectedTerminalAttachment[]>
  writeKey: (sessionId: string, data: string) => void
  writeInput: (sessionId: string, data: string) => Promise<{ accepted: true; bytes: number }>
  startPaste: (sessionId: string, input: { totalBytes: number }) => Promise<ExpectedTerminalPasteStartResult>
  writePasteChunk: (sessionId: string, input: { transferId: string; index: number; data: string }) => Promise<ExpectedTerminalPasteChunkResult>
  cancelPaste: (sessionId: string, transferId: string) => Promise<ExpectedTerminalPasteCancelResult>
  reportRendererMetrics: (sessionId: string, metrics: ExpectedTerminalRendererMetrics) => void
  diagnostics: (sessionId?: string) => Promise<ExpectedTerminalDiagnosticsReport>
  exportDiagnostics: (sessionId?: string) => Promise<{ exported: boolean; filePath?: string }>
  resize: (sessionId: string, dimensions: { cols: number; rows: number }) => void
  onOutput: (listener: (block: ExpectedTerminalOutputBlock) => void) => () => void
  onStreamState: (listener: (state: ExpectedTerminalStreamState) => void) => () => void
  onExit: (listener: (status: ExpectedTerminalExitStatus) => void) => () => void
  onError: (listener: (event: ExpectedTerminalErrorEvent) => void) => () => void
}

type ExpectedPiConfigOneWayOperation = 'input' | 'resize'
type ExpectedPiConfigErrorRecovery = 'restart' | 'resize'
interface ExpectedPiConfigErrorEvent {
  operation: ExpectedPiConfigOneWayOperation
  recovery: ExpectedPiConfigErrorRecovery
  error: {
    category: ExpectedTerminalErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: 'info' | 'warning' | 'error'
  }
}
type ExpectedPiConfigApi = {
  start: () => Promise<{ started: boolean; reused: boolean }>
  close: () => Promise<{ closed: true }>
  write: (data: string) => void
  resize: (dimensions: { cols: number; rows: number }) => void
  onData: (listener: (data: string) => void) => () => void
  onExit: (listener: (status: ExpectedTerminalExitStatus) => void) => () => void
  onError: (listener: (event: ExpectedPiConfigErrorEvent) => void) => () => void
}

export type TerminalBridgeContractAssertions = [
  Expect<Equal<BridgeTerminalErrorEvent['error']['category'], BridgeApplicationErrorCategory>>,
  Expect<Equal<BridgeTerminalErrorEvent['error']['severity'], BridgeApplicationErrorSeverity>>,
  Expect<Equal<BridgePiConfigErrorEvent['error']['category'], BridgeApplicationErrorCategory>>,
  Expect<Equal<BridgePiConfigErrorEvent['error']['severity'], BridgeApplicationErrorSeverity>>,
  Expect<Equal<PiApi, ExpectedPiApi>>,
  Expect<Equal<VincodeLabBridge['pi'], PiApi>>,
  Expect<Equal<keyof PiApi, 'listSessions' | 'createSession' | 'focusSession' | 'renameSession' | 'closeSession' | 'reload' | 'restart' | 'onSessionsChanged'>>,
  Expect<Equal<TerminalApi, ExpectedTerminalApi>>,
  Expect<Equal<VincodeLabBridge['terminal'], TerminalApi>>,
  Expect<Equal<keyof TerminalApi,
    | 'resume'
    | 'ready'
    | 'ack'
    | 'disconnect'
    | 'chooseAttachments'
    | 'prepareDroppedAttachments'
    | 'writeKey'
    | 'writeInput'
    | 'startPaste'
    | 'writePasteChunk'
    | 'cancelPaste'
    | 'reportRendererMetrics'
    | 'diagnostics'
    | 'exportDiagnostics'
    | 'resize'
    | 'onOutput'
    | 'onStreamState'
    | 'onExit'
    | 'onError'
  >>,
  Expect<Equal<PiConfigApi, ExpectedPiConfigApi>>,
  Expect<Equal<VincodeLabBridge['piConfig'], PiConfigApi>>,
  Expect<Equal<keyof PiConfigApi, 'start' | 'close' | 'write' | 'resize' | 'onData' | 'onExit' | 'onError'>>,
  Expect<Equal<Awaited<ReturnType<VincodeLabBridge['files']['prepareAttachment']>>, ExpectedTerminalAttachment>>,
  Expect<Equal<Awaited<ReturnType<VincodeLabBridge['skills']['reload']>>, ExpectedAiTerminalReloadResult>>,
]

// @ts-expect-error Lo stato exit deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalExitStatusContractMustNotBeGlobal = TerminalExitStatus
// @ts-expect-error Il reload AI deve essere importato dal bridge, non dichiarato globalmente.
export type AiTerminalReloadResultContractMustNotBeGlobal = AiTerminalReloadResult
// @ts-expect-error Il risultato restart deve essere importato dal bridge, non dichiarato globalmente.
export type AiTerminalRestartResultContractMustNotBeGlobal = AiTerminalRestartResult
// @ts-expect-error L’operazione terminale deve essere importata dal bridge, non dichiarata globalmente.
export type TerminalOneWayOperationContractMustNotBeGlobal = TerminalOneWayOperation
// @ts-expect-error La recovery terminale deve essere importata dal bridge, non dichiarata globalmente.
export type TerminalErrorRecoveryContractMustNotBeGlobal = TerminalErrorRecovery
// @ts-expect-error L’evento errore terminale deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalErrorEventContractMustNotBeGlobal = TerminalErrorEvent
// @ts-expect-error L’operazione Pi config deve essere importata dal bridge, non dichiarata globalmente.
export type PiConfigOneWayOperationContractMustNotBeGlobal = PiConfigOneWayOperation
// @ts-expect-error La recovery Pi config deve essere importata dal bridge, non dichiarata globalmente.
export type PiConfigErrorRecoveryContractMustNotBeGlobal = PiConfigErrorRecovery
// @ts-expect-error L’evento Pi config deve essere importato dal bridge, non dichiarato globalmente.
export type PiConfigErrorEventContractMustNotBeGlobal = PiConfigErrorEvent
// @ts-expect-error Lo stato stream deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalStreamStatusContractMustNotBeGlobal = TerminalStreamStatus
// @ts-expect-error Il blocco output deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalOutputBlockContractMustNotBeGlobal = TerminalOutputBlock
// @ts-expect-error L’ack output deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalOutputAckContractMustNotBeGlobal = TerminalOutputAck
// @ts-expect-error Lo snapshot resume deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalResumeSnapshotContractMustNotBeGlobal = TerminalResumeSnapshot
// @ts-expect-error Lo stato stream renderer deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalStreamStateContractMustNotBeGlobal = TerminalStreamState
// @ts-expect-error L’allegato deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalAttachmentContractMustNotBeGlobal = TerminalAttachment
// @ts-expect-error Il risultato paste start deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalPasteStartResultContractMustNotBeGlobal = TerminalPasteStartResult
// @ts-expect-error Il risultato paste chunk deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalPasteChunkResultContractMustNotBeGlobal = TerminalPasteChunkResult
// @ts-expect-error Il risultato paste cancel deve essere importato dal bridge, non dichiarato globalmente.
export type TerminalPasteCancelResultContractMustNotBeGlobal = TerminalPasteCancelResult
// @ts-expect-error Le metriche renderer devono essere importate dal bridge, non dichiarate globalmente.
export type TerminalRendererMetricsContractMustNotBeGlobal = TerminalRendererMetrics
// @ts-expect-error La diagnostica deve essere importata dal bridge, non dichiarata globalmente.
export type TerminalDiagnosticsReportContractMustNotBeGlobal = TerminalDiagnosticsReport
