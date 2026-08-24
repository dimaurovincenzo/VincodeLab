import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import { toast } from '@/components/ui'
import type { AiTerminalRestartOptions, AiTerminalRestartResult, HerdrCommand, TerminalStreamState } from '@/bridge'
import { reportRendererFailure, showUserErrorToast } from '@/lib/renderer-error'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'
import type { XtermOutputController } from '@/lib/xterm-output-controller.js'
import { observeXtermTheme } from '@/lib/xterm-theme'
import { aiBridge } from '../api/ai.bridge'
import type { AiSessionFailure, AiTerminalRuntimeState, FitAddonInstance, LaunchState, SearchAddonInstance } from '../model/ai-runtime.types'
import type { AiFailureController } from './use-ai-failure'
import { useAiTerminalInstance } from './use-ai-terminal-instance'
import { useAiTerminalPaste } from './use-ai-terminal-paste'
import { useAiTerminalPreferences, useAiTerminalPreferenceSyncEffect, useAiTerminalZoomEffect } from './use-ai-terminal-preferences'

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
  const {
    changeFontSize,
    fontSize,
    fontSizeRef,
    loadAiTerminalPreferences,
    resetTerminalZoom,
    setFontSize,
  } = useAiTerminalPreferences({ fitAddon, getTerminal, preferredTerminalFontSize, workspace })
  const hasUnreadTerminalOutputRef = useRef(false)
  const [hasUnreadTerminalOutput, setHasUnreadTerminalOutput] = useState(false)
  const streamStateIdentityRef = useRef('')
  const [streamState, setStreamState] = useState<TerminalStreamState | null>(null)
  const [terminalRendererGeneration, setTerminalRendererGeneration] = useState(0)
  const terminalRuntimeRef = useRef<AiTerminalRuntimeState | null>(null)
  const [terminalRuntime, setTerminalRuntime] = useState<AiTerminalRuntimeState | null>(null)

  const updateTerminalRuntime = useCallback((nextRuntime: AiTerminalRuntimeState | null) => {
    const current = terminalRuntimeRef.current
    if (current?.runtime === nextRuntime?.runtime && current?.fallbackReason === nextRuntime?.fallbackReason && current?.piAvailable === nextRuntime?.piAvailable) return
    terminalRuntimeRef.current = nextRuntime
    setTerminalRuntime(nextRuntime)
  }, [])

  const resumeTerminal = useCallback(async () => {
    const snapshot = await aiBridge.terminal.resume({})
    updateTerminalRuntime({ runtime: snapshot.runtime, fallbackReason: snapshot.fallbackReason, piAvailable: snapshot.piAvailable })
    return snapshot
  }, [updateTerminalRuntime])

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
      const result = await aiBridge.pi.reload()
      if (!result.reloaded) {
        toast.info('Esegui /reload nel pane Pi desiderato in Herdr.')
        return
      }
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

  const restartPi = useCallback(async (options?: AiTerminalRestartOptions) => {
    setStatus('launching')
    let restartResult: AiTerminalRestartResult
    try {
      restartResult = await aiBridge.pi.restart(options)
      updateTerminalRuntime({ runtime: restartResult.runtime, fallbackReason: restartResult.fallbackReason, piAvailable: restartResult.piAvailable })
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restart-ai-session',
        preserved: 'L’output precedente è rimasto disponibile.',
        recovery: options?.runtime === 'pi' ? 'start-pi-direct' : 'restart',
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
      await controller.reconnect(resumeTerminal)
      toast.success(restartResult.runtime === 'herdr' ? 'Client Herdr riaperto.' : 'Sessione Pi riavviata.')
    } catch (nextError) {
      publishAiFailure(nextError, {
        operation: 'restore-ai-output',
        preserved: 'La sessione è stata riavviata e l’output precedente è rimasto visibile.',
        recovery: 'resume-output',
        title: 'Sessione riavviata, output non collegato',
        fallbackDescription: 'La sessione è attiva, ma il collegamento al nuovo output non è stato ripristinato.',
      })
    }
  }, [clearAiFailure, publishAiFailure, resumeTerminal, setStatus, updateTerminalRuntime])

  const runHerdrCommand = useCallback(async function runHerdrCommandAction(command: HerdrCommand) {
    try {
      const result = await aiBridge.terminal.herdrCommand(command)
      if (command === 'new-pi' || command === 'new-pi-right' || command === 'new-pi-down') toast.success(`Agente ${result.agentName ?? 'Pi'} avviato in Herdr.`)
      else if (command === 'close-pane') toast.success('Pane Herdr chiuso.')
      else if (result.focused === false) toast.info('Nessun agente Herdr disponibile nel workspace.')
      getTerminal()?.focus()
      return result
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'process',
        component: 'ai-terminal',
        operation: `herdr-${command}`,
        title: command.startsWith('new-pi') ? 'Agente Pi non avviato' : 'Comando Herdr non completato',
        fallbackDescription: command.startsWith('new-pi')
          ? 'Herdr non ha potuto creare il nuovo agente. La sessione corrente è rimasta attiva.'
          : 'Herdr non ha potuto cambiare agente. La sessione corrente è rimasta attiva.',
      })
      showUserErrorToast(incident, { label: 'Riprova', onClick: () => { void runHerdrCommandAction(command) } })
      return null
    }
  }, [getTerminal])

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
      await controller.reconnect(resumeTerminal)
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
  }, [aiFailureRef, clearAiFailure, publishAiFailure, resumeTerminal])

  const retryAiTerminal = useCallback(() => {
    setStatus('launching')
    setTerminalRendererGeneration((value) => value + 1)
  }, [setStatus])

  const paste = useAiTerminalPaste({ restartPi, terminal })
  const pasteIntoTerminal = paste.pasteIntoTerminal

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

  useEffect(() => aiBridge.terminal.onExit(({ exitCode, signal, runtime, piAvailable }) => {
    const exitedRuntime = runtime ?? terminalRuntimeRef.current?.runtime ?? 'pi'
    const directPiAvailable = piAvailable ?? terminalRuntimeRef.current?.piAvailable ?? exitedRuntime === 'pi'
    setStatus(exitCode === 0 && !signal ? 'ended' : 'error')
    if (exitCode === 0 && !signal) {
      showEndedAiSession(exitedRuntime, directPiAvailable)
    } else if (signal) {
      publishAiFailure(new Error(`PTY signal ${signal}`), {
        operation: 'ai-session-crash',
        preserved: 'L’output già ricevuto è rimasto disponibile.',
        recovery: 'restart',
        secondaryRecovery: exitedRuntime === 'herdr' ? directPiAvailable ? 'start-pi-direct' : 'settings' : undefined,
        title: exitedRuntime === 'herdr' ? 'Client Herdr interrotto' : 'Sessione AI interrotta',
        fallbackDescription: exitedRuntime === 'herdr' ? 'Il client Herdr si è interrotto; la fleet condivisa non è stata arrestata.' : 'La sessione AI si è interrotta in modo imprevisto.',
      })
    } else {
      publishAiFailure(new Error(`PTY exit code ${exitCode ?? 'unknown'}`), {
        operation: 'ai-session-crash',
        preserved: 'L’output già ricevuto è rimasto disponibile.',
        recovery: 'restart',
        secondaryRecovery: exitedRuntime === 'herdr' ? directPiAvailable ? 'start-pi-direct' : 'settings' : undefined,
        title: exitedRuntime === 'herdr' ? 'Client Herdr terminato' : 'Sessione AI terminata in modo imprevisto',
        fallbackDescription: exitedRuntime === 'herdr' ? 'Il client Herdr si è chiuso; la fleet condivisa non è stata arrestata.' : 'La sessione AI si è chiusa prima di completare il lavoro.',
      })
    }
  }), [publishAiFailure, setStatus, showEndedAiSession])

  useEffect(() => {
    updateTerminalRuntime(null)
  }, [updateTerminalRuntime, workspace])

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

  useAiTerminalZoomEffect({ fitAddon, fontSize, getTerminal })

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
    resumeTerminal,
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

  useAiTerminalPreferenceSyncEffect({
    fitAddon,
    fontSizeRef,
    getTerminal,
    preferredTerminalCursorStyle,
    preferredTerminalFontFamily,
    preferredTerminalFontSize,
    preferredTerminalScrollback,
    setFontSize,
  })

  const sendAiInput = useCallback(async (data: string) => {
    if (terminalRuntimeRef.current?.runtime === 'herdr') {
      toast.info('In Herdr seleziona il pane Pi desiderato e inserisci il contenuto direttamente.')
      return false
    }
    await aiBridge.terminal.writeInput(data)
    getTerminal()?.focus()
    return true
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
    runHerdrCommand,
    retryAiOutput,
    retryAiTerminal,
    revealTerminalOutput,
    searchAddon,
    sendAiInput,
    setTerminalQuery,
    setTerminalSearchOpen,
    streamState,
    terminalRuntime,
    terminalQuery,
    terminalSearchOpen,
    updateHasUnreadTerminalOutput,
    updateTerminalStreamState,
  }
}
