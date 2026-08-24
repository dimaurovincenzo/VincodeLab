import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronUp, PanelRightOpen, RefreshCw, TerminalSquare, X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, Field, IconButton, Spinner } from '@/components/ui'
import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { TerminalToolbar } from '@/components/terminal-toolbar'
import { terminalBridge } from '../api/terminal.bridge'
import {
  terminalSessionStatusLabel,
  terminalSessionUiStatus,
  type TerminalClipboardFailure,
  type TerminalFailure,
  type TerminalPreferenceFailure,
  type TerminalSessionUiStatus,
} from '../model/terminal-session'
import {
  reportTerminalClipboardFailure,
  reportTerminalFailure,
  reportTerminalPreferenceFailure,
} from '../services/terminal-error'
import { useShellXtermLifecycle } from '../hooks/use-shell-xterm-lifecycle'
import { useWorkspaceCommandLibrary } from '../hooks/use-workspace-command-library'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '@/lib/terminal-preferences.js'
import { effectivePreference, terminalFontFamily, useAppPreferences } from '@/lib/app-preferences'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'
import { terminalStyles } from '@/theme/styles/terminal'
import { WorkspaceCommandPanel } from './workspace-command-panel'

export type { TerminalSessionUiStatus } from '../model/terminal-session'

type Props = {
  active: boolean
  workspace: string
  sessionId: string
  initialStatus?: ShellSessionStatus
  focusRequest?: number
  profileComposerRequest: number
  onManagedConnection: (connectionId: string) => void
  onStatusChange?: (sessionId: string, status: TerminalSessionUiStatus) => void
}

export function FreeTerminal({ active, workspace, sessionId, initialStatus = 'running', focusRequest = 0, profileComposerRequest, onManagedConnection, onStatusChange }: Props) {
  const { preferences } = useAppPreferences()
  const preferredFontSize = effectivePreference(preferences, 'terminal.fontSize', 11)
  const preferredFontFamily = effectivePreference(preferences, 'terminal.fontFamily', 'system-mono')
  const preferredCursorStyle = effectivePreference(preferences, 'terminal.cursorStyle', 'bar') as 'bar' | 'block' | 'underline'
  const preferredScrollback = effectivePreference(preferences, 'terminal.scrollback', 10_000)
  const commandsWidth = effectivePreference(preferences, 'terminal.commandsWidth', 400)
  const container = useRef<HTMLDivElement>(null)
  const commandsTrigger = useRef<HTMLButtonElement>(null)
  const commandSearchInput = useRef<HTMLInputElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const searchAddon = useRef<SearchAddon | null>(null)
  const refitTerminal = useRef<(() => void) | null>(null)
  const synchronizeOutput = useRef<((reset?: boolean) => Promise<void>) | null>(null)
  const statusListener = useRef(onStatusChange)
  const [status, setStatus] = useState<TerminalSessionUiStatus>(() => terminalSessionUiStatus(initialStatus))
  const statusRef = useRef(status)
  const isActiveRef = useRef(active)
  const [{ fontSize: initialFontSize, failure: initialTerminalPreferenceFailure }] = useState(() => {
    let failure: TerminalPreferenceFailure | null = null
    const stored = readTerminalPreferences(workspace, {
      onError: (error) => {
        failure = { error: reportTerminalPreferenceFailure(error, 'load'), recovery: 'load' }
      },
    })
    return { failure, fontSize: stored.fontSize }
  })
  const [fontSize, setFontSize] = useState(initialFontSize)
  const fontSizeRef = useRef(fontSize)
  const terminalPreferences = useRef({ preferredCursorStyle, preferredFontFamily, preferredScrollback })
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false)
  const [terminalQuery, setTerminalQuery] = useState('')
  const [hasUnreadOutput, setHasUnreadOutput] = useState(false)
  const [terminalFailure, setTerminalFailure] = useState<TerminalFailure | null>(null)
  const [terminalPreferenceFailure, setTerminalPreferenceFailure] = useState<TerminalPreferenceFailure | null>(initialTerminalPreferenceFailure)
  const [clipboardFailure, setClipboardFailure] = useState<TerminalClipboardFailure | null>(null)
  const commandLibrary = useWorkspaceCommandLibrary({ commandsTrigger, onManagedConnection, profileComposerRequest, sessionId })
  const statusLabel = terminalSessionStatusLabel(status)

  useEffect(() => {
    statusListener.current = onStatusChange
  }, [onStatusChange])

  useEffect(() => {
    isActiveRef.current = active
  }, [active])

  useEffect(() => {
    terminalPreferences.current = { preferredCursorStyle, preferredFontFamily, preferredScrollback }
  }, [preferredCursorStyle, preferredFontFamily, preferredScrollback])

  const updateStatus = useCallback((nextStatus: TerminalSessionUiStatus) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
    statusListener.current?.(sessionId, nextStatus)
  }, [sessionId])
  const publishTerminal = useCallback((next: Terminal | null) => { terminal.current = next }, [])
  const publishSearchAddon = useCallback((next: SearchAddon | null) => { searchAddon.current = next }, [])
  const publishRefitTerminal = useCallback((next: (() => void) | null) => { refitTerminal.current = next }, [])
  const publishSynchronizeOutput = useCallback((next: ((reset?: boolean) => Promise<void>) | null) => { synchronizeOutput.current = next }, [])

  useShellXtermLifecycle({
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
  })

  const persistTerminalFontSize = useCallback((next: number) => {
    const saved = writeTerminalPreferences(workspace, { fontSize: next, followOutput: true }, {
      onError: (error) => setTerminalPreferenceFailure({ error: reportTerminalPreferenceFailure(error, 'save'), recovery: 'save' }),
    })
    if (saved) setTerminalPreferenceFailure(null)
    return saved
  }, [workspace])

  const loadTerminalFontSize = useCallback(() => {
    let failed = false
    const loaded = readTerminalPreferences(workspace, {
      onError: (error) => {
        failed = true
        setTerminalPreferenceFailure({ error: reportTerminalPreferenceFailure(error, 'load'), recovery: 'load' })
      },
    })
    if (failed) return
    fontSizeRef.current = loaded.fontSize
    setFontSize(loaded.fontSize)
    if (terminal.current) terminal.current.options.fontSize = loaded.fontSize
    refitTerminal.current?.()
    setTerminalPreferenceFailure(null)
  }, [workspace])

  const updateFontSize = useCallback((delta: number) => {
    const next = nextTerminalFontSize(fontSizeRef.current, delta)
    fontSizeRef.current = next
    setFontSize(next)
    persistTerminalFontSize(next)
  }, [persistTerminalFontSize])

  const resetFontSize = useCallback(() => {
    fontSizeRef.current = preferredFontSize
    setFontSize(preferredFontSize)
    persistTerminalFontSize(preferredFontSize)
  }, [persistTerminalFontSize, preferredFontSize])

  const recoverTerminalPreferences = useCallback(() => {
    if (terminalPreferenceFailure?.recovery === 'load') loadTerminalFontSize()
    else persistTerminalFontSize(fontSizeRef.current)
  }, [loadTerminalFontSize, persistTerminalFontSize, terminalPreferenceFailure])

  async function restart() {
    const previousStatus = statusRef.current
    updateStatus('starting')
    setHasUnreadOutput(false)
    try {
      await terminalBridge.shellSessions.restart(sessionId)
      await synchronizeOutput.current?.(true)
      refitTerminal.current?.()
      if (terminal.current) terminalBridge.shellSessions.resize(sessionId, { cols: terminal.current.cols, rows: terminal.current.rows })
      terminal.current?.focus()
      updateStatus('ready')
      setTerminalFailure(null)
    } catch (error) {
      updateStatus(previousStatus === 'ready' ? 'ready' : 'error')
      setTerminalFailure({
        error: reportTerminalFailure(error, 'restart-session', 'Shell non riavviata', 'Lo storico e le altre sessioni sono rimasti disponibili. Riprova.'),
        recovery: 'restart',
      })
    }
  }

  useEffect(() => {
    if (!terminal.current) return
    fontSizeRef.current = fontSize
    terminal.current.options.fontSize = fontSize
    refitTerminal.current?.()
  }, [fontSize])

  useEffect(() => {
    queueMicrotask(() => setFontSize(preferredFontSize))
    fontSizeRef.current = preferredFontSize
    if (!terminal.current) return
    terminal.current.options.fontFamily = terminalFontFamily(preferredFontFamily)
    terminal.current.options.cursorStyle = preferredCursorStyle
    terminal.current.options.scrollback = preferredScrollback
    refitTerminal.current?.()
  }, [preferredCursorStyle, preferredFontFamily, preferredFontSize, preferredScrollback])

  useEffect(() => {
    if (!terminalSearchOpen) return
    if (!terminalQuery) {
      searchAddon.current?.clearDecorations()
      return
    }
    searchAddon.current?.findNext(terminalQuery, { incremental: true })
  }, [terminalQuery, terminalSearchOpen])

  async function copySelection() {
    const selection = terminal.current?.getSelection() ?? ''
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection)
      setClipboardFailure(null)
    } catch (cause) {
      setClipboardFailure(reportTerminalClipboardFailure(cause, 'copy'))
    }
  }

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && statusRef.current === 'ready') terminalBridge.shellSessions.write(sessionId, text)
      setClipboardFailure(null)
      terminal.current?.focus()
    } catch (cause) {
      setClipboardFailure(reportTerminalClipboardFailure(cause, 'paste'))
    }
  }, [sessionId])

  function retryTerminalResize() {
    const currentTerminal = terminal.current
    if (!currentTerminal) throw new Error('Terminale non disponibile per il ridimensionamento')
    setTerminalFailure(null)
    terminalBridge.shellSessions.resize(sessionId, { cols: currentTerminal.cols, rows: currentTerminal.rows })
    currentTerminal.focus()
  }

  async function recoverTerminalFailure() {
    if (terminalFailure?.recovery === 'restart') {
      await restart()
      return
    }
    if (terminalFailure?.recovery === 'resize') {
      retryTerminalResize()
      return
    }
    try {
      const synchronize = synchronizeOutput.current
      if (!synchronize) throw new Error('Terminal output synchronization unavailable')
      await synchronize(true)
      setTerminalFailure(null)
      terminal.current?.focus()
    } catch (error) {
      setTerminalFailure({
        error: reportTerminalFailure(error, 'resume-output', 'Storico del terminale non recuperato', 'La sessione è rimasta disponibile. Riprova oppure riavvia la shell.'),
        recovery: 'resume',
      })
    }
  }

  const clearView = () => { terminal.current?.clear(); terminal.current?.focus() }
  const closeTerminalSearch = () => { searchAddon.current?.clearDecorations(); setTerminalQuery(''); setTerminalSearchOpen(false); requestAnimationFrame(() => terminal.current?.focus()) }
  const revealOutput = () => { terminal.current?.scrollToBottom(); setHasUnreadOutput(false) }

  useApplicationMenuCommand('terminal.search', () => { if (active) setTerminalSearchOpen(true) })
  useApplicationMenuCommand('terminal.clear', () => { if (active) clearView() })
  useApplicationMenuCommand('terminal.restart', () => { if (active) void restart() })
  useApplicationMenuCommand('terminal.copy', () => { if (active) void copySelection() })
  useApplicationMenuCommand('terminal.paste', () => { if (active) void paste() })
  useApplicationMenuCommand('terminal.selectAll', () => { if (active) { terminal.current?.selectAll(); terminal.current?.focus() } })
  useApplicationMenuCommand('terminal.zoomIn', () => { if (active) updateFontSize(1) })
  useApplicationMenuCommand('terminal.zoomOut', () => { if (active) updateFontSize(-1) })
  useApplicationMenuCommand('terminal.zoomReset', () => { if (active) resetFontSize() })

  useEffect(() => {
    if (!active) return
    return scheduleVisibleTerminalRefit(() => refitTerminal.current?.())
  }, [active])

  useEffect(() => {
    if (!active || focusRequest <= 0) return
    requestAnimationFrame(() => terminal.current?.focus())
  }, [active, focusRequest])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!active || (!event.metaKey && !event.ctrlKey) || suppressGlobalTerminalShortcut(event.target)) return
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); setTerminalSearchOpen(true); return }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); updateFontSize(1); return }
      if (event.key === '-') { event.preventDefault(); updateFontSize(-1); return }
      if (event.key === '0') { event.preventDefault(); resetFontSize(); return }
      if (event.key.toLowerCase() === 'c' && terminal.current?.hasSelection()) { event.preventDefault(); void copySelection(); return }
      if (event.key.toLowerCase() === 'v') { event.preventDefault(); void paste(); return }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); clearView() }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [active, paste, resetFontSize, updateFontSize])

  return <Dialog.Root
    aria-label="Comandi del workspace"
    closeOnInteractOutside={false}
    finalFocusEl={() => commandsTrigger.current}
    initialFocusEl={() => commandSearchInput.current}
    modal={false}
    open={commandLibrary.state.commandsOpen}
    preventScroll={false}
    trapFocus={false}
    onOpenChange={commandLibrary.actions.handleCommandsOpenChange}
  >
    <section className={terminalStyles.freePage} aria-label="Terminale libero">
      <div className={terminalStyles.freeToolbar}>
        <span className={terminalStyles.freeToolbarTitle}><TerminalSquare aria-hidden="true" size={15} /> Terminale</span>
        <span className={terminalStyles.freeWorkspace} title={workspace}>{workspace}</span>
        {terminalSearchOpen && <Field.Root className={terminalStyles.freeFind}>
          <Field.Input className={terminalStyles.findInput} autoFocus aria-label="Cerca nel terminale libero" onChange={(event) => setTerminalQuery(event.target.value)} placeholder="Cerca nel terminale" value={terminalQuery} />
          <IconButton size="icon-xs" tooltip="Risultato precedente" onClick={() => terminalQuery && searchAddon.current?.findPrevious(terminalQuery)}><ChevronUp aria-hidden="true" size={14} /></IconButton>
          <IconButton size="icon-xs" tooltip="Risultato successivo" onClick={() => terminalQuery && searchAddon.current?.findNext(terminalQuery)}><ChevronDown aria-hidden="true" size={14} /></IconButton>
          <IconButton size="icon-xs" tooltip="Chiudi ricerca" onClick={closeTerminalSearch}><X aria-hidden="true" size={14} /></IconButton>
        </Field.Root>}
        <TerminalToolbar fontSize={fontSize} statusLabel={statusLabel} onClear={clearView} onCopy={() => void copySelection()} onPaste={() => void paste()} onResetZoom={resetFontSize} onRestart={() => void restart()} onSearch={() => setTerminalSearchOpen(true)} onZoom={updateFontSize} />
        <Dialog.Trigger asChild><Button ref={commandsTrigger} aria-label="Apri comandi workspace" size="sm" variant="outline"><PanelRightOpen aria-hidden="true" size={14} /> Comandi</Button></Dialog.Trigger>
      </div>
      {terminalPreferenceFailure && <ErrorNotice
        action={{
          label: terminalPreferenceFailure.recovery === 'load' ? 'Carica di nuovo' : 'Salva di nuovo',
          onClick: recoverTerminalPreferences,
        }}
        error={terminalPreferenceFailure.error}
      />}
      {clipboardFailure && <ErrorNotice
        action={{
          label: clipboardFailure.action === 'copy' ? 'Riprova copia' : 'Riprova incolla',
          onClick: clipboardFailure.action === 'copy' ? copySelection : paste,
        }}
        error={clipboardFailure.error}
      />}
      {terminalFailure && <ErrorNotice
        action={{
          label: terminalFailure.recovery === 'restart' ? 'Riavvia shell' : terminalFailure.recovery === 'resize' ? 'Adatta terminale' : 'Recupera output',
          onClick: recoverTerminalFailure,
        }}
        error={terminalFailure.error}
        secondaryAction={terminalFailure.recovery === 'resume' ? { label: 'Riavvia shell', onClick: restart } : undefined}
      />}
      <div className={terminalStyles.freeSurface} data-xterm-host="shell" ref={container} />
      {hasUnreadOutput && <Button className={terminalStyles.newOutput} size="sm" variant="subtle" onClick={revealOutput}>Nuovo output</Button>}
      <WorkspaceCommandPanel commandSearchInput={commandSearchInput} commandsWidth={commandsWidth} controller={commandLibrary} status={status} workspace={workspace} />
      {status === 'starting' && <div className={terminalStyles.stage} aria-live="polite"><Spinner size={16} /><span>Avvio shell nel workspace…</span></div>}
      {status === 'exited' && !terminalFailure && <div className={terminalStyles.freeRecovery} role="status"><p>La sessione shell è terminata.</p><Button size="sm" variant="outline" onClick={() => void restart()}><RefreshCw aria-hidden="true" /> Riavvia terminale</Button></div>}
      <ConfirmationDialog request={commandLibrary.state.confirmation} onCancel={() => commandLibrary.setters.setConfirmation(null)} />
    </section>
  </Dialog.Root>
}
