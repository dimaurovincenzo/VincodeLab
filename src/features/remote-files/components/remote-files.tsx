import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, Folder, FolderOpen, FolderPlus, HardDrive, PlugZap, Plus, RefreshCw, Server, Trash2, Upload, X } from 'lucide-react'
import { Icon } from '@iconify/react'
import defaultFileIcon from '@iconify-icons/vscode-icons/default-file'
import defaultFolderIcon from '@iconify-icons/vscode-icons/default-folder'
import { Button, createListCollection, Dialog, ErrorNotice, Field, IconButton, Listbox, SelectField, Spinner, Splitter, Tabs, toast, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { remoteFilesBridge } from '@/features/remote-files/api/remote-files.bridge'
import { createRemoteTransferRetryController } from '@/lib/remote-transfer-retry'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { remoteStyles } from '@/theme/styles/remote'
import { terminalStyles } from '@/theme/styles/terminal'

type Props = {
  active: boolean
  workspace: string
  preferredConnectionId: string | null
  onOpenRemoteFile: (fileId: string) => void
  onCreateSshProfile: () => void
  onConnectProfile: (commandId: string) => Promise<string | null>
}

type DirectoryLocation = { id: string | null; path: string }
type RemoteFilesContextAction = {
  command:
    | 'remote.downloadOpen'
    | 'remote.downloadAs'
    | 'remote.openDirectory'
    | 'remote.copyPath'
    | 'remote.rename'
    | 'remote.delete'
    | 'remoteLocal.open'
    | 'remoteLocal.reveal'
    | 'remoteLocal.copyPath'
    | 'remoteLocal.discard'
    | 'remoteTransfer.cancel'
    | 'remoteTransfer.retry'
  contextId: string
  contextKind: 'remote-file' | 'remote-directory' | 'remote-local-file' | 'remote-transfer'
}

const remoteFilePanels: SplitterPanelData[] = [
  { id: 'remote-connections', minSize: '210px', maxSize: '460px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'remote-files', minSize: '440px' },
]

function formatSize(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function localStateLabel(state: RemoteTrackedFile['localState']) {
  return state === 'synced' ? 'Sincronizzato' : state === 'modified' ? 'Modificato' : state === 'conflict' ? 'Conflitto' : 'Offline'
}

function reportRemoteFailure(error: unknown, operation: string, title: string, description: string, category?: 'filesystem' | 'remote') {
  return reportUserError(normalizeUserError(error, {
    ...(category ? { category } : {}),
    component: 'remote-files',
    operation,
    title,
    fallbackDescription: description,
  }))
}

function showRemoteFailure(
  error: unknown,
  operation: string,
  title: string,
  description: string,
  category?: 'filesystem' | 'remote',
  recoveryAction?: { label: string; onClick: () => void },
) {
  const incident = reportRemoteFailure(error, operation, title, description, category)
  toast.error(incident.title, {
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    dedupeKey: operation,
    recoveryAction,
  })
  return incident
}

export function RemoteFiles({ active, workspace, preferredConnectionId, onOpenRemoteFile, onCreateSshProfile, onConnectProfile }: Props) {
  const [connections, setConnections] = useState<ManagedSshConnection[]>([])
  const [profiles, setProfiles] = useState<WorkspaceCommand[]>([])
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(preferredConnectionId)
  const [locations, setLocations] = useState<DirectoryLocation[]>([{ id: null, path: '' }])
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'server' | 'local'>('server')
  const [localFilter, setLocalFilter] = useState<'all' | RemoteTrackedFile['localState']>('all')
  const [trackedFiles, setTrackedFiles] = useState<RemoteTrackedFile[]>([])
  const [loadingTracked, setLoadingTracked] = useState(false)
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [connectionError, setConnectionError] = useState<UserError | null>(null)
  const [browseError, setBrowseError] = useState<UserError | null>(null)
  const [trackedError, setTrackedError] = useState<UserError | null>(null)
  const [renameError, setRenameError] = useState<UserError | null>(null)
  const [transferError, setTransferError] = useState<{ transferId: string | null; error: UserError } | null>(null)
  const transferErrorRef = useRef<{ transferId: string | null; error: UserError } | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [transfers, setTransfers] = useState<Record<string, RemoteTransfer>>({})
  const [, setRetryRevision] = useState(0)
  const [retryController] = useState(() => createRemoteTransferRetryController(() => setRetryRevision((current) => current + 1)))
  const [createName, setCreateName] = useState('')
  const [renaming, setRenaming] = useState<RemoteEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const renameDialogOpener = useRef<HTMLElement | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)
  const currentLocation = locations.at(-1) ?? { id: null, path: '' }
  const selectedConnection = connections.find((connection) => connection.id === connectionId) ?? null
  const profileCollection = useMemo(() => createListCollection({
    items: profiles,
    isItemDisabled: (profile) => connectingProfileId === profile.id,
    itemToString: (profile) => profile.title,
    itemToValue: (profile) => profile.id,
  }), [connectingProfileId, profiles])

  const publishTransferError = useCallback((next: { transferId: string | null; error: UserError } | null) => {
    transferErrorRef.current = next
    setTransferError(next)
  }, [])

  const publishTransferFallback = useCallback((nextError: unknown, operation: string, title: string, description: string) => {
    const eventOwned = transferErrorRef.current
    if (eventOwned?.transferId && retryController.canRetry(eventOwned.transferId)) return
    publishTransferError({ transferId: null, error: reportRemoteFailure(nextError, operation, title, description) })
  }, [publishTransferError, retryController])

  const loadTracked = useCallback(async () => {
    setLoadingTracked(true)
    setTrackedError(null)
    try {
      setTrackedFiles(await remoteFilesBridge.remoteFiles.listTracked())
    } catch (nextError) {
      setTrackedError(reportRemoteFailure(nextError, 'list-local-copies', 'Copie locali non caricate', 'I file già aperti restano disponibili. Riprova a leggere la cache locale.', 'filesystem'))
    } finally {
      setLoadingTracked(false)
    }
  }, [])

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true)
    setConnectionError(null)
    try {
      const [next, commandLibrary] = await Promise.all([
        remoteFilesBridge.managedSsh.list(),
        remoteFilesBridge.workspaceCommands.list(),
      ])
      setProfiles(commandLibrary.categories.flatMap((category) => category.commands).filter((command) => command.kind === 'ssh'))
      setConnections(next)
      setConnectionError(null)
      setConnectionId((current) => {
        if (preferredConnectionId && next.some((connection) => connection.id === preferredConnectionId)) return preferredConnectionId
        if (current && next.some((connection) => connection.id === current)) return current
        return next.find((connection) => connection.state === 'connected')?.id ?? next[0]?.id ?? null
      })
    } catch (nextError) {
      setConnectionError(reportRemoteFailure(nextError, 'load-connections', 'Profili SSH non disponibili', 'Le copie locali restano accessibili. Riprova a caricare i profili.'))
    } finally {
      setLoadingConnections(false)
    }
  }, [preferredConnectionId])

  const connectSavedProfile = async (profile: WorkspaceCommand) => {
    const existing = connections.find((connection) => connection.commandId === profile.id && connection.state !== 'disconnected')
    if (existing?.state === 'connected') {
      setConnectionId(existing.id)
      return
    }
    setConnectingProfileId(profile.id)
    try {
      const nextConnectionId = await onConnectProfile(profile.id)
      if (nextConnectionId) setConnectionId(nextConnectionId)
      setConnectionError(null)
      toast.info('Completa l’autenticazione SSH nel Terminale.')
    } catch (nextError) {
      setConnectionError(reportRemoteFailure(nextError, 'connect-profile', 'Connessione SSH non avviata', 'Il profilo non è stato modificato. Controlla rete o credenziali e riprova.'))
    } finally {
      setConnectingProfileId(null)
    }
  }

  useEffect(() => {
    if (!active) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void loadConnections() })
    return () => { cancelled = true }
  }, [active, loadConnections, workspace])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void loadTracked() })
    return () => { cancelled = true }
  }, [active, loadTracked, workspace])

  useEffect(() => remoteFilesBridge.managedSsh.onStatus((status) => {
    setConnections((current) => {
      const exists = current.some((connection) => connection.id === status.id)
      return exists ? current.map((connection) => connection.id === status.id ? status : connection) : [...current, status]
    })
    if (status.id !== connectionId) return
    if (status.state === 'connected') setConnectionError(null)
    else if (status.state === 'error') setConnectionError(reportRemoteFailure(
      new Error(status.error ?? 'Managed SSH connection interrupted'),
      'connection-status',
      'Connessione SSH interrotta',
      'La cartella corrente e le copie locali sono rimaste disponibili. Riconnetti il profilo.',
    ))
  }), [connectionId])

  useEffect(() => remoteFilesBridge.remoteFiles.onTransfer((transfer) => {
    retryController.observe(transfer)
    setTransfers((current) => ({ ...current, [transfer.id]: transfer }))
    if (transfer.state === 'error') {
      publishTransferError({
        transferId: transfer.id,
        error: reportRemoteFailure(
          new Error(transfer.error ?? 'Remote transfer interrupted'),
          `${transfer.direction}-transfer`,
          transfer.direction === 'upload' ? 'Caricamento interrotto' : 'Download interrotto',
          `Il trasferimento di “${transfer.name}” non è stato completato. Il file di origine è rimasto invariato.`,
        ),
      })
    } else if (transfer.state === 'completed' || transfer.state === 'cancelled') {
      if (transferErrorRef.current?.transferId === transfer.id) publishTransferError(null)
    }
  }), [publishTransferError, retryController])

  useEffect(() => {
    retryController.reset()
  }, [retryController, workspace])

  useEffect(() => {
    queueMicrotask(() => {
      setLocations([{ id: null, path: '' }])
      setEntries([])
      setBrowseError(null)
    })
  }, [connectionId])

  useEffect(() => {
    let cancelled = false
    if (!active || !connectionId || selectedConnection?.state !== 'connected') {
      queueMicrotask(() => { if (!cancelled) setLoadingEntries(false) })
      return () => { cancelled = true }
    }
    queueMicrotask(() => {
      if (cancelled) return
      setLoadingEntries(true)
      setBrowseError(null)
      void remoteFilesBridge.remoteFiles.browse(connectionId, currentLocation.id).then((result) => {
        if (cancelled) return
        setEntries(result.entries)
        setLocations((current) => current.map((location, index) => index === current.length - 1 ? { ...location, path: result.path } : location))
      }).catch((nextError) => {
        if (!cancelled) setBrowseError(reportRemoteFailure(nextError, 'browse', 'Cartella remota non disponibile', 'La posizione corrente è stata mantenuta. Riprova oppure riconnetti il profilo SSH.'))
      }).finally(() => {
        if (!cancelled) setLoadingEntries(false)
      })
    })
    return () => { cancelled = true }
  }, [active, connectionId, currentLocation.id, refreshToken, selectedConnection?.state])

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    return query ? entries.filter((entry) => entry.name.toLocaleLowerCase('it-IT').includes(query)) : entries
  }, [entries, search])

  const filteredTracked = useMemo(() => localFilter === 'all' ? trackedFiles : trackedFiles.filter((file) => file.localState === localFilter), [localFilter, trackedFiles])
  const trackedSize = useMemo(() => trackedFiles.reduce((total, file) => total + file.cacheSize, 0), [trackedFiles])

  const openEntry = useCallback(async (entry: RemoteEntry) => {
    if (entry.kind === 'directory') {
      setLocations((current) => [...current, { id: entry.id, path: entry.displayPath }])
      return
    }
    if (entry.kind !== 'file') return
    publishTransferError(null)
    await retryController.run({
      direction: 'download',
      name: entry.name,
      execute: async () => {
        try {
          const tracked = await remoteFilesBridge.remoteFiles.downloadAndTrack(entry.id)
          setTrackedFiles((current) => [tracked, ...current.filter((file) => file.id !== tracked.id)])
          onOpenRemoteFile(tracked.id)
          toast.success(`File scaricato: ${entry.name}`)
        } catch (nextError) {
          publishTransferFallback(nextError, 'download-and-open', 'Download interrotto', `“${entry.name}” non è stato aperto. L’eventuale copia precedente è rimasta disponibile.`)
        }
      },
    })
  }, [onOpenRemoteFile, publishTransferError, publishTransferFallback, retryController])

  const downloadAs = useCallback(async (entry: RemoteEntry) => {
    publishTransferError(null)
    await retryController.run({
      direction: 'download',
      name: entry.name,
      execute: async () => {
        try {
          const result = await remoteFilesBridge.remoteFiles.downloadAs(entry.id)
          if (result.saved) toast.success(`File salvato: ${entry.name}`)
        } catch (nextError) {
          publishTransferFallback(nextError, 'download-as', 'Download interrotto', `“${entry.name}” non è stato salvato. Il file remoto è rimasto invariato.`)
        }
      },
    })
  }, [publishTransferError, publishTransferFallback, retryController])

  const requestDelete = useCallback(function requestDelete(entry: RemoteEntry) {
    setConfirmation({
      title: `Elimina “${entry.name}”`,
      detail: 'L’elemento verrà eliminato dal server remoto. Questa azione non può essere annullata da VincodeLab.',
      confirmLabel: 'Elimina dal server',
      destructive: true,
      onConfirm: () => void remoteFilesBridge.remoteFiles.remove(entry.id).then(() => {
        toast.success('Elemento remoto eliminato.')
        setRefreshToken((current) => current + 1)
      }).catch((nextError) => showRemoteFailure(
        nextError,
        'delete-entry',
        'Elemento remoto non eliminato',
        `“${entry.name}” è rimasto sul server. Controlla i permessi e riprova.`,
        undefined,
        { label: 'Riapri conferma', onClick: () => requestDelete(entry) },
      )),
    })
  }, [])

  const copyRemotePath = useCallback(function copyRemotePath(entry: RemoteEntry) {
    void navigator.clipboard.writeText(entry.displayPath).then(() => {
      toast.success('Percorso remoto copiato.')
    }).catch((nextError) => showRemoteFailure(
      nextError,
      'copy-remote-path',
      'Percorso non copiato',
      'Gli appunti non sono accessibili. La selezione remota è rimasta invariata.',
      undefined,
      { label: 'Riprova', onClick: () => copyRemotePath(entry) },
    ))
  }, [])

  const copyTrackedRemotePath = useCallback(function copyTrackedRemotePath(file: RemoteTrackedFile) {
    void navigator.clipboard.writeText(file.remotePath).then(() => {
      toast.success('Percorso remoto copiato.')
    }).catch((nextError) => showRemoteFailure(
      nextError,
      'copy-remote-path',
      'Percorso non copiato',
      'Gli appunti non sono accessibili. La copia locale è rimasta invariata.',
      undefined,
      { label: 'Riprova', onClick: () => copyTrackedRemotePath(file) },
    ))
  }, [])

  async function createDirectory() {
    if (!connectionId || !createName.trim()) return
    try {
      await remoteFilesBridge.remoteFiles.createDirectory(connectionId, currentLocation.id, createName)
      setCreateName('')
      setRefreshToken((current) => current + 1)
    } catch (nextError) {
      showRemoteFailure(
        nextError,
        'create-directory',
        'Cartella remota non creata',
        `Il nome “${createName.trim()}” è rimasto nel campo. Controlla permessi o conflitti e riprova.`,
        undefined,
        { label: 'Riprova', onClick: () => { void createDirectory() } },
      )
    }
  }

  const renameEntry = async () => {
    if (!renaming || !renameValue.trim()) return
    try {
      await remoteFilesBridge.remoteFiles.rename(renaming.id, renameValue)
      setRenameError(null)
      setRenaming(null)
      setRefreshToken((current) => current + 1)
    } catch (nextError) {
      setRenameError(reportRemoteFailure(nextError, 'rename-entry', 'Elemento remoto non rinominato', 'Il nome precedente è rimasto invariato. Correggi il nuovo nome o i permessi e riprova.'))
    }
  }

  const uploadFiles = async () => {
    if (!connectionId) return
    const requestedConnectionId = connectionId
    const requestedDirectoryId = currentLocation.id
    publishTransferError(null)
    await retryController.run({
      acceptsMultiple: true,
      direction: 'upload',
      name: null,
      execute: async () => {
        try {
          const uploaded = await remoteFilesBridge.remoteFiles.chooseAndUpload(requestedConnectionId, requestedDirectoryId)
          if (uploaded.length) {
            toast.success(`${uploaded.length} file caricati.`)
            setRefreshToken((current) => current + 1)
          }
        } catch (nextError) {
          publishTransferFallback(nextError, 'upload-files', 'Caricamento interrotto', 'I file locali sono rimasti invariati. Riprova dalla stessa cartella remota.')
        }
      },
    })
  }

  const retryTransfer = useCallback(async (transferId: string) => {
    publishTransferError(null)
    try {
      await retryController.retry(transferId)
    } catch (nextError) {
      publishTransferError({
        transferId,
        error: reportRemoteFailure(nextError, 'retry-transfer', 'Trasferimento ancora interrotto', 'Il file di origine è rimasto invariato. Controlla connessione e permessi, poi riprova.'),
      })
    }
  }, [publishTransferError, retryController])

  const requestDiscard = useCallback(function requestDiscard(file: RemoteTrackedFile) {
    const protectedCopy = file.localState !== 'synced'
    setConfirmation({
      title: `Scarta copia di “${file.name}”`,
      detail: protectedCopy ? 'La copia locale non è sincronizzata. Scartandola perderai le modifiche che non sono state caricate sul server.' : 'La copia sincronizzata verrà rimossa dalla cache privata di VincodeLab.',
      confirmLabel: protectedCopy ? 'Scarta modifiche locali' : 'Scarta copia',
      destructive: protectedCopy,
      onConfirm: () => void remoteFilesBridge.remoteFiles.discard(file.id, { force: protectedCopy }).then(() => {
        setTrackedFiles((current) => current.filter((entry) => entry.id !== file.id))
        toast.success('Copia locale rimossa.')
      }).catch((nextError) => showRemoteFailure(
        nextError,
        'discard-local-copy',
        'Copia locale non rimossa',
        `“${file.name}” e le sue modifiche sono rimaste disponibili. Riprova.`,
        'filesystem',
        { label: 'Riapri conferma', onClick: () => requestDiscard(file) },
      )),
    })
  }, [])

  function requestCleanup() {
    setConfirmation({
      title: 'Pulisci copie sincronizzate',
      detail: 'Verranno rimosse soltanto le copie già sincronizzate. Le copie modificate, in conflitto o offline resteranno disponibili.',
      confirmLabel: 'Pulisci sincronizzati',
      onConfirm: () => void remoteFilesBridge.remoteFiles.cleanup({ olderThan: Date.now() + 1 }).then((result) => {
        void loadTracked()
        toast.success(result.removed ? `${result.removed} copie o temporanei rimossi.` : 'La cache è già pulita.')
      }).catch((nextError) => showRemoteFailure(
        nextError,
        'cleanup-local-cache',
        'Cache locale non pulita',
        'Le copie locali sono rimaste disponibili. Riprova più tardi.',
        'filesystem',
        { label: 'Riapri conferma', onClick: requestCleanup },
      )),
    })
  }

  const cancelTransfer = useCallback(function cancelTransfer(transfer: RemoteTransfer) {
    void remoteFilesBridge.remoteFiles.cancelTransfer(transfer.id).catch((nextError) => showRemoteFailure(
      nextError,
      'cancel-transfer',
      'Trasferimento non annullato',
      `Il trasferimento di “${transfer.name}” è ancora attivo. Riprova.`,
      undefined,
      { label: 'Riprova annullamento', onClick: () => cancelTransfer(transfer) },
    ))
  }, [])

  const revealLocal = useCallback(function revealLocal(file: RemoteTrackedFile) {
    void remoteFilesBridge.remoteFiles.revealLocal(file.id).catch((nextError) => showRemoteFailure(
      nextError,
      'reveal-local-copy',
      'Copia locale non mostrata',
      `“${file.name}” è ancora disponibile nell’Editor. Riprova dal Finder.`,
      'filesystem',
      { label: 'Riprova', onClick: () => revealLocal(file) },
    ))
  }, [])

  useEffect(() => remoteFilesBridge.contextMenu.onAction((rawAction) => {
    // Il contratto preload viene ampliato insieme ai template nativi. Questo
    // narrowing locale mantiene il componente compatibile durante la migrazione.
    const action = rawAction as RemoteFilesContextAction
    const entry = action.contextKind === 'remote-file' || action.contextKind === 'remote-directory'
      ? entries.find((candidate) => candidate.id === action.contextId)
      : undefined
    if (entry) {
      if (action.command === 'remote.downloadOpen') void openEntry(entry)
      else if (action.command === 'remote.downloadAs') void downloadAs(entry)
      else if (action.command === 'remote.openDirectory') void openEntry(entry)
      else if (action.command === 'remote.copyPath') copyRemotePath(entry)
      else if (action.command === 'remote.rename') {
        renameDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setRenaming(entry)
        setRenameValue(entry.name)
        setRenameError(null)
      }
      else if (action.command === 'remote.delete') requestDelete(entry)
      return
    }

    const localFile = action.contextKind === 'remote-local-file'
      ? trackedFiles.find((candidate) => candidate.id === action.contextId)
      : undefined
    if (localFile) {
      if (action.command === 'remoteLocal.open') onOpenRemoteFile(localFile.id)
      else if (action.command === 'remoteLocal.reveal') revealLocal(localFile)
      else if (action.command === 'remoteLocal.copyPath') copyTrackedRemotePath(localFile)
      else if (action.command === 'remoteLocal.discard') requestDiscard(localFile)
      return
    }

    const transfer = action.contextKind === 'remote-transfer' ? transfers[action.contextId] : undefined
    if (!transfer) return
    if (action.command === 'remoteTransfer.cancel' && transfer.state === 'running') cancelTransfer(transfer)
    else if (action.command === 'remoteTransfer.retry' && transfer.state === 'error' && retryController.canRetry(transfer.id)) void retryTransfer(transfer.id)
  }), [cancelTransfer, copyRemotePath, copyTrackedRemotePath, downloadAs, entries, onOpenRemoteFile, openEntry, requestDelete, requestDiscard, retryController, retryTransfer, revealLocal, trackedFiles, transfers])

  return (
    <Splitter.Root asChild defaultFixedSize={260} panels={remoteFilePanels} storageKey={`vincodelab.remote.connection-width:${workspace}`}>
    <section className={remoteStyles.workspace} aria-label="Explorer file remoti">
      <Splitter.Panel asChild id="remote-connections"><aside className={remoteStyles.connections}>
        <header className={remoteStyles.connectionsHeader}><span className={remoteStyles.connectionsHeaderTitle} id="remote-connections-list-label"><Server aria-hidden="true" size={15} /> Profili SSH</span><div className={remoteStyles.connectionsHeaderActions}><IconButton tooltip="Nuovo profilo SSH" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Aggiorna profili e connessioni SSH" onClick={() => void loadConnections()}><RefreshCw aria-hidden="true" size={14} /></IconButton></div></header>
        {connectionError && <ErrorNotice action={{ label: 'Riprova', onClick: loadConnections }} error={connectionError} />}
        {loadingConnections && profiles.length === 0 ? <div className={remoteStyles.inlineState}><Spinner size={15} /> Caricamento profili SSH…</div> : profiles.length === 0 ? <div className={remoteStyles.profileEmpty}><strong>Nessun profilo SSH</strong><span>I comandi SSH digitati liberamente nel Terminale non possono essere esplorati. Crea un profilo con destinazione e cartella iniziale.</span><Button size="sm" variant="outline" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /> Nuovo profilo SSH</Button></div> : <Listbox.Root collection={profileCollection} deselectable={false} ids={{ label: 'remote-connections-list-label' }} loopFocus selectionMode="single" value={selectedConnection?.commandId ? [selectedConnection.commandId] : []} onValueChange={({ items }) => { const profile = items[0]; if (profile) void connectSavedProfile(profile) }}><Listbox.Content className={remoteStyles.connectionList} aria-busy={connectingProfileId !== null}>{profiles.map((profile) => {
          const connection = connections.find((candidate) => candidate.commandId === profile.id && candidate.state !== 'disconnected') ?? null
          const state = connection?.state ?? 'disconnected'
          return <Listbox.Item className={remoteStyles.profileSummary} highlightOnHover item={profile} key={profile.id}><span className={`${terminalStyles.statusDot} ${state === 'connecting' ? terminalStyles.statusLaunching : state === 'error' ? terminalStyles.statusError : state !== 'connected' ? terminalStyles.statusInactive : ''}`} /><Listbox.ItemText asChild><span className={remoteStyles.profileCopy}><strong>{profile.title}</strong><small>{profile.sshDestination}</small></span></Listbox.ItemText><span className={remoteStyles.profileAction}>{connectingProfileId === profile.id || state === 'connecting' ? <Spinner size={13} /> : <PlugZap aria-hidden="true" size={13} />}{state === 'connected' ? 'Apri' : 'Connetti'}</span></Listbox.Item>
        })}</Listbox.Content></Listbox.Root>}
      </aside></Splitter.Panel>
      <Splitter.ResizeTrigger aria-label="Ridimensiona Explorer remoto" className={remoteStyles.connectionResize} id="remote-connections:remote-files" title="Trascina per ridimensionare. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
      <Splitter.Panel id="remote-files"><Tabs.Root className={remoteStyles.filesMain} value={view} onValueChange={({ value }) => setView(value as typeof view)}>
        <Tabs.List className={remoteStyles.viewTabs} aria-label="Viste file remoti"><Tabs.Trigger value="server"><Server aria-hidden="true" size={14} /> Server</Tabs.Trigger><Tabs.Trigger value="local"><HardDrive aria-hidden="true" size={14} /> Copie locali <small className={remoteStyles.viewCount}>{trackedFiles.length}</small></Tabs.Trigger><Tabs.Indicator /></Tabs.List>
        <Tabs.Content value="server" className={remoteStyles.tabContent}>
        <header className={remoteStyles.toolbar}>
          <div className={remoteStyles.toolbarLocation}><IconButton tooltip="Cartella precedente" disabled={locations.length <= 1} onClick={() => setLocations((current) => current.slice(0, -1))}><ArrowLeft aria-hidden="true" size={14} /></IconButton><code className={remoteStyles.locationPath} title={currentLocation.path}>{currentLocation.path || selectedConnection?.remoteRoot || 'File remoti'}</code></div>
          <div className={remoteStyles.toolbarActions}><Field.Root className={remoteStyles.search}><Field.Input aria-label="Cerca nella cartella remota" placeholder="Cerca file…" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></Field.Root><Button size="sm" variant="outline" disabled={!connectionId || selectedConnection?.state !== 'connected'} onClick={() => void uploadFiles()}><Upload aria-hidden="true" size={14} /> Carica</Button><IconButton tooltip="Aggiorna file remoti" disabled={!connectionId} onClick={() => setRefreshToken((current) => current + 1)}><RefreshCw aria-hidden="true" size={14} /></IconButton></div>
        </header>
        <Field.Root className={remoteStyles.createFolder}><Field.Input aria-label="Nome nuova cartella remota" placeholder="Nuova cartella" value={createName} onChange={(event) => setCreateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createDirectory() }} /><Button size="sm" variant="outline" disabled={!createName.trim() || selectedConnection?.state !== 'connected'} onClick={() => void createDirectory()}><FolderPlus aria-hidden="true" size={14} /> Crea</Button></Field.Root>
        <div className={remoteStyles.fileList} aria-busy={loadingEntries}>
          {loadingEntries ? <div className={remoteStyles.empty}><Spinner size={18} /><strong>Caricamento file remoti…</strong><span>Lettura della cartella sul server.</span></div> : browseError ? <ErrorNotice action={{ label: 'Riprova', onClick: () => setRefreshToken((current) => current + 1) }} error={browseError} /> : !connectionId ? <div className={remoteStyles.empty}><PlugZap aria-hidden="true" size={20} /><strong>Nessuna connessione SSH attiva</strong><span>Scegli Connetti accanto a un profilo SSH oppure creane uno dalla barra laterale.</span><Button size="sm" variant="outline" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /> Nuovo profilo SSH</Button></div> : selectedConnection?.state === 'connecting' ? <div className={remoteStyles.empty} role="status"><Spinner size={18} /><strong>Connessione SSH in corso…</strong><span>Completa l’autenticazione nel Terminale.</span></div> : selectedConnection?.state !== 'connected' ? <div className={remoteStyles.empty} role="status"><PlugZap aria-hidden="true" size={20} /><strong>Connessione SSH non attiva</strong><span>Riconnetti il profilo per continuare. Le copie locali restano disponibili.</span><Button size="sm" variant="outline" onClick={() => { const profile = profiles.find((candidate) => candidate.id === selectedConnection?.commandId); if (profile) void connectSavedProfile(profile) }}><PlugZap aria-hidden="true" /> Riconnetti</Button></div> : filteredEntries.length === 0 ? <div className={remoteStyles.empty}><Folder aria-hidden="true" size={20} /><strong>Nessun file nella cartella</strong><span>{search ? 'Nessun risultato per la ricerca corrente.' : 'La cartella remota è vuota.'}</span></div> : filteredEntries.map((entry) => <Button variant="plain" key={entry.id} className={remoteStyles.fileRow} data-remote-context-id={entry.id} data-remote-context-kind={entry.kind === 'directory' ? 'remote-directory' : 'remote-file'} onClick={() => void openEntry(entry)}><span className={remoteStyles.fileIcon}><Icon aria-hidden="true" icon={entry.kind === 'directory' ? defaultFolderIcon : defaultFileIcon} width={16} /></span><span className={remoteStyles.fileName}>{entry.name}</span><span className={remoteStyles.fileMeta}>{entry.kind === 'file' ? formatSize(entry.size) : 'Cartella'}</span><span className={remoteStyles.fileAction} aria-hidden="true">{entry.kind === 'directory' ? 'Apri' : <Download size={13} />}</span></Button>)}
        </div>
        <section className={remoteStyles.transfers} aria-label="Trasferimenti"><header className={remoteStyles.transfersHeader}><strong>Trasferimenti</strong><small>{Object.values(transfers).filter((transfer) => transfer.state === 'running').length} attivi</small></header>{transferError && <ErrorNotice action={transferError.transferId && retryController.canRetry(transferError.transferId) ? { label: 'Riprova trasferimento', onClick: () => retryTransfer(transferError.transferId!) } : undefined} error={transferError.error} />}{Object.keys(transfers).length === 0 ? <p className={remoteStyles.transfersEmpty}>Nessun trasferimento nella sessione.</p> : <div>{Object.values(transfers).map((transfer) => <article className={remoteStyles.transferRow} data-context-cancellable={transfer.state === 'running' ? 'true' : undefined} data-context-retryable={transfer.state === 'error' && retryController.canRetry(transfer.id) ? 'true' : undefined} data-remote-context-id={transfer.id} data-remote-context-kind="remote-transfer" key={transfer.id}><span>{transfer.direction === 'upload' ? <Upload aria-hidden="true" size={13} /> : <Download aria-hidden="true" size={13} />}</span><strong className={remoteStyles.transferName}>{transfer.name}</strong><small className={remoteStyles.transferState}>{transfer.state === 'running' ? 'In corso…' : transfer.state === 'completed' ? 'Completato' : transfer.state === 'cancelled' ? 'Annullato' : transfer.state === 'error' ? 'Interrotto' : 'In coda'}</small>{transfer.state === 'running' && <Button size="xs" variant="plain" onClick={() => cancelTransfer(transfer)} aria-label={`Annulla trasferimento ${transfer.name}`}>Annulla</Button>}{transfer.state === 'error' && retryController.canRetry(transfer.id) && <Button size="xs" variant="outline" onClick={() => void retryTransfer(transfer.id)} aria-label={`Riprova trasferimento ${transfer.name}`}>Riprova</Button>}</article>)}</div>}</section>
        </Tabs.Content>
        <Tabs.Content value="local" className={remoteStyles.localCopies} aria-label="Copie locali dei file remoti">
          <header className={remoteStyles.localHeader}><div className={remoteStyles.localHeaderCopy}><strong>Copie locali</strong><span>{trackedFiles.length} file · {formatSize(trackedSize)}</span></div><div className={remoteStyles.localHeaderActions}><SelectField aria-label="Filtra copie locali per stato" options={[{ value: 'all', label: 'Tutti gli stati' }, { value: 'synced', label: 'Sincronizzati' }, { value: 'modified', label: 'Modificati' }, { value: 'conflict', label: 'Conflitti' }, { value: 'offline', label: 'Offline' }]} value={localFilter} onValueChange={(value) => setLocalFilter(value as typeof localFilter)} /><Button size="sm" variant="outline" disabled={loadingTracked} onClick={() => void loadTracked()}><RefreshCw aria-hidden="true" /> Aggiorna</Button><Button size="sm" variant="outline" disabled={!trackedFiles.some((file) => file.localState === 'synced')} onClick={requestCleanup}><Trash2 aria-hidden="true" /> Pulisci sincronizzati</Button></div></header>
          <div className={remoteStyles.localList} aria-busy={loadingTracked}>{loadingTracked ? <div className={remoteStyles.empty}><Spinner /><strong>Caricamento copie locali…</strong></div> : trackedError ? <ErrorNotice action={{ label: 'Riprova', onClick: loadTracked }} error={trackedError} /> : filteredTracked.length === 0 ? <div className={remoteStyles.empty}><HardDrive aria-hidden="true" size={20} /><strong>Nessuna copia locale</strong><span>{localFilter === 'all' ? 'Scarica un file dal server per modificarlo nell’Editor.' : 'Nessun file corrisponde al filtro selezionato.'}</span></div> : filteredTracked.map((file) => <article key={file.id} className={remoteStyles.localRow} data-remote-context-id={file.id} data-remote-context-kind="remote-local-file"><Icon aria-hidden="true" icon={defaultFileIcon} width={16} /><div className={remoteStyles.localCopy}><strong>{file.name}</strong><small title={file.remotePath}>{file.remotePath}</small></div><span className={`${remoteStyles.localState} ${file.localState === 'synced' ? remoteStyles.localStateSynced : file.localState === 'modified' ? remoteStyles.localStateModified : file.localState === 'conflict' ? remoteStyles.localStateConflict : remoteStyles.localStateOffline}`}>{localStateLabel(file.localState)}</span><span className={remoteStyles.localSize}>{formatSize(file.cacheSize)}</span><div className={remoteStyles.localActions}><Button size="sm" variant="outline" onClick={() => onOpenRemoteFile(file.id)}>Apri</Button><IconButton tooltip={`Mostra ${file.name} nel Finder`} onClick={() => revealLocal(file)}><FolderOpen aria-hidden="true" size={14} /></IconButton><IconButton tooltip={`Scarta copia locale ${file.name}`} onClick={() => requestDiscard(file)}><Trash2 aria-hidden="true" size={14} /></IconButton></div></article>)}</div>
        </Tabs.Content>
      </Tabs.Root></Splitter.Panel>
      <Dialog.Root
        finalFocusEl={() => renameDialogOpener.current}
        ids={{ title: 'remote-rename-title' }}
        initialFocusEl={() => renameInput.current}
        lazyMount
        open={renaming !== null}
        unmountOnExit
        onOpenChange={({ open }) => { if (!open) { setRenaming(null); setRenameError(null) } }}
      >
        <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={remoteStyles.dialog}>
          <header className={remoteStyles.dialogHeader}><Dialog.Title id="remote-rename-title">Rinomina elemento remoto</Dialog.Title><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi rinomina"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
          <Field.Root><Field.Label>Nuovo nome</Field.Label><Field.Input ref={renameInput} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameEntry() }} /></Field.Root>
          {renameError && <ErrorNotice action={{ label: 'Riprova', onClick: renameEntry }} error={renameError} />}
          <footer className={remoteStyles.dialogFooter}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={!renameValue.trim()} onClick={() => void renameEntry()}>Rinomina</Button></footer>
        </Dialog.Content></Dialog.Positioner></Dialog.Portal>
      </Dialog.Root>
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    </section>
    </Splitter.Root>
  )
}
