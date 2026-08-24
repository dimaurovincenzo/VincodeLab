import { useCallback, useState, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { toast } from '@/components/ui'
import { reportRendererFailure } from '@/lib/renderer-error'
import { createTerminalPasteController, type TerminalPasteProgress } from '../services/terminal-paste-controller.js'
import { aiBridge } from '../api/ai.bridge'
import type { TerminalPasteFailure } from '../model/ai-runtime.types'
import { reportTerminalPasteFailure } from '../services/ai-error'

type UseAiTerminalPasteOptions = {
  activeSessionIdRef: RefObject<string | null>
  restartPi: () => Promise<void>
  terminal: RefObject<Terminal | null>
}

function createSessionPasteController(activeSessionIdRef: RefObject<string | null>) {
  const activeSessionId = () => activeSessionIdRef.current
  return createTerminalPasteController({
    startPaste: (input) => {
      const sessionId = activeSessionId()
      return sessionId
        ? aiBridge.terminal.startPaste(sessionId, input)
        : Promise.resolve({ accepted: false as const, reason: 'not-running' as const, totalBytes: input.totalBytes, limit: 0 })
    },
    writePasteChunk: (input) => {
      const sessionId = activeSessionId()
      return sessionId
        ? aiBridge.terminal.writePasteChunk(sessionId, input)
        : Promise.resolve({ accepted: false as const, reason: 'not-running' as const, sentBytes: 0, totalBytes: 0 })
    },
    cancelPaste: (transferId) => {
      const sessionId = activeSessionId()
      return sessionId
        ? aiBridge.terminal.cancelPaste(sessionId, transferId)
        : Promise.resolve({ cancelled: false, sentBytes: 0, totalBytes: 0 })
    },
  })
}

export function useAiTerminalPaste({ activeSessionIdRef, restartPi, terminal }: UseAiTerminalPasteOptions) {
  const [pasteProgress, setPasteProgress] = useState<TerminalPasteProgress | null>(null)
  const [pasteFailure, setPasteFailure] = useState<TerminalPasteFailure | null>(null)
  const [pasteController] = useState(() => createSessionPasteController(activeSessionIdRef))

  const pasteIntoTerminal = useCallback(async function pasteIntoTerminalAction() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        setPasteProgress(null)
        setPasteFailure(null)
        toast.info('Gli appunti non contengono testo da incollare.')
        return
      }
      setPasteFailure(null)
      const result = await pasteController.send(text, setPasteProgress)
      if (result.status === 'complete' || result.status === 'cancelled') {
        setPasteProgress(null)
        setPasteFailure(null)
        terminal.current?.focus()
        return
      }
      if (result.status === 'failed') {
        setPasteProgress(result)
        setPasteFailure(reportTerminalPasteFailure(result))
      }
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'permission',
        component: 'ai-terminal',
        operation: 'paste-clipboard',
        title: 'Appunti non disponibili',
        description: 'macOS non ha consentito di leggere gli appunti. Il prompt è rimasto invariato; verifica i permessi e riprova.',
      })
      setPasteProgress({ error: nextError, reason: 'clipboard-unavailable', sentBytes: 0, status: 'failed', totalBytes: 0 })
      setPasteFailure({ error: incident, recovery: 'retry-paste' })
    }
  }, [pasteController, terminal])

  const cancelTerminalPaste = useCallback(async () => {
    try {
      const result = await pasteController.cancel(setPasteProgress)
      if (result.status === 'failed') {
        setPasteProgress(result)
        setPasteFailure(reportTerminalPasteFailure(result))
        return
      }
      setPasteProgress(null)
      setPasteFailure(null)
    } catch (nextError) {
      const result: TerminalPasteProgress = {
        error: nextError,
        reason: 'cancel-unavailable',
        sentBytes: pasteProgress?.sentBytes ?? 0,
        status: 'failed',
        totalBytes: pasteProgress?.totalBytes ?? 0,
      }
      setPasteProgress(result)
      setPasteFailure(reportTerminalPasteFailure(result))
    }
  }, [pasteController, pasteProgress])

  const recoverTerminalPaste = useCallback(async () => {
    const recovery = pasteFailure?.recovery
    if (recovery === 'retry-cancel') {
      await cancelTerminalPaste()
      return
    }
    if (recovery === 'restart-ai') {
      setPasteProgress(null)
      setPasteFailure(null)
      await restartPi()
      return
    }
    if (recovery === 'retry-paste') await pasteIntoTerminal()
  }, [cancelTerminalPaste, pasteFailure, pasteIntoTerminal, restartPi])

  const closeTerminalPasteStatus = useCallback(() => {
    setPasteProgress(null)
    setPasteFailure(null)
  }, [])

  return {
    cancelTerminalPaste,
    closeTerminalPasteStatus,
    pasteFailure,
    pasteIntoTerminal,
    pasteProgress,
    recoverTerminalPaste,
  }
}
