import type { TerminalApi } from '@/bridge'

/** Stato pubblico del trasferimento paste posseduto dalla feature AI. */
export type TerminalPasteProgress = {
  status: 'starting' | 'running' | 'complete' | 'cancelled' | 'failed'
  sentBytes: number
  totalBytes: number
  reason?: string
  limit?: number
  /** Technical cause retained in memory for classification; never render it directly. */
  error?: unknown
}

type TerminalPasteApi = {
  startPaste: (input: { totalBytes: number }) => ReturnType<TerminalApi['startPaste']>
  writePasteChunk: (input: { transferId: string; index: number; data: string }) => ReturnType<TerminalApi['writePasteChunk']>
  cancelPaste: (transferId: string) => ReturnType<TerminalApi['cancelPaste']>
  chunkBytes?: number
}

export function splitUtf8Chunks(text: string, maxBytes?: number): Generator<string>
export function createTerminalPasteController(api: TerminalPasteApi): {
  send(text: string, onProgress?: (progress: TerminalPasteProgress) => void): Promise<TerminalPasteProgress>
  cancel(onProgress?: (progress: TerminalPasteProgress) => void): Promise<TerminalPasteProgress>
  isActive(): boolean
}

export type TerminalPasteController = ReturnType<typeof createTerminalPasteController>
