import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { TerminalResumeSnapshot, TerminalStreamState } from '@/bridge'
import { terminalFontFamily } from '@/lib/app-preferences'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { createAnimationFrameResizeScheduler } from '@/lib/terminal-resize.js'
import { shouldFollowTerminalOutput } from '@/lib/terminal-viewport.js'
import { createXtermOutputController, type XtermOutputController } from '@/lib/xterm-output-controller.js'
import { readXtermTheme } from '@/lib/xterm-theme'
import { aiBridge } from '../api/ai.bridge'
import type { AiSessionFailure, FitAddonInstance, LaunchState, SearchAddonInstance } from '../model/ai-runtime.types'
import type { AiFailureController } from './use-ai-failure'

type MutableRef<T> = RefObject<T> & { current: T }

type UseAiTerminalInstanceOptions = {
  activeSessionIdRef: MutableRef<string | null>
  aiFailureRef: RefObject<AiSessionFailure | null>
  clearAiFailure: AiFailureController['clearAiFailure']
  connectedSessionIdRef: MutableRef<string | null>
  fitAddon: MutableRef<FitAddonInstance | null>
  fontSize: MutableRef<number>
  getTerminal: () => Terminal | null
  getTerminalElement: () => HTMLDivElement | null
  outputController: MutableRef<XtermOutputController | null>
  preferredTerminalCursorStyle: 'bar' | 'block' | 'underline'
  preferredTerminalFontFamily: string
  preferredTerminalScrollback: number
  publishAiFailure: AiFailureController['publishAiFailure']
  resumeTerminal: () => Promise<TerminalResumeSnapshot>
  searchAddon: MutableRef<SearchAddonInstance | null>
  setStatus: Dispatch<SetStateAction<LaunchState>>
  setTerminalInstance: (terminal: Terminal | null) => void
  terminalRendererGeneration: number
  updateHasUnreadTerminalOutput: (value: boolean) => void
  updateTerminalStreamState: (state: TerminalStreamState | null) => void
  workspace: string | null
}

export function useAiTerminalInstance({
  activeSessionIdRef,
  aiFailureRef,
  clearAiFailure,
  connectedSessionIdRef,
  fitAddon,
  fontSize,
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
}: UseAiTerminalInstanceOptions) {
  useEffect(() => {
    const element = getTerminalElement()
    if (!workspace || !element || getTerminal()) return
    let disposed = false
    let cleanup: (() => void) | undefined

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-search')]).then(([xtermModule, fitModule, searchModule]) => {
      const currentElement = getTerminalElement()
      if (disposed || !currentElement) return
      const xterm = new xtermModule.Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        cursorStyle: preferredTerminalCursorStyle,
        fontFamily: terminalFontFamily(preferredTerminalFontFamily),
        fontSize: fontSize.current,
        lineHeight: 1.35,
        scrollback: preferredTerminalScrollback,
        scrollSensitivity: 1,
        theme: readXtermTheme(),
      })
      const nextFitAddon = new fitModule.FitAddon()
      const nextSearchAddon = new searchModule.SearchAddon()
      xterm.loadAddon(nextFitAddon)
      xterm.loadAddon(nextSearchAddon)
      fitAddon.current = nextFitAddon
      searchAddon.current = nextSearchAddon
      xterm.open(currentElement)
      setTerminalInstance(xterm)
      if (aiFailureRef.current?.error.operation === 'initialize-ai-terminal') {
        clearAiFailure('initialize-ai-terminal')
        setStatus('running')
      }

      let dimensions = { cols: 0, rows: 0 }
      const fit = () => {
        nextFitAddon.fit()
        const nextDimensions = { cols: xterm.cols, rows: xterm.rows }
        if (nextDimensions.cols === dimensions.cols && nextDimensions.rows === dimensions.rows) return
        dimensions = nextDimensions
        const sessionId = activeSessionIdRef.current
        if (sessionId) aiBridge.terminal.resize(sessionId, nextDimensions)
      }
      const resizeScheduler = createAnimationFrameResizeScheduler(fit)
      const resizeObserver = new ResizeObserver(resizeScheduler.schedule)
      resizeObserver.observe(currentElement)
      resizeScheduler.schedule()
      const cancelInitialRefit = scheduleVisibleTerminalRefit(resizeScheduler.schedule)
      const delayedInitialRefit = window.setTimeout(resizeScheduler.schedule, 160)

      const controller = createXtermOutputController({
        write: (data, done) => xterm.write(data, done),
        ack: (message) => aiBridge.terminal.ack(message.sessionId, message),
        ready: (message) => aiBridge.terminal.ready(message.sessionId, message),
        onRendered: () => {
          if (shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })) xterm.scrollToBottom()
          else updateHasUnreadTerminalOutput(true)
        },
        onWriteError: (nextError) => publishAiFailure(nextError, {
          operation: 'render-ai-output',
          preserved: 'La sessione e l’output già visibile sono rimasti disponibili.',
          recovery: 'resume-output',
          title: 'Output della sessione AI non aggiornato',
          fallbackDescription: 'Il terminale non ha completato il rendering dell’ultimo blocco.',
        }),
      })
      outputController.current = controller
      const unsubscribeOutput = aiBridge.terminal.onOutput((block) => controller.accept(block))
      const unsubscribeStreamState = aiBridge.terminal.onStreamState((state) => {
        if (state.sessionId === activeSessionIdRef.current) updateTerminalStreamState(state)
      })
      const requestedSessionId = activeSessionIdRef.current
      if (requestedSessionId) connectedSessionIdRef.current = requestedSessionId
      void resumeTerminal().then((snapshot) => {
        connectedSessionIdRef.current = snapshot.sessionId
        controller.restore(snapshot)
        clearAiFailure('restore-ai-output')
      }).catch((nextError) => {
        updateTerminalStreamState(null)
        if (aiFailureRef.current?.error.operation === 'start-ai-session') return
        publishAiFailure(nextError, {
          operation: 'restore-ai-output',
          preserved: 'L’output già visibile è rimasto disponibile.',
          recovery: 'resume-output',
          title: 'Storico della sessione AI non disponibile',
          fallbackDescription: 'Il collegamento allo storico della sessione non è stato ripristinato.',
        })
      })

      const inputDisposable = xterm.onData((data) => {
        const sessionId = activeSessionIdRef.current
        if (sessionId) aiBridge.terminal.writeKey(sessionId, data)
      })
      const scrollDisposable = xterm.onScroll(() => updateHasUnreadTerminalOutput(!shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })))
      xterm.focus()
      cleanup = () => {
        const connectedSessionId = connectedSessionIdRef.current
        if (connectedSessionId) aiBridge.terminal.disconnect(connectedSessionId, { sessionId: connectedSessionId })
        connectedSessionIdRef.current = null
        unsubscribeOutput()
        unsubscribeStreamState()
        controller.dispose()
        inputDisposable.dispose()
        scrollDisposable.dispose()
        resizeScheduler.cancel()
        cancelInitialRefit()
        window.clearTimeout(delayedInitialRefit)
        resizeObserver.disconnect()
        xterm.dispose()
        fitAddon.current = null
        searchAddon.current = null
        outputController.current = null
        setTerminalInstance(null)
      }
    }).catch((nextError) => {
      if (disposed) return
      publishAiFailure(nextError, {
        operation: 'initialize-ai-terminal',
        preserved: 'Il workspace e gli altri strumenti restano disponibili.',
        recovery: 'retry-terminal',
        title: 'Terminale AI non disponibile',
        fallbackDescription: 'Non è stato possibile preparare il terminale AI.',
      })
      setStatus('error')
    })

    return () => { disposed = true; cleanup?.() }
  }, [activeSessionIdRef, aiFailureRef, clearAiFailure, connectedSessionIdRef, fitAddon, fontSize, getTerminal, getTerminalElement, outputController, preferredTerminalCursorStyle, preferredTerminalFontFamily, preferredTerminalScrollback, publishAiFailure, resumeTerminal, searchAddon, setStatus, setTerminalInstance, terminalRendererGeneration, updateHasUnreadTerminalOutput, updateTerminalStreamState, workspace])
}
