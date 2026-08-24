import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import { toast } from '@/components/ui'
import { terminalFontFamily } from '@/lib/app-preferences'
import { reportRendererFailure, reportTransientFailure, showUserErrorToast } from '@/lib/renderer-error'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '@/lib/terminal-preferences.js'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'
import type { XtermOutputController } from '@/lib/xterm-output-controller.js'
import { observeXtermTheme } from '@/lib/xterm-theme'
import { aiBridge } from '../api/ai.bridge'
import type { AiSessionFailure, FitAddonInstance, LaunchState, SearchAddonInstance } from '../model/ai-runtime.types'
import type { AiFailureController } from './use-ai-failure'
import { useAiTerminalInstance } from './use-ai-terminal-instance'
import { useAiTerminalPaste } from './use-ai-terminal-paste'

type UseAiTerminalRuntimeOptions = {
  active: boolean
  aiFailureRef: RefObject<AiSessionFailure | null>
  clearAiFailure: AiFailureController['clearAiFailure']
  focusRequest: number
  getTerminal: () => Terminal | null
  getTerminalElement: () => HTMLDivElement | null
  paletteOpen: boolean
  preferredTerminalCursorStyle: 'bar' | 'block' | 'underline'
  preferredTerminalFontFamily: string
  preferredTerminalFontSize: number
  preferredTerminalScrollback: number
  publishAiFailure: AiFailureController['publishAiFailure']
  setStatus: Dispatch<SetStateAction<LaunchState>>
  setTerminalInstance: (terminal: Terminal | null) => void
  showEndedAiSession: AiFailureController['showEndedAiSession']
  terminal: RefObject<Terminal | null>
  workspace: string | null
}

export function useAiTerminalRuntime({
  active,
  aiFailureRef,
  clearAiFailure,
  focusRequest,
  getTerminal,
  getTerminalElement,
  paletteOpen,
  preferredTerminalCursorStyle,
  preferredTerminalFontFamily,
  preferredTerminalFontSize,
  preferredTerminalScrollback,
  publishAiFailure,
  setStatus,
  setTerminalInstance,
  showEndedAiSession,
  terminal,
  workspace,
}: UseAiTerminalRuntimeOptions) {
  const outputController = useRef<XtermOutputController | null>(null)
  const fitAddon = useRef<FitAddonInstance | null>(null)
  const searchAddon = useRef<SearchAddonInstance | null>(null)
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false)
  const [terminalQuery, setTerminalQuery] = useState('')
  const [fontSize, setFontSize] = useState(11)
  const fontSizeRef = useRef(fontSize)
  const hasUnreadTerminalOutputRef = useRef(false)
  const [hasUnreadTerminalOutput, setHasUnreadTerminalOutput] = useState(false)
  const streamStateIdentityRef = useRef('')
  const [streamState, setStreamState] = useState<TerminalStreamState | null>(null)
  const [terminalRendererGeneration, setTerminalRendererGeneration] = useState(0)

  const persistAiTerminalPreferences = useCallback(function persistAiTerminalPreferencesAction(workspacePath: string, nextFontSize: number) {
    writeTerminalPreferences(workspacePath, { fontSize: nextFontSize, followOutput: true }, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'save-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non salvate',
          description: 'La nuova dimensione resta attiva in questa sessione, ma potrebbe non essere ripristinata alla prossima apertura.',
        }, { label: 'Salva di nuovo', onClick: () => { persistAiTerminalPreferencesAction(workspacePath, nextFontSize) } })
      },
    })
  }, [])

  const loadAiTerminalPreferences = useCallback(function loadAiTerminalPreferencesAction(workspacePath: string) {
    const preferences = readTerminalPreferences(workspacePath, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'load-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non caricate',
          description: 'È stata applicata la dimensione predefinita. La sessione e l’output sono rimasti disponibili.',
        }, { label: 'Carica di nuovo', onClick: () => { loadAiTerminalPreferencesAction(workspacePath) } })
      },
    })
    fontSizeRef.current = preferences.fontSize
    setFontSize(preferences.fontSize)
    const xterm = getTerminal()
    if (xterm) xterm.options.fontSize = preferences.fontSize
    fitAddon.current?.fit()
  }, [getTerminal])

  const changeFontSize = useCallback((delta: number) => {
    const next = nextTerminalFontSize(fontSizeRef.current, delta)
    fontSizeRef.current = next
    setFontSize(next)
    if (workspace) persistAiTerminalPreferences(workspace, next)
  }, [persistAiTerminalPreferences, workspace])

  const copyTerminalSelection = useCallback(async function copyTerminalSelectionAction() {
    const selection = getTerminal()?.getSelection() ?? ''
    if (!selection) {
      toast.info('Nessun testo selezionato nel terminale.')
      return
    }
    try {
      await navigator.clipboard.writeText(selection)
      toast.success('Testo del terminale copiato.')
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'permission',
        component: 'ai-terminal',
        operation: 'copy-selection',
        title: 'Appunti non disponibili',
        fallbackDescription: 'macOS non ha consentito di copiare la selezione. Verifica i permessi e riprova.',
      })
      showUserErrorToast(incident, { label: 'Riprova', onClick: () => { void copyTerminalSelectionAction() } })
    }
  }, [getTerminal])

  const clearTerminal = useCallback(() => {
    getTerminal()?.clear()
    getTerminal()?.focus()
    toast.info('Vista del terminale pulita.')
  }, [getTerminal])

  const reloadPi = useCallback(async function reloadPiAction() {
    try {
      await aiBridge.pi.reload()
      const refitAfterReload = () => {
        const xterm = getTerminal()
        if (!xterm) return
        fitAddon.current?.fit()
        aiBridge.terminal.resize({ cols: xterm.cols, rows: xterm.rows })
      }
      scheduleVisibleTerminalRefit(refitAfterReload)
      window.setTimeout(refitAfterReload, 160)
      clearAiFailure('reload-ai-resources')
      toast.success('Pi sta ricaricando skill, prompt ed estensioni.')
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'reload-ai-resources',
        preserved: 'La sessione corrente e l’output già disponibile sono rimasti invariati.',
        recovery: 'reload',
        title: 'Risorse AI non ricaricate',
        fallbackDescription: 'Non è stato possibile ricaricare skill, prompt ed estensioni.',
      })
    }
  }, [clearAiFailure, getTerminal, publishAiFailure])

  const restartPi = useCallback(async () => {
    setStatus('launching')
    try {
      await aiBridge.pi.restart()
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restart-ai-session',
        preserved: 'L’output precedente è rimasto disponibile.',
        recovery: 'restart',
        title: 'Sessione AI non riavviata',
        fallbackDescription: 'Non è stato possibile riavviare la sessione AI.',
      })
      setStatus('error')
      return
    }
    setStatus('running')
    clearAiFailure()
    const controller = outputController.current
    if (!controller) {
      publishAiFailure(new Error('AI output controller unavailable [AI_OUTPUT_CONTROLLER_UNAVAILABLE]'), {
        operation: 'initialize-ai-terminal',
        preserved: 'La sessione è stata riavviata e il workspace resta disponibile.',
        recovery: 'retry-terminal',
        title: 'Sessione riavviata, terminale non disponibile',
        fallbackDescription: 'Il collegamento visivo alla sessione AI deve essere preparato nuovamente.',
      })
      return
    }
    try {
      await controller.reconnect(() => aiBridge.terminal.resume({}))
      toast.success('Sessione Pi riavviata')
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restore-ai-output',
        preserved: 'La sessione è stata riavviata e l’output precedente è rimasto visibile.',
        recovery: 'resume-output',
        title: 'Sessione riavviata, output non collegato',
        fallbackDescription: 'La sessione è attiva, ma il collegamento al nuovo output non è stato ripristinato.',
      })
    }
  }, [clearAiFailure, publishAiFailure, setStatus])

  const retryAiOutput = useCallback(async () => {
    const controller = outputController.current
    if (!controller) {
      publishAiFailure(new Error('AI output controller unavailable [AI_OUTPUT_CONTROLLER_UNAVAILABLE]'), {
        operation: 'initialize-ai-terminal',
        preserved: 'Il workspace e l’output già visibile sono rimasti disponibili.',
        recovery: 'retry-terminal',
        title: 'Terminale AI non disponibile',
        fallbackDescription: 'Il collegamento alla sessione AI deve essere preparato nuovamente.',
      })
      return
    }
    const attemptedFailure = aiFailureRef.current
    try {
      await controller.reconnect(() => aiBridge.terminal.resume({}))
      if (aiFailureRef.current === attemptedFailure) clearAiFailure()
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restore-ai-output',
        preserved: 'L’output già visibile è rimasto disponibile.',
        recovery: 'resume-output',
        title: 'Output della sessione AI non collegato',
        fallbackDescription: 'Il collegamento all’output della sessione non è stato ripristinato.',
      })
    }
  }, [aiFailureRef, clearAiFailure, publishAiFailure])

  const retryAiTerminal = useCallback(() => {
    setStatus('launching')
    setTerminalRendererGeneration((value) => value + 1)
  }, [setStatus])

  const paste = useAiTerminalPaste({ restartPi, terminal })
  const pasteIntoTerminal = paste.pasteIntoTerminal

  const resetTerminalZoom = useCallback(() => {
    fontSizeRef.current = preferredTerminalFontSize
    setFontSize(preferredTerminalFontSize)
    if (workspace) persistAiTerminalPreferences(workspace, preferredTerminalFontSize)
  }, [persistAiTerminalPreferences, preferredTerminalFontSize, workspace])

  const closeTerminalSearch = useCallback(() => {
    searchAddon.current?.clearDecorations()
    setTerminalQuery('')
    setTerminalSearchOpen(false)
    requestAnimationFrame(() => getTerminal()?.focus())
  }, [getTerminal])

  const updateHasUnreadTerminalOutput = useCallback((nextValue: boolean) => {
    if (hasUnreadTerminalOutputRef.current === nextValue) return
    hasUnreadTerminalOutputRef.current = nextValue
    setHasUnreadTerminalOutput(nextValue)
  }, [])

  const updateTerminalStreamState = useCallback((nextState: TerminalStreamState | null) => {
    const identity = nextState ? `${nextState.sessionId}:${nextState.status}` : ''
    if (streamStateIdentityRef.current === identity) return
    streamStateIdentityRef.current = identity
    setStreamState(nextState)
  }, [])

  const revealTerminalOutput = useCallback(() => {
    getTerminal()?.scrollToBottom()
    updateHasUnreadTerminalOutput(false)
  }, [getTerminal, updateHasUnreadTerminalOutput])

  useEffect(() => aiBridge.terminal.onExit(({ exitCode, signal }) => {
    setStatus(exitCode === 0 && !signal ? 'ended' : 'error')
    if (exitCode === 0 && !signal) {
      showEndedAiSession()
    } else if (signal) {
      publishAiFailure(new Error(`PTY signal ${signal}`), {
        operation: 'ai-session-crash',
        preserved: 'L’output già ricevuto è rimasto disponibile.',
        recovery: 'restart',
        title: 'Sessione AI interrotta',
        fallbackDescription: 'La sessione AI si è interrotta in modo imprevisto.',
      })
    } else {
      publishAiFailure(new Error(`PTY exit code ${exitCode ?? 'unknown'}`), {
        operation: 'ai-session-crash',
        preserved: 'L’output già ricevuto è rimasto disponibile.',
        recovery: 'restart',
        title: 'Sessione AI terminata in modo imprevisto',
        fallbackDescription: 'La sessione AI si è chiusa prima di completare il lavoro.',
      })
    }
  }), [publishAiFailure, setStatus, showEndedAiSession])

  useEffect(() => {
    const subscribe = aiBridge.terminal.onError
    if (!subscribe) return
    return subscribe((event) => {
      if (event.operation === 'resize') {
        const incident = reportRendererFailure(event.error, {
          category: event.error.category,
          code: event.error.code,
          component: 'ai-terminal',
          correlationId: event.error.correlationId,
          description: 'La sessione resta attiva, ma la nuova dimensione del terminale non è stata applicata. Puoi riprovare senza perdere l’output.',
          operation: 'resize-ai-terminal',
          severity: 'warning',
          title: 'Dimensione del terminale non aggiornata',
        })
        showUserErrorToast(incident, {
          label: 'Riprova',
          onClick: () => {
            const xterm = getTerminal()
            if (!xterm) return
            fitAddon.current?.fit()
            aiBridge.terminal.resize({ cols: xterm.cols, rows: xterm.rows })
          },
        })
        return
      }

      const outputOperation = event.operation === 'ready' || event.operation === 'ack'
      publishAiFailure(event.error, {
        category: event.error.category,
        code: event.error.code,
        correlationId: event.error.correlationId,
        fallbackDescription: outputOperation
          ? 'Il collegamento all’output della sessione non ha completato una conferma.'
          : 'La sessione AI non ha confermato l’ultimo input da tastiera.',
        operation: outputOperation ? 'restore-ai-output' : 'send-ai-input',
        preserved: outputOperation
          ? 'L’output già visibile è rimasto disponibile.'
          : 'Il prompt e l’output già visibile sono rimasti disponibili; l’ultimo carattere potrebbe non essere stato inviato.',
        recovery: outputOperation ? 'resume-output' : 'restart',
        severity: event.error.severity,
        title: outputOperation ? 'Output della sessione AI non sincronizzato' : 'Input non inviato alla sessione AI',
      })
    })
  }, [getTerminal, publishAiFailure])

  useEffect(() => {
    if (!terminalSearchOpen) return
    if (!terminalQuery) {
      searchAddon.current?.clearDecorations()
      return
    }
    searchAddon.current?.findNext(terminalQuery, { incremental: true })
  }, [terminalQuery, terminalSearchOpen])

  useEffect(() => {
    const xterm = getTerminal()
    if (!xterm) return
    xterm.options.fontSize = fontSize
    requestAnimationFrame(() => fitAddon.current?.fit())
  }, [fontSize, getTerminal])

  useEffect(() => {
    if (!workspace || !active || !getTerminal()) return
    return scheduleVisibleTerminalRefit(() => {
      fitAddon.current?.fit()
      const xterm = getTerminal()
      if (xterm) aiBridge.terminal.resize({ cols: xterm.cols, rows: xterm.rows })
    })
  }, [active, getTerminal, workspace])

  useEffect(() => {
    if (!active) return
    const report = () => {
      const metrics = outputController.current?.metrics()
      if (metrics) aiBridge.terminal.reportRendererMetrics(metrics)
    }
    report()
    const intervalId = window.setInterval(report, 2_000)
    return () => window.clearInterval(intervalId)
  }, [active, terminalRendererGeneration])

  useEffect(() => {
    if (!active || focusRequest <= 0) return
    requestAnimationFrame(() => getTerminal()?.focus())
  }, [active, focusRequest, getTerminal])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const xterm = getTerminal()
      if (!workspace || !active || paletteOpen || (!event.metaKey && !event.ctrlKey) || suppressGlobalTerminalShortcut(event.target)) return
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setTerminalSearchOpen(true) }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeFontSize(1) }
      if (event.key === '-') { event.preventDefault(); changeFontSize(-1) }
      if (event.key === '0') { event.preventDefault(); resetTerminalZoom() }
      if (event.key.toLowerCase() === 'c' && xterm?.hasSelection()) { event.preventDefault(); void copyTerminalSelection() }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); void pasteIntoTerminal() }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); clearTerminal() }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [active, changeFontSize, clearTerminal, copyTerminalSelection, getTerminal, paletteOpen, pasteIntoTerminal, resetTerminalZoom, workspace])

  useAiTerminalInstance({
    aiFailureRef,
    clearAiFailure,
    fitAddon,
    fontSize: fontSizeRef,
    getTerminal,
    getTerminalElement,
    outputController,
    preferredTerminalCursorStyle,
    preferredTerminalFontFamily,
    preferredTerminalScrollback,
    publishAiFailure,
    searchAddon,
    setStatus,
    setTerminalInstance,
    terminalRendererGeneration,
    updateHasUnreadTerminalOutput,
    updateTerminalStreamState,
    workspace,
  })

  useEffect(() => observeXtermTheme((theme) => {
    const xterm = getTerminal()
    if (xterm) xterm.options.theme = theme
  }), [getTerminal])

  useEffect(() => {
    fontSizeRef.current = preferredTerminalFontSize
    queueMicrotask(() => setFontSize(preferredTerminalFontSize))
    const xterm = getTerminal()
    if (!xterm) return
    xterm.options.fontSize = preferredTerminalFontSize
    xterm.options.fontFamily = terminalFontFamily(preferredTerminalFontFamily)
    xterm.options.cursorStyle = preferredTerminalCursorStyle
    xterm.options.scrollback = preferredTerminalScrollback
    fitAddon.current?.fit()
  }, [getTerminal, preferredTerminalCursorStyle, preferredTerminalFontFamily, preferredTerminalFontSize, preferredTerminalScrollback])

  const sendAiInput = useCallback(async (data: string) => {
    await aiBridge.terminal.writeInput(data)
    getTerminal()?.focus()
  }, [getTerminal])

  return {
    ...paste,
    changeFontSize,
    clearTerminal,
    closeTerminalSearch,
    copyTerminalSelection,
    fontSize,
    hasUnreadTerminalOutput,
    loadAiTerminalPreferences,
    reloadPi,
    resetTerminalZoom,
    restartPi,
    retryAiOutput,
    retryAiTerminal,
    revealTerminalOutput,
    searchAddon,
    sendAiInput,
    setTerminalQuery,
    setTerminalSearchOpen,
    streamState,
    terminalQuery,
    terminalSearchOpen,
    updateHasUnreadTerminalOutput,
    updateTerminalStreamState,
  }
}
