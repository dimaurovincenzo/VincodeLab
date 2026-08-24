import type { AiTerminalFallbackReason, AiTerminalRuntime } from './ai-terminal.types'
import type { ApplicationErrorCategory, ApplicationErrorSeverity } from './application-error.types'

export interface TerminalExitStatus {
  exitCode: number | null
  signal: number | string | null
  runtime?: AiTerminalRuntime
  piAvailable?: boolean
}

export type TerminalOneWayOperation = 'ready' | 'ack' | 'key' | 'resize'
export type TerminalErrorRecovery = 'resume' | 'restart' | 'resize'
export interface TerminalErrorEvent {
  operation: TerminalOneWayOperation
  recovery: TerminalErrorRecovery
  error: {
    category: ApplicationErrorCategory
    code: string
    correlationId: string
    message: string
    recoverable: boolean
    severity: ApplicationErrorSeverity
  }
}

export type TerminalStreamStatus = 'running' | 'paused' | 'stalled' | 'recovering' | 'ended'
export type TerminalOutputBlock = { sessionId: string; sequence: number; data: string }
export type TerminalOutputAck = { sessionId: string; sequence: number }
export type TerminalResumeSnapshot = {
  sessionId: string
  snapshot: { data: string; firstSequence: number; watermark: number; bytes: number }
  status: TerminalStreamStatus
  exitStatus?: TerminalExitStatus
  runtime: AiTerminalRuntime
  fallbackReason?: AiTerminalFallbackReason
  piAvailable?: boolean
}
export type TerminalStreamState = { sessionId: string; status: TerminalStreamStatus; queuedBytes: number }

export interface TerminalAttachment {
  absolutePath: string
  name: string
}

export type TerminalPasteStartResult =
  | { accepted: true; transferId: string; totalBytes: number }
  | { accepted: false; reason: 'invalid' | 'too-large' | 'not-running'; totalBytes: number; limit: number }
export type TerminalPasteChunkResult =
  | { accepted: true; complete: boolean; sentBytes: number; totalBytes: number }
  | { accepted: false; reason: 'invalid-chunk' | 'cancelled' | 'not-running'; sentBytes: number; totalBytes: number }
export type TerminalPasteCancelResult = { cancelled: boolean; sentBytes: number; totalBytes: number }
export type TerminalRendererMetrics = {
  queuedBlocks: number
  ackP50Ms: number
  ackP95Ms: number
  ackP99Ms: number
  slowFrames: number
  restoreCount: number
  mode: 'standard' | 'webgl'
}

export interface TerminalDiagnosticsReport {
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
  renderer: TerminalRendererMetrics
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

export type TerminalApi = {
  resume: (request: { knownSessionId?: string; lastAcknowledgedSequence?: number }) => Promise<TerminalResumeSnapshot>
  ready: (message: { sessionId: string; watermark: number }) => void
  ack: (message: TerminalOutputAck) => void
  chooseAttachments: () => Promise<TerminalAttachment[]>
  prepareDroppedAttachments: (files: File[]) => Promise<TerminalAttachment[]>
  writeKey: (data: string) => void
  writeInput: (data: string) => Promise<{ accepted: true; bytes: number }>
  startPaste: (input: { totalBytes: number }) => Promise<TerminalPasteStartResult>
  writePasteChunk: (input: { transferId: string; index: number; data: string }) => Promise<TerminalPasteChunkResult>
  cancelPaste: (transferId: string) => Promise<TerminalPasteCancelResult>
  reportRendererMetrics: (metrics: TerminalRendererMetrics) => void
  diagnostics: () => Promise<TerminalDiagnosticsReport>
  exportDiagnostics: () => Promise<{ exported: boolean; filePath?: string }>
  resize: (dimensions: { cols: number; rows: number }) => void
  onOutput: (listener: (block: TerminalOutputBlock) => void) => () => void
  onStreamState: (listener: (state: TerminalStreamState) => void) => () => void
  onExit: (listener: (status: TerminalExitStatus) => void) => () => void
  onError: (listener: (event: TerminalErrorEvent) => void) => () => void
}
