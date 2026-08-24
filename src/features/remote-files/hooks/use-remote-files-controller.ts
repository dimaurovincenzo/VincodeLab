import { useCallback, useEffect } from 'react'
import { toast } from '@/components/ui'
import { remoteFilesBridge } from '../api/remote-files.bridge'
import type { RemoteFilesProps } from '../model/remote-files.types'
import { reportRemoteFailure, showRemoteFailure } from '../services/remote-files-error'
import { useRemoteFilesContextMenu } from './use-remote-files-context-menu'
import { useRemoteFilesState } from './use-remote-files-state'

export function useRemoteFilesController({
  active,
  workspace,
  preferredConnectionId,
  onOpenRemoteFile,
  onConnectProfile,
}: RemoteFilesProps) {
  const owner = useRemoteFilesState(preferredConnectionId)
  const { captureRenameDialogOpener } = owner
  const { currentLocation, selectedConnection } = owner.derived
  const { transferErrorRef } = owner.internals
  const { retryController } = owner
  const {
    connectionId,
    connections,
    createName,
    entries,
    renameValue,
    renaming,
    refreshToken,
    trackedFiles,
    transfers,
    setBrowseError,
    setConfirmation,
    setConnectionError,
    setConnectionId,
    setConnectingProfileId,
    setConnections,
    setCreateName,
    setEntries,
    setLoadingConnections,
    setLoadingEntries,
    setLoadingTracked,
    setLocations,
    setProfiles,
    setRefreshToken,
    setRenameError,
    setRenameValue,
    setRenaming,
    setTrackedError,
    setTrackedFiles,
    setTransferError,
    setTransfers,
  } = owner.state

  const publishTransferError = useCallback((next: typeof transferErrorRef.current) => {
    transferErrorRef.current = next
    setTransferError(next)
  }, [setTransferError, transferErrorRef])

  const publishTransferFallback = useCallback((nextError: unknown, operation: string, title: string, description: string) => {
    const eventOwned = transferErrorRef.current
    if (eventOwned?.transferId && retryController.canRetry(eventOwned.transferId)) return
    publishTransferError({ transferId: null, error: reportRemoteFailure(nextError, operation, title, description) })
  }, [publishTransferError, retryController, transferErrorRef])

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
  }, [setLoadingTracked, setTrackedError, setTrackedFiles])

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
  }, [preferredConnectionId, setConnectionError, setConnectionId, setConnections, setLoadingConnections, setProfiles])

  const connectSavedProfile = useCallback(async (profile: WorkspaceCommand) => {
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
  }, [connections, onConnectProfile, setConnectingProfileId, setConnectionError, setConnectionId])

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
  }), [connectionId, setConnectionError, setConnections])

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
    } else if ((transfer.state === 'completed' || transfer.state === 'cancelled') && transferErrorRef.current?.transferId === transfer.id) {
      publishTransferError(null)
    }
  }), [publishTransferError, retryController, setTransfers, transferErrorRef])

  useEffect(() => { retryController.reset() }, [retryController, workspace])

  useEffect(() => {
    queueMicrotask(() => {
      setLocations([{ id: null, path: '' }])
      setEntries([])
      setBrowseError(null)
    })
  }, [connectionId, setBrowseError, setEntries, setLocations])

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
  }, [active, connectionId, currentLocation.id, refreshToken, selectedConnection?.state, setBrowseError, setEntries, setLoadingEntries, setLocations])

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
  }, [onOpenRemoteFile, publishTransferError, publishTransferFallback, retryController, setLocations, setTrackedFiles])

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
  }, [setConfirmation, setRefreshToken])

  const copyRemotePath = useCallback(function copyRemotePath(entry: RemoteEntry) {
    void navigator.clipboard.writeText(entry.displayPath).then(() => toast.success('Percorso remoto copiato.')).catch((nextError) => showRemoteFailure(
      nextError,
      'copy-remote-path',
      'Percorso non copiato',
      'Gli appunti non sono accessibili. La selezione remota è rimasta invariata.',
      undefined,
      { label: 'Riprova', onClick: () => copyRemotePath(entry) },
    ))
  }, [])

  const copyTrackedRemotePath = useCallback(function copyTrackedRemotePath(file: RemoteTrackedFile) {
    void navigator.clipboard.writeText(file.remotePath).then(() => toast.success('Percorso remoto copiato.')).catch((nextError) => showRemoteFailure(
      nextError,
      'copy-remote-path',
      'Percorso non copiato',
      'Gli appunti non sono accessibili. La copia locale è rimasta invariata.',
      undefined,
      { label: 'Riprova', onClick: () => copyTrackedRemotePath(file) },
    ))
  }, [])

  const createDirectory = useCallback(async function createDirectory() {
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
  }, [connectionId, createName, currentLocation.id, setCreateName, setRefreshToken])

  const renameEntry = useCallback(async () => {
    if (!renaming || !renameValue.trim()) return
    try {
      await remoteFilesBridge.remoteFiles.rename(renaming.id, renameValue)
      setRenameError(null)
      setRenaming(null)
      setRefreshToken((current) => current + 1)
    } catch (nextError) {
      setRenameError(reportRemoteFailure(nextError, 'rename-entry', 'Elemento remoto non rinominato', 'Il nome precedente è rimasto invariato. Correggi il nuovo nome o i permessi e riprova.'))
    }
  }, [renameValue, renaming, setRefreshToken, setRenameError, setRenaming])

  const uploadFiles = useCallback(async () => {
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
  }, [connectionId, currentLocation.id, publishTransferError, publishTransferFallback, retryController, setRefreshToken])

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
  }, [setConfirmation, setTrackedFiles])

  const requestCleanup = useCallback(function requestCleanup() {
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
  }, [loadTracked, setConfirmation])

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

  const openRename = useCallback((entry: RemoteEntry) => {
    captureRenameDialogOpener()
    setRenaming(entry)
    setRenameValue(entry.name)
    setRenameError(null)
  }, [captureRenameDialogOpener, setRenameError, setRenameValue, setRenaming])
  const closeRename = useCallback(() => {
    setRenaming(null)
    setRenameError(null)
  }, [setRenameError, setRenaming])
  const canRetryTransfer = useCallback((transferId: string) => retryController.canRetry(transferId), [retryController])
  const refreshEntries = useCallback(() => setRefreshToken((current) => current + 1), [setRefreshToken])
  const goBack = useCallback(() => setLocations((current) => current.slice(0, -1)), [setLocations])

  useRemoteFilesContextMenu({
    entries,
    trackedFiles,
    transfers,
    canRetryTransfer,
    cancelTransfer,
    copyRemotePath,
    copyTrackedRemotePath,
    downloadAs,
    onOpenRemoteFile,
    openEntry,
    openRename,
    requestDelete,
    requestDiscard,
    retryTransfer,
    revealLocal,
  })

  return {
    actions: {
      canRetryTransfer,
      cancelTransfer,
      closeRename,
      connectSavedProfile,
      createDirectory,
      goBack,
      loadConnections,
      loadTracked,
      openEntry,
      refreshEntries,
      renameEntry,
      requestCleanup,
      requestDiscard,
      retryTransfer,
      revealLocal,
      uploadFiles,
    },
    derived: owner.derived,
    elements: owner.elements,
    state: owner.state,
  }
}

export type RemoteFilesController = ReturnType<typeof useRemoteFilesController>
