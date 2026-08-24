import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  ManagedSshConnection,
  WorkspaceCommand,
  WorkspaceCommandCategory,
  WorkspaceCommandInput,
  WorkspaceCommandKind,
} from '@/bridge'
import { toast, type ToastAction } from '@/components/ui'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import type { UserError } from '@/lib/user-error'
import { terminalBridge } from '../api/terminal.bridge'
import { workspaceCommandLibraryView } from '../model/workspace-command-library.js'
import { reportTerminalFailure } from '../services/terminal-error'

type UseWorkspaceCommandLibraryOptions = {
  commandsTrigger: RefObject<HTMLButtonElement | null>
  onManagedConnection: (connectionId: string) => void
  profileComposerRequest: number
  sessionId: string
}

export function useWorkspaceCommandLibrary({ commandsTrigger, onManagedConnection, profileComposerRequest, sessionId }: UseWorkspaceCommandLibraryOptions) {
  const managedConnectionId = useRef<string | null>(null)
  const managedConnectionCommandId = useRef<string | null>(null)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [categories, setCategories] = useState<WorkspaceCommandCategory[]>([])
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set())
  const [commandsLoading, setCommandsLoading] = useState(false)
  const [commandsLoadError, setCommandsLoadError] = useState<UserError | null>(null)
  const [sshFailure, setSshFailure] = useState<UserError | null>(null)
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

  function setCategoryExpanded(categoryId: string, open: boolean) {
    setExpandedCategoryIds((current) => {
      const next = new Set(current)
      if (open) next.add(categoryId)
      else next.delete(categoryId)
      return next
    })
  }

  function closeCommands() {
    setCommandsOpen(false)
    requestAnimationFrame(() => commandsTrigger.current?.focus())
  }

  function handleCommandsOpenChange({ open }: { open: boolean }) {
    if (!open) {
      closeCommands()
      return
    }
    setCommandsOpen(true)
    void loadCommands().catch(() => {
      // `loadCommands` registra l'incidente e il callout della libreria ne è l'unico owner visivo.
    })
  }

  function showCommandFailure(error: unknown, operation: string, title: string, description: string, recoveryAction?: ToastAction) {
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

  async function refreshCommandsOwned() {
    try {
      await loadCommands()
    } catch {
      // La mutazione precedente è già conclusa: `loadCommands` registra il refresh e aggiorna l'ErrorNotice locale.
    }
  }

  async function createCategory() {
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

  function resetCommandForm() {
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

  async function saveCommand() {
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

  function startEditCommand(command: WorkspaceCommand) {
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

  async function moveCommand(command: WorkspaceCommand, categoryId: string): Promise<void> {
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

  function deleteCommand(command: WorkspaceCommand): void {
    setConfirmation({
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
  }

  async function saveCategory(category = editingCategory): Promise<void> {
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

  function deleteCategory(category: WorkspaceCommandCategory): void {
    setConfirmation({
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
  }

  function requestRun(command: WorkspaceCommand): void {
    const detail = command.kind === 'ssh' ? `ssh ${command.sshDestination}\nCartella iniziale: ${command.remoteRoot}` : command.command
    setConfirmation({ title: `Esegui “${command.title}”`, detail, confirmLabel: command.kind === 'ssh' ? 'Connetti' : 'Esegui nel terminale', onConfirm: () => void runCommand(command.id) })
  }

  async function runCommand(commandId: string): Promise<void> {
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

  async function retrySshConnection() {
    const commandId = managedConnectionCommandId.current
    if (!commandId) throw new Error('Profilo SSH non più disponibile')
    await runCommand(commandId)
  }

  return {
    actions: {
      closeCommands,
      createCategory,
      deleteCategory,
      deleteCommand,
      expandCategory,
      handleCommandsOpenChange,
      loadCommands,
      moveCommand,
      openNewCommand,
      requestRun,
      resetCommandForm,
      retrySshConnection,
      saveCategory,
      saveCommand,
      setCategoryExpanded,
      startEditCommand,
    },
    state: {
      autoExpandedCategoryIds,
      categories,
      categoryName,
      commandCategoryId,
      commandFormOpen,
      commandFormValid,
      commandKind,
      commandLibraryView,
      commandNote,
      commandSearch,
      commandsBusy,
      commandsLoadError,
      commandsLoading,
      commandsOpen,
      commandText,
      commandTitle,
      confirmation,
      editingCategory,
      editingCommandId,
      expandedCategoryIds,
      remoteRoot,
      sshDestination,
      sshFailure,
      sshLaunchState,
    },
    setters: {
      setCategoryName,
      setCommandCategoryId,
      setCommandKind,
      setCommandNote,
      setCommandSearch,
      setCommandText,
      setCommandTitle,
      setConfirmation,
      setEditingCategory,
      setRemoteRoot,
      setSshDestination,
    },
  }
}

export type WorkspaceCommandLibraryController = ReturnType<typeof useWorkspaceCommandLibrary>
