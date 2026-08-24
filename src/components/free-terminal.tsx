import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import { ChevronDown, ChevronRight, ChevronUp, PanelRightOpen, Pencil, Play, Plus, RefreshCw, TerminalSquare, Trash2, X } from 'lucide-react'
import { Button, Collapsible, Dialog, ErrorNotice, Field, IconButton, SegmentGroup, SelectField, Spinner, Splitter, toast, type SplitterPanelData, type ToastAction } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { TerminalToolbar } from '@/components/terminal-toolbar'
import { terminalBridge } from '@/features/terminal'
import { scheduleVisibleTerminalRefit } from '@/lib/terminal-activation.js'
import { createAnimationFrameResizeScheduler } from '@/lib/terminal-resize.js'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '@/lib/terminal-preferences.js'
import { shouldFollowTerminalOutput } from '@/lib/terminal-viewport.js'
import { observeXtermTheme, readXtermTheme } from '@/lib/xterm-theme'
import { effectivePreference, terminalFontFamily, useAppPreferences } from '@/lib/app-preferences'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { createShellXtermOutputController } from '@/lib/shell-xterm-output-controller'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'
import { workspaceCommandLibraryView } from '@/lib/workspace-command-library.js'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { terminalStyles } from '@/theme/styles/terminal'

const workspaceCommandPanels: SplitterPanelData[] = [
  { id: 'terminal-space', minSize: '420px' },
  { id: 'workspace-commands', minSize: '300px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
]

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

export type TerminalSessionUiStatus = 'starting' | 'ready' | 'exited' | 'error'

type TerminalFailure = {
  error: UserError
  recovery: ShellSessionErrorRecovery
}

type TerminalPreferenceFailure = {
  error: UserError
  recovery: 'load' | 'save'
}

function reportTerminalFailure(error: unknown, operation: string, title: string, description: string, category: 'process' | 'persistence' | 'remote' = 'process') {
  return reportUserError(normalizeUserError(error, {
    category,
    component: 'terminal',
    operation,
    title,
    fallbackDescription: description,
  }))
}

function reportTerminalPreferenceFailure(error: unknown, recovery: TerminalPreferenceFailure['recovery']) {
  return reportTerminalFailure(
    error,
    recovery === 'load' ? 'load-terminal-preferences' : 'save-terminal-preferences',
    recovery === 'load' ? 'Preferenze del terminale non caricate' : 'Preferenze del terminale non salvate',
    recovery === 'load'
      ? 'È stata applicata la dimensione predefinita. La sessione e l’output sono rimasti disponibili.'
      : 'La nuova dimensione resta attiva in questa sessione, ma potrebbe non essere ripristinata alla prossima apertura.',
    'persistence',
  )
}

const shellSessionErrorCopy: Record<ShellSessionOneWayOperation, { title: string; fallbackDescription: string }> = {
  ready: { title: 'Output del terminale non collegato', fallbackDescription: 'Recupera lo storico per riallineare la sessione.' },
  ack: { title: 'Output del terminale non confermato', fallbackDescription: 'Recupera lo storico per continuare a ricevere l’output.' },
  disconnect: { title: 'Output del terminale non scollegato', fallbackDescription: 'Riapri la sessione per riallineare il collegamento.' },
  write: { title: 'Testo non inviato', fallbackDescription: 'La sessione e lo storico sono rimasti disponibili. Riavvia la shell se non risponde.' },
  resize: { title: 'Terminale non ridimensionato', fallbackDescription: 'La sessione è rimasta attiva. Adatta nuovamente il terminale.' },
}

function terminalFailureFromEvent(event: ShellSessionErrorEvent): TerminalFailure {
  const copy = shellSessionErrorCopy[event.operation]
  return {
    error: normalizeUserError(event.error, {
      category: event.error.category,
      code: event.error.code,
      component: 'terminal',
      correlationId: event.error.correlationId,
      fallbackDescription: copy.fallbackDescription,
      operation: event.operation,
      recoverable: event.error.recoverable,
      severity: event.error.severity,
      title: copy.title,
    }),
    recovery: event.recovery,
  }
}

function sessionUiStatus(status: ShellSessionStatus | undefined): TerminalSessionUiStatus {
  if (status === 'starting') return 'starting'
  if (status === 'exited') return 'exited'
  return 'ready'
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
  const managedConnectionId = useRef<string | null>(null)
  const managedConnectionCommandId = useRef<string | null>(null)
  const synchronizeOutput = useRef<((reset?: boolean) => Promise<void>) | null>(null)
  const statusListener = useRef(onStatusChange)
  const [status, setStatus] = useState<TerminalSessionUiStatus>(() => sessionUiStatus(initialStatus))
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
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [categories, setCategories] = useState<WorkspaceCommandCategory[]>([])
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set())
  const [commandsLoading, setCommandsLoading] = useState(false)
  const [commandsLoadError, setCommandsLoadError] = useState<UserError | null>(null)
  const [terminalFailure, setTerminalFailure] = useState<TerminalFailure | null>(null)
  const [terminalPreferenceFailure, setTerminalPreferenceFailure] = useState<TerminalPreferenceFailure | null>(initialTerminalPreferenceFailure)
  const [sshFailure, setSshFailure] = useState<UserError | null>(null)
  const [clipboardFailure, setClipboardFailure] = useState<{ action: 'copy' | 'paste'; error: UserError } | null>(null)
  const [commandSearch, setCommandSearch] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [commandTitle, setCommandTitle] = useState('')
  const [commandKind, setCommandKind] = useState<WorkspaceCommandKind>('shell')
  const [commandText, setCommandText] = useState('')
  const [commandNote, setCommandNote] = useState('')
  const [sshDestination, setSshDestination] = useState('')
  const [remoteRoot, setRemoteRoot] = useState('')
  const [commandCategoryId, setCommandCategoryId] = useState('')
  const [commandFormOpen, setCommandFormOpen] = useState(false)
  const [editingCommandId, setEditingCommandId] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<{ id: string; name: string } | null>(null)
  const [commandsBusy, setCommandsBusy] = useState(false)
  const [sshLaunchState, setSshLaunchState] = useState<ManagedSshConnection | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const commandLibraryView = useMemo(() => workspaceCommandLibraryView(categories, commandSearch), [categories, commandSearch])
  const autoExpandedCategoryIds = useMemo(() => new Set(commandLibraryView.autoExpandedIds), [commandLibraryView.autoExpandedIds])
  const statusLabel = status === 'starting' ? 'Avvio shell…' : status === 'ready' ? 'Shell pronta' : status === 'exited' ? 'Shell terminata' : 'Shell non disponibile'

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

  const restart = async () => {
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

  const loadCommands = useCallback(async () => {
    setCommandsLoading(true)
    setCommandsLoadError(null)
    try {
      const result = await terminalBridge.workspaceCommands.list()
      setCategories(result.categories)
      setCommandCategoryId((current) => current || result.categories[0]?.id || '')
      return result
    } catch (error) {
      setCommandsLoadError(reportTerminalFailure(
        error,
        'load-workspace-commands',
        'Comandi del workspace non caricati',
        'La shell resta utilizzabile. Riprova a caricare la libreria dei comandi.',
        'persistence',
      ))
      throw error
    } finally {
      setCommandsLoading(false)
    }
  }, [])

  const expandCategory = useCallback((categoryId: string) => {
    setExpandedCategoryIds((current) => new Set(current).add(categoryId))
  }, [])

  const setCategoryExpanded = (categoryId: string, open: boolean) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current)
      if (open) next.add(categoryId)
      else next.delete(categoryId)
      return next
    })
  }

  const closeCommands = () => {
    setCommandsOpen(false)
    requestAnimationFrame(() => commandsTrigger.current?.focus())
  }

  const handleCommandsOpenChange = ({ open }: { open: boolean }) => {
    if (!open) {
      closeCommands()
      return
    }
    setCommandsOpen(true)
    void loadCommands().catch(() => {
      // `loadCommands` registra l'incidente e il callout della libreria ne è l'unico owner visivo.
    })
  }

  const showCommandFailure = (error: unknown, operation: string, title: string, description: string, recoveryAction?: ToastAction) => {
    const incident = reportTerminalFailure(error, operation, title, description, 'persistence')
    toast.error(incident.title, {
      description: `${incident.description} Riferimento ${incident.correlationId}.`,
      dedupeKey: operation,
      recoveryAction,
    })
  }

  const refreshCommandsRecoveryAction: ToastAction = {
    label: 'Aggiorna elenco',
    onClick: () => {
      void loadCommands().catch(() => {
        // Il retry passa al callout locale della libreria senza aprire un secondo toast.
      })
    },
  }

  const refreshCommandsOwned = async () => {
    try {
      await loadCommands()
    } catch {
      // La mutazione precedente è già conclusa: `loadCommands` registra il refresh e aggiorna l'ErrorNotice locale.
    }
  }

  const createCategory = async () => {
    if (!categoryName.trim()) return
    setCommandsBusy(true)
    try {
      const category = await terminalBridge.workspaceCommands.createCategory(categoryName)
      setCategoryName('')
      expandCategory(category.id)
      await refreshCommandsOwned()
    } catch (error) {
      showCommandFailure(error, 'create-command-category', 'Categoria non creata', 'I comandi esistenti non sono stati modificati. Riprova.', refreshCommandsRecoveryAction)
    } finally { setCommandsBusy(false) }
  }

  const resetCommandForm = () => {
    setCommandTitle('')
    setCommandKind('shell')
    setCommandText('')
    setCommandNote('')
    setSshDestination('')
    setRemoteRoot('')
    setEditingCommandId(null)
    setCommandFormOpen(false)
  }

  const openNewCommand = useCallback((kind: WorkspaceCommandKind) => {
    setCommandTitle('')
    setCommandKind(kind)
    setCommandText('')
    setCommandNote('')
    setSshDestination('')
    setRemoteRoot('')
    setEditingCommandId(null)
    setCommandsOpen(true)
    setCommandFormOpen(true)
    void loadCommands().catch(() => {
      // Il form resta aperto e il callout della libreria offre il retry locale.
    })
  }, [loadCommands])

  useEffect(() => {
    if (profileComposerRequest <= 0) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) openNewCommand('ssh') })
    return () => { cancelled = true }
  }, [openNewCommand, profileComposerRequest])

  const commandFormValid = Boolean(commandCategoryId && commandTitle.trim() && (
    commandKind === 'shell' ? commandText.trim() : sshDestination.trim() && remoteRoot.trim()
  ))

  const saveCommand = async () => {
    if (!commandFormValid) return
    setCommandsBusy(true)
    try {
      const input: WorkspaceCommandInput = {
        categoryId: commandCategoryId,
        title: commandTitle,
        kind: commandKind,
        command: commandKind === 'shell' ? commandText : '',
        note: commandNote,
        sshDestination: commandKind === 'ssh' ? sshDestination : '',
        remoteRoot: commandKind === 'ssh' ? remoteRoot : '',
      }
      if (editingCommandId) await terminalBridge.workspaceCommands.update(editingCommandId, input)
      else await terminalBridge.workspaceCommands.create(input)
      expandCategory(commandCategoryId)
      resetCommandForm()
      await refreshCommandsOwned()
    } catch (error) {
      showCommandFailure(error, editingCommandId ? 'update-workspace-command' : 'create-workspace-command', 'Comando non salvato', 'Il form è rimasto aperto con i dati inseriti. Correggi il problema e riprova.', refreshCommandsRecoveryAction)
    } finally { setCommandsBusy(false) }
  }

  const startEditCommand = (command: WorkspaceCommand) => {
    setEditingCommandId(command.id)
    setCommandCategoryId(command.categoryId)
    setCommandTitle(command.title)
    setCommandKind(command.kind)
    setCommandText(command.command)
    setCommandNote(command.note)
    setSshDestination(command.sshDestination)
    setRemoteRoot(command.remoteRoot)
    expandCategory(command.categoryId)
    setCommandFormOpen(true)
  }

  const moveCommand = async (command: WorkspaceCommand, categoryId: string): Promise<void> => {
    if (categoryId === command.categoryId) return
    setCommandsBusy(true)
    try {
      await terminalBridge.workspaceCommands.move(command.id, categoryId)
      expandCategory(categoryId)
      await refreshCommandsOwned()
    } catch (error) {
      showCommandFailure(error, 'move-workspace-command', 'Comando non spostato', 'Il comando è rimasto nella categoria precedente. Riprova.', {
        label: 'Riprova',
        onClick: () => { void moveCommand(command, categoryId) },
      })
    } finally { setCommandsBusy(false) }
  }

  const deleteCommand = (command: WorkspaceCommand): void => setConfirmation({
    title: `Elimina “${command.title}”`, detail: 'Il comando verrà eliminato solo dalla libreria di questo workspace.', confirmLabel: 'Elimina comando', destructive: true,
    onConfirm: () => void (async () => {
      setCommandsBusy(true)
      try {
        await terminalBridge.workspaceCommands.delete(command.id)
        await refreshCommandsOwned()
      } catch (error) {
        showCommandFailure(error, 'delete-workspace-command', 'Comando non eliminato', 'Il comando è rimasto nella libreria. Riprova.', {
          label: 'Riapri conferma',
          onClick: () => deleteCommand(command),
        })
      } finally { setCommandsBusy(false) }
    })(),
  })

  const saveCategory = async (category = editingCategory): Promise<void> => {
    if (!category?.name.trim()) return
    setCommandsBusy(true)
    try {
      await terminalBridge.workspaceCommands.updateCategory(category.id, category.name)
      setEditingCategory(null)
      await refreshCommandsOwned()
    } catch (error) {
      showCommandFailure(error, 'rename-command-category', 'Categoria non rinominata', 'Il nome precedente è rimasto invariato. Riprova.', {
        label: 'Riprova',
        onClick: () => { void saveCategory(category) },
      })
    } finally { setCommandsBusy(false) }
  }

  const deleteCategory = (category: WorkspaceCommandCategory): void => setConfirmation({
    title: `Elimina categoria “${category.name}”`, detail: `Saranno eliminati anche i ${category.commands.length} comandi contenuti in questa categoria.`, confirmLabel: 'Elimina categoria', destructive: true,
    onConfirm: () => void (async () => {
      setCommandsBusy(true)
      try {
        await terminalBridge.workspaceCommands.deleteCategory(category.id)
        await refreshCommandsOwned()
      } catch (error) {
        showCommandFailure(error, 'delete-command-category', 'Categoria non eliminata', 'La categoria e i suoi comandi sono rimasti disponibili. Riprova.', {
          label: 'Riapri conferma',
          onClick: () => deleteCategory(category),
        })
      } finally { setCommandsBusy(false) }
    })(),
  })

  const requestRun = (command: WorkspaceCommand): void => {
    const detail = command.kind === 'ssh' ? `ssh ${command.sshDestination}\nCartella iniziale: ${command.remoteRoot}` : command.command
    setConfirmation({ title: `Esegui “${command.title}”`, detail, confirmLabel: command.kind === 'ssh' ? 'Connetti' : 'Esegui nel terminale', onConfirm: () => void runCommand(command.id) })
  }

  const runCommand = async (commandId: string): Promise<void> => {
    setCommandsBusy(true)
    try {
      managedConnectionCommandId.current = commandId
      await terminalBridge.shellSessions.focus(sessionId)
      const result = await terminalBridge.workspaceCommands.run(commandId)
      if (result.managedConnectionId) {
        managedConnectionId.current = result.managedConnectionId
        const connection = (await terminalBridge.managedSsh.list()).find((item) => item.id === result.managedConnectionId) ?? null
        setSshLaunchState(connection)
        setSshFailure(null)
        onManagedConnection(result.managedConnectionId)
      } else {
        toast.success('Comando inviato al terminale.')
      }
    } catch (error) {
      const incident = reportTerminalFailure(error, 'run-workspace-command', 'Comando non eseguito', 'La shell è rimasta attiva e il comando non è stato reinviato. Riprova quando sei pronto.')
      const command = categories.flatMap((category) => category.commands).find((candidate) => candidate.id === commandId)
      toast.error(incident.title, {
        description: `${incident.description} Riferimento ${incident.correlationId}.`,
        dedupeKey: incident.operation,
        recoveryAction: command ? { label: 'Riapri conferma', onClick: () => requestRun(command) } : undefined,
      })
    } finally { setCommandsBusy(false) }
  }

  useEffect(() => terminalBridge.managedSsh.onStatus((connection) => {
    if (managedConnectionId.current !== connection.id) return
    setSshLaunchState(connection)
    if (connection.state === 'connected') setSshFailure(null)
    if (connection.state === 'error') {
      setSshFailure(reportTerminalFailure(
        connection.error ? new Error(connection.error) : new Error('Managed SSH connection failed'),
        'connect-ssh-profile',
        'Connessione SSH non disponibile',
        'La shell e il profilo sono rimasti disponibili. Verifica rete o credenziali e riprova.',
        'remote',
      ))
    }
  }), [])

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
    terminal.current = xterm
    searchAddon.current = nextSearchAddon

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
    refitTerminal.current = fit
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
    synchronizeOutput.current = resume
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
      refitTerminal.current = null
      if (synchronizeOutput.current === resume) synchronizeOutput.current = null
      searchAddon.current = null
      xterm.dispose()
      terminal.current = null
    }
  }, [sessionId, updateStatus])

  useEffect(() => {
    return observeXtermTheme((theme) => {
      // La shell rimane attiva: aggiornare il canvas evita di interrompere il PTY.
      if (terminal.current) terminal.current.options.theme = theme
    })
  }, [])

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

  const copySelection = async () => {
    const selection = terminal.current?.getSelection() ?? ''
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection)
      setClipboardFailure(null)
    } catch (cause) {
      setClipboardFailure({
        action: 'copy',
        error: reportUserError(normalizeUserError(cause, {
          category: 'permission',
          component: 'terminal',
          operation: 'copy-selection',
          title: 'Selezione non copiata',
          description: 'Gli appunti non sono accessibili. La selezione resta disponibile nel terminale.',
        })),
      })
    }
  }
  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && statusRef.current === 'ready') terminalBridge.shellSessions.write(sessionId, text)
      setClipboardFailure(null)
      terminal.current?.focus()
    } catch (cause) {
      setClipboardFailure({
        action: 'paste',
        error: reportUserError(normalizeUserError(cause, {
          category: 'permission',
          component: 'terminal',
          operation: 'paste',
          title: 'Testo non incollato',
          description: 'Gli appunti non sono accessibili. La sessione del terminale è rimasta attiva.',
        })),
      })
    }
  }, [sessionId])
  const retryTerminalResize = () => {
    const currentTerminal = terminal.current
    if (!currentTerminal) throw new Error('Terminale non disponibile per il ridimensionamento')
    setTerminalFailure(null)
    terminalBridge.shellSessions.resize(sessionId, { cols: currentTerminal.cols, rows: currentTerminal.rows })
    currentTerminal.focus()
  }
  const recoverTerminalFailure = async () => {
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
  const retrySshConnection = async () => {
    const commandId = managedConnectionCommandId.current
    if (!commandId) throw new Error('Profilo SSH non più disponibile')
    await runCommand(commandId)
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
    open={commandsOpen}
    preventScroll={false}
    trapFocus={false}
    onOpenChange={handleCommandsOpenChange}
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
      <Splitter.Root aria-label="Comandi del workspace" className={terminalStyles.commandSplitter} defaultFixedSize={commandsWidth} fixedPanel="end" hidden={!commandsOpen} panels={workspaceCommandPanels} storageKey={`vincodelab.terminal.commands-width:${workspace}`}>
        <Splitter.Panel aria-hidden="true" className={terminalStyles.commandSpace} id="terminal-space" />
        <Splitter.ResizeTrigger aria-label="Ridimensiona comandi workspace" className={terminalStyles.commandResize} id="terminal-space:workspace-commands" title="Trascina per ridimensionare i comandi. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
        <Splitter.Panel id="workspace-commands"><Dialog.Content asChild unstyled><aside className={terminalStyles.commandSidebar} aria-label="Comandi del workspace">
        <header className={terminalStyles.commandHeader}><strong>Comandi workspace</strong><div className={terminalStyles.commandHeaderActions}><Button size="sm" onClick={() => openNewCommand('shell')}><Plus size={14} /> Nuovo comando</Button><IconButton tooltip="Chiudi comandi workspace" onClick={closeCommands}><X size={15} /></IconButton></div></header>
        <Field.Root><Field.Input ref={commandSearchInput} aria-label="Cerca comandi" placeholder="Cerca comandi" value={commandSearch} onChange={(event) => setCommandSearch(event.target.value)} /></Field.Root>
        <Collapsible.Root className={terminalStyles.commandCreate}><Collapsible.Trigger><Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator>Nuova categoria</Collapsible.Trigger><Collapsible.Content><Field.Root className={terminalStyles.categoryCreateField}><Field.Input aria-label="Nome categoria" placeholder="Nome categoria" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /><Button size="sm" variant="outline" disabled={commandsBusy || !categoryName.trim()} onClick={() => void createCategory()}><Plus size={14} /> Crea</Button></Field.Root></Collapsible.Content></Collapsible.Root>
        {commandFormOpen && <div className={terminalStyles.commandForm}>
          <div className={terminalStyles.commandFormTop}><SelectField aria-label="Categoria comando" options={categories.map((category) => ({ value: category.id, label: category.name }))} value={commandCategoryId} placeholder="Scegli categoria" onValueChange={setCommandCategoryId} /><Field.Root><Field.Input aria-label="Titolo comando" placeholder="Titolo comando" value={commandTitle} onChange={(event) => setCommandTitle(event.target.value)} /></Field.Root></div>
          <SegmentGroup.Root className={terminalStyles.commandKind} aria-label="Tipo comando" orientation="horizontal" value={commandKind} onValueChange={({ value }) => { if (value) setCommandKind(value as WorkspaceCommandKind) }}><SegmentGroup.Indicator />{([{ value: 'shell', label: 'Comando libero' }, { value: 'ssh', label: 'Connessione SSH' }] as const).map((item) => <SegmentGroup.Item key={item.value} value={item.value}><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText></SegmentGroup.Item>)}</SegmentGroup.Root>
          {commandKind === 'shell' ? <Field.Root><Field.Textarea aria-label="Testo comando" placeholder="npm run build" value={commandText} onChange={(event) => setCommandText(event.target.value)} /></Field.Root> : <div className={terminalStyles.sshFields}>
            <Field.Root><Field.Input aria-label="Destinazione SSH" autoCapitalize="none" autoCorrect="off" placeholder="alias in ~/.ssh/config oppure utente@server" spellCheck={false} value={sshDestination} onChange={(event) => setSshDestination(event.target.value)} /></Field.Root>
            <Field.Root><Field.Input aria-label="Cartella remota iniziale" autoCapitalize="none" autoCorrect="off" placeholder="/srv/app oppure ~/progetto" spellCheck={false} value={remoteRoot} onChange={(event) => setRemoteRoot(event.target.value)} /></Field.Root>
            <code className={terminalStyles.sshPreview} aria-label="Comando SSH generato">ssh {sshDestination || 'destinazione'} · {remoteRoot || 'cartella remota'}</code>
          </div>}
          <Field.Root><Field.Input aria-label="Nota comando" placeholder="Nota opzionale" value={commandNote} onChange={(event) => setCommandNote(event.target.value)} /></Field.Root>
          <div className={terminalStyles.commandFormActions}><Button size="sm" disabled={commandsBusy || !commandFormValid} onClick={() => void saveCommand()}>{editingCommandId ? 'Aggiorna comando' : 'Salva comando'}</Button><Button size="sm" type="button" variant="outline" onClick={resetCommandForm}>Annulla</Button></div>
        </div>}
        {sshLaunchState && <div className={`${terminalStyles.sshState} ${sshLaunchState.state === 'connected' ? terminalStyles.sshStateConnected : sshLaunchState.state === 'error' ? terminalStyles.sshStateError : ''}`} role="status"><span>{sshLaunchState.state === 'connecting' ? 'Connessione SSH in corso…' : sshLaunchState.state === 'connected' ? 'Connessione SSH attiva' : sshLaunchState.state === 'error' ? 'Connessione SSH non disponibile' : 'Connessione SSH terminata'}</span><small>{sshLaunchState.title}</small></div>}
        {sshFailure && <ErrorNotice action={{ label: 'Riconnetti', onClick: retrySshConnection }} error={sshFailure} />}
        {commandsLoading && <div className={terminalStyles.commandFeedback} role="status"><Spinner size={14} /> Caricamento categorie…</div>}
        {commandsLoadError && <ErrorNotice
          action={{ label: 'Riprova', onClick: async () => { try { await loadCommands() } catch { /* Lo stesso callout viene aggiornato dal nuovo incidente. */ } } }}
          error={commandsLoadError}
        />}
        {!commandsLoading && !commandsLoadError && commandLibraryView.categories.length === 0 && <div className={terminalStyles.commandFeedback} role="status">{commandSearch.trim() ? 'Nessun comando corrisponde alla ricerca.' : 'Nessuna categoria in questo workspace.'}</div>}
        <div className={terminalStyles.commandList}>{commandLibraryView.categories.map((category) => {
          const commands = category.commands
          const categoryExpanded = expandedCategoryIds.has(category.id) || autoExpandedCategoryIds.has(category.id)
          return <Collapsible.Root asChild key={category.id} open={categoryExpanded} onOpenChange={({ open }) => setCategoryExpanded(category.id, open)}><section className={terminalStyles.commandCategory}>
            <h3 className={terminalStyles.commandCategoryHeader}>{editingCategory?.id === category.id ? <Field.Root className={terminalStyles.categoryEdit}><Field.Input aria-label={`Rinomina ${category.name}`} value={editingCategory.name} onChange={(event) => setEditingCategory({ ...editingCategory, name: event.target.value })} /><Button size="xs" variant="subtle" aria-label={`Salva ${category.name}`} onClick={() => void saveCategory()}>Salva</Button></Field.Root> : <Collapsible.Trigger className={terminalStyles.categoryToggle}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={14} /></Collapsible.Indicator><span className={terminalStyles.categoryLabel}>{category.name}</span><small className={terminalStyles.categoryCount}>{commands.length}</small></Collapsible.Trigger>}<span className={terminalStyles.categoryActions}><IconButton size="icon-xs" tooltip={`Rinomina ${category.name}`} onClick={() => { expandCategory(category.id); setEditingCategory({ id: category.id, name: category.name }) }}><Pencil size={12} /></IconButton><IconButton size="icon-xs" tooltip={`Elimina ${category.name}`} onClick={() => deleteCategory(category)}><Trash2 size={12} /></IconButton></span></h3>
            <Collapsible.Content>{commands.map((command) => <article className={terminalStyles.commandArticle} key={command.id}><div className={terminalStyles.commandCopy}><strong>{command.title}</strong><code>{command.kind === 'ssh' ? `ssh ${command.sshDestination} · ${command.remoteRoot}` : command.command}</code>{command.note && <small>{command.note}</small>}<SelectField aria-label={`Sposta ${command.title}`} options={categories.map((candidate) => ({ value: candidate.id, label: `Sposta in: ${candidate.name}` }))} value={command.categoryId} disabled={commandsBusy} onValueChange={(value) => void moveCommand(command, value)} /></div><div className={terminalStyles.commandActions}><Button size="sm" disabled={commandsBusy || status !== 'ready'} onClick={() => requestRun(command)}><Play size={13} /> {command.kind === 'ssh' ? 'Connetti' : 'Esegui'}</Button><IconButton tooltip={`Modifica ${command.title}`} onClick={() => startEditCommand(command)}><Pencil size={13} /></IconButton><IconButton tooltip={`Elimina ${command.title}`} onClick={() => deleteCommand(command)}><Trash2 size={13} /></IconButton></div></article>)}</Collapsible.Content>
          </section></Collapsible.Root>
        })}</div>
      </aside></Dialog.Content></Splitter.Panel>
      </Splitter.Root>
      {status === 'starting' && <div className={terminalStyles.stage} aria-live="polite"><Spinner size={16} /><span>Avvio shell nel workspace…</span></div>}
      {status === 'exited' && !terminalFailure && <div className={terminalStyles.freeRecovery} role="status"><p>La sessione shell è terminata.</p><Button size="sm" variant="outline" onClick={() => void restart()}><RefreshCw aria-hidden="true" /> Riavvia terminale</Button></div>}
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    </section>
  </Dialog.Root>
}
