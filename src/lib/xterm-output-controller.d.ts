import type { TerminalOutputAck, TerminalOutputBlock, TerminalResumeSnapshot } from '@/bridge'

export type XtermOutputController = {
  accept: (block: TerminalOutputBlock) => boolean
  restore: (payload: TerminalResumeSnapshot) => boolean
  reconnect: (resume: () => Promise<TerminalResumeSnapshot>) => Promise<boolean>
  dispose: () => void
  metrics: () => {
    queuedBlocks: number
    ackP50Ms: number
    ackP95Ms: number
    ackP99Ms: number
    slowFrames: number
    restoreCount: number
    mode: 'standard'
  }
}

export function createXtermOutputController(options: {
  write: (data: string, callback: () => void) => void
  ack: (message: TerminalOutputAck) => void
  ready: (message: { sessionId: string; watermark: number }) => void
  onRendered: (block: TerminalOutputBlock) => void
  onWriteError: (error: unknown) => void
  now?: () => number
  latencySampleLimit?: number
}): XtermOutputController
