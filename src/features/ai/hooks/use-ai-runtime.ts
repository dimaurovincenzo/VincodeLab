import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { LaunchState } from '../model/ai-runtime.types'
import { useAiFailure } from './use-ai-failure'
import { useAiTerminalRuntime } from './use-ai-terminal-runtime'

type UseAiRuntimeOptions = {
  active: boolean
  focusRequest: number
  paletteOpen: boolean
  preferredTerminalCursorStyle: 'bar' | 'block' | 'underline'
  preferredTerminalFontFamily: string
  preferredTerminalFontSize: number
  preferredTerminalScrollback: number
  setStatus: Dispatch<SetStateAction<LaunchState>>
  status: LaunchState
  workspace: string | null
}

export function useAiRuntime({
  active,
  focusRequest,
  paletteOpen,
  preferredTerminalCursorStyle,
  preferredTerminalFontFamily,
  preferredTerminalFontSize,
  preferredTerminalScrollback,
  setStatus,
  status,
  workspace,
}: UseAiRuntimeOptions) {
  const terminalElement = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const getTerminal = useCallback(() => terminal.current, [])
  const getTerminalElement = useCallback(() => terminalElement.current, [])
  const setTerminalInstance = useCallback((instance: Terminal | null) => { terminal.current = instance }, [])
  const failure = useAiFailure()
  const runtime = useAiTerminalRuntime({
    active,
    aiFailureRef: failure.aiFailureRef,
    clearAiFailure: failure.clearAiFailure,
    focusRequest,
    getTerminal,
    getTerminalElement,
    paletteOpen,
    preferredTerminalCursorStyle,
    preferredTerminalFontFamily,
    preferredTerminalFontSize,
    preferredTerminalScrollback,
    publishAiFailure: failure.publishAiFailure,
    setStatus,
    setTerminalInstance,
    showEndedAiSession: failure.showEndedAiSession,
    terminal,
    workspace,
  })

  const selectAllTerminal = useCallback(() => {
    terminal.current?.selectAll()
    terminal.current?.focus()
  }, [])
  const terminalStatus = status === 'running'
    ? 'Pi pronto'
    : status === 'launching'
      ? 'Avvio Pi…'
      : status === 'ended'
        ? 'Sessione terminata'
        : status === 'error'
          ? 'Errore Pi'
          : 'In attesa'

  return {
    ...runtime,
    aiFailure: failure.aiFailure,
    clearAiFailure: failure.clearAiFailure,
    publishAiFailure: failure.publishAiFailure,
    restoreAiFailure: failure.restoreAiFailure,
    selectAllTerminal,
    status,
    terminalElement,
    terminalStatus,
  }
}

export type AiRuntimeController = ReturnType<typeof useAiRuntime>
