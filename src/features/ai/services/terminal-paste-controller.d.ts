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
  startPaste: Window['vincodeLab']['terminal']['startPaste']
  writePasteChunk: Window['vincodeLab']['terminal']['writePasteChunk']
  cancelPaste: Window['vincodeLab']['terminal']['cancelPaste']
  chunkBytes?: number
}

export function splitUtf8Chunks(text: string, maxBytes?: number): Generator<string>
export function createTerminalPasteController(api: TerminalPasteApi): {
  send(text: string, onProgress?: (progress: TerminalPasteProgress) => void): Promise<TerminalPasteProgress>
  cancel(onProgress?: (progress: TerminalPasteProgress) => void): Promise<TerminalPasteProgress>
  isActive(): boolean
}

export type TerminalPasteController = ReturnType<typeof createTerminalPasteController>
