import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import type { ShellSessionResumeSnapshot } from '@/bridge'
import { terminalBridge } from '../api/terminal.bridge'
import type { TerminalFailure, TerminalSessionUiStatus } from '../model/terminal-session'
import { reportTerminalFailure, terminalFailureFromEvent } from '../services/terminal-error'
import { createAnimationFrameResizeScheduler } from '@/lib/terminal-resize.js'
import { shouldFollowTerminalOutput } from '@/lib/terminal-viewport.js'
import { observeXtermTheme, readXtermTheme } from '@/lib/xterm-theme'
import { terminalFontFamily } from '@/lib/app-preferences'
import { createShellXtermOutputController } from '../services/shell-xterm-output-controller'

type TerminalRuntimePreferences = {
  preferredCursorStyle: 'bar' | 'block' | 'underline'
  preferredFontFamily: string
  preferredScrollback: number
}

type UseShellXtermLifecycleOptions = {
  container: RefObject<HTMLDivElement | null>
  fontSizeRef: RefObject<number>
  isActiveRef: RefObject<boolean>
  publishRefitTerminal: (refit: (() => void) | null) => void
  publishSearchAddon: (addon: SearchAddon | null) => void
  publishSynchronizeOutput: (synchronize: ((reset?: boolean) => Promise<void>) | null) => void
  publishTerminal: (terminal: Terminal | null) => void
  sessionId: string
  setHasUnreadOutput: Dispatch<SetStateAction<boolean>>
  setTerminalFailure: Dispatch<SetStateAction<TerminalFailure | null>>
  statusRef: RefObject<TerminalSessionUiStatus>
  synchronizeOutput: RefObject<((reset?: boolean) => Promise<void>) | null>
  terminal: RefObject<Terminal | null>
  terminalPreferences: RefObject<TerminalRuntimePreferences>
  updateStatus: (status: TerminalSessionUiStatus) => void
}

export function useShellXtermLifecycle({
  container,
  fontSizeRef,
  isActiveRef,
  publishRefitTerminal,
  publishSearchAddon,
  publishSynchronizeOutput,
  publishTerminal,
  sessionId,
  setHasUnreadOutput,
  setTerminalFailure,
  statusRef,
  synchronizeOutput,
  terminal,
  terminalPreferences,
  updateStatus,
}: UseShellXtermLifecycleOptions) {
  useEffect(() => {
    if (!container.current) return

    const initialPreferences = terminalPreferences.current
    const xterm = new Terminal({
      cursorBlink: true,
      cursorStyle: initialPreferences.preferredCursorStyle,
      fontFamily: terminalFontFamily(initialPreferences.preferredFontFamily),
      fontSize: fontSizeRef.current,
      lineHeight: 1.35,
      scrollback: initialPreferences.preferredScrollback,
      theme: readXtermTheme(),
    })
    const fitAddon = new FitAddon()
    const nextSearchAddon = new SearchAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(nextSearchAddon)
    xterm.open(container.current)
    publishTerminal(xterm)
    publishSearchAddon(nextSearchAddon)

    let disposed = false
    let synchronizationRequest = 0
    let outputErrorReported = false
    let automaticOutputRecoveryUsed = false
    let dimensions = { cols: 0, rows: 0 }
    const fit = () => {
      if (!isActiveRef.current || statusRef.current === 'exited' || statusRef.current === 'error') return
      fitAddon.fit()
      const nextDimensions = { cols: xterm.cols, rows: xterm.rows }
      if (nextDimensions.cols === dimensions.cols && nextDimensions.rows === dimensions.rows) return
      dimensions = nextDimensions
      terminalBridge.shellSessions.resize(sessionId, nextDimensions)
    }
    const resizeScheduler = createAnimationFrameResizeScheduler(fit)
    const resizeObserver = new ResizeObserver(resizeScheduler.schedule)
    resizeObserver.observe(container.current)
    publishRefitTerminal(fit)
    resizeScheduler.schedule()
    const outputController = createShellXtermOutputController({
      sessionId,
      write: (data, callback) => {
        const followsOutput = shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })
        xterm.write(data, () => {
          if (followsOutput) xterm.scrollToBottom()
          else setHasUnreadOutput(true)
          callback()
        })
      },
      ready: (message) => terminalBridge.shellSessions.ready(sessionId, message),
      ack: (message) => terminalBridge.shellSessions.ack(sessionId, message),
      onWriteError: (error) => {
        if (outputErrorReported) return
        outputErrorReported = true
        setTerminalFailure({
          error: reportTerminalFailure(error, 'render-output', 'Output del terminale sospeso', 'La shell è ancora attiva. Recupera lo storico per continuare a vedere l’output.'),
          recovery: 'resume',
        })
      },
      onWriteTimeout: () => {
        if (automaticOutputRecoveryUsed) {
          if (!outputErrorReported) {
            setTerminalFailure({
              error: reportTerminalFailure(new Error('Terminal renderer recovery timeout'), 'render-output-timeout', 'Output del terminale sospeso', 'Il recupero automatico non è riuscito. Riavvia la shell; lo storico disponibile verrà mantenuto.'),
              recovery: 'restart',
            })
          }
          outputErrorReported = true
          return
        }
        automaticOutputRecoveryUsed = true
        void synchronizeOutput.current?.(true).catch((error) => {
          setTerminalFailure({
            error: reportTerminalFailure(error, 'resume-output', 'Storico del terminale non recuperato', 'La sessione è rimasta attiva. Riprova il recupero oppure riavvia la shell.'),
            recovery: 'resume',
          })
        })
      },
      onRendered: () => { automaticOutputRecoveryUsed = false },
    })
    const renderSnapshot = (snapshot: ShellSessionResumeSnapshot, reset: boolean) => {
      const resetSequence = reset ? '\x1bc' : ''
      const notice = snapshot.truncated
        ? `\r\n\x1b[33m[VincodeLab: storico precedente limitato; rimossi ${(snapshot.droppedBytes / (1024 * 1024)).toFixed(1)} MiB]\x1b[0m\r\n`
        : ''
      return `${resetSequence}${notice}${snapshot.blocks.map((block) => block.data).join('')}`
    }
    const resume = async (reset = false) => {
      const request = ++synchronizationRequest
      const snapshot = await terminalBridge.shellSessions.resume(sessionId)
      if (disposed || request !== synchronizationRequest) {
        terminalBridge.shellSessions.disconnect(sessionId, { attachmentId: snapshot.attachmentId, generation: snapshot.generation })
        return
      }
      if (reset) setHasUnreadOutput(false)
      outputErrorReported = false
      if (!outputController.restore(snapshot, renderSnapshot(snapshot, reset))) {
        terminalBridge.shellSessions.disconnect(sessionId, { attachmentId: snapshot.attachmentId, generation: snapshot.generation })
        return
      }
      setTerminalFailure((current) => current?.recovery === 'resume' ? null : current)
      if (snapshot.status === 'exited') {
        const normalExit = snapshot.exitStatus?.exitCode === 0
        updateStatus(normalExit ? 'exited' : 'error')
        if (!normalExit) {
          setTerminalFailure({
            error: reportTerminalFailure(new Error(`Shell exit code ${snapshot.exitStatus?.exitCode ?? 'unknown'}`), 'session-exit', 'Shell terminata in modo inatteso', 'Lo storico è rimasto disponibile. Riavvia la shell per continuare.'),
            recovery: 'restart',
          })
        }
      } else if (statusRef.current === 'starting') updateStatus('ready')
    }
    const input = xterm.onData((data) => {
      if (statusRef.current === 'ready') terminalBridge.shellSessions.write(sessionId, data)
    })
    const scroll = xterm.onScroll(() => setHasUnreadOutput(!shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })))
    const unsubscribeData = terminalBridge.shellSessions.onData((event) => {
      if (event.sessionId !== sessionId) return
      outputController.accept(event)
    })
    const unsubscribeExit = terminalBridge.shellSessions.onExit((event) => {
      if (event.sessionId !== sessionId) return
      const normalExit = event.exitCode === 0 || event.reason === 'closed'
      updateStatus(normalExit ? 'exited' : 'error')
      if (!normalExit) {
        setTerminalFailure({
          error: reportTerminalFailure(new Error(`Shell exit code ${event.exitCode ?? 'unknown'} reason ${event.reason}`), 'session-exit', 'Shell terminata in modo inatteso', 'Lo storico è rimasto disponibile. Riavvia la shell per continuare.'),
          recovery: 'restart',
        })
      }
    })
    const unsubscribeError = terminalBridge.shellSessions.onError((event) => {
      if (event.sessionId !== sessionId) return
      setTerminalFailure(terminalFailureFromEvent(event))
    })
    publishSynchronizeOutput(resume)
    void resume().catch((error) => {
      setTerminalFailure({
        error: reportTerminalFailure(error, 'resume-output', 'Storico del terminale non recuperato', 'La sessione è rimasta disponibile. Riprova il recupero.'),
        recovery: 'resume',
      })
    })

    return () => {
      disposed = true
      synchronizationRequest += 1
      input.dispose()
      scroll.dispose()
      unsubscribeData()
      unsubscribeExit()
      unsubscribeError()
      resizeScheduler.cancel()
      const outputConnection = outputController.currentConnection()
      outputController.dispose()
      if (outputConnection) terminalBridge.shellSessions.disconnect(sessionId, outputConnection)
      resizeObserver.disconnect()
      publishRefitTerminal(null)
      publishSynchronizeOutput(null)
      publishSearchAddon(null)
      xterm.dispose()
      publishTerminal(null)
    }
  }, [container, fontSizeRef, isActiveRef, publishRefitTerminal, publishSearchAddon, publishSynchronizeOutput, publishTerminal, sessionId, setHasUnreadOutput, setTerminalFailure, statusRef, synchronizeOutput, terminalPreferences, updateStatus])

  useEffect(() => observeXtermTheme((theme) => {
    // La shell rimane attiva: aggiornare il canvas evita di interrompere il PTY.
    if (terminal.current) terminal.current.options.theme = theme
  }), [terminal])
}
