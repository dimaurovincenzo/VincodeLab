import { useCallback, useMemo, useRef, useState } from 'react'
import { createListCollection } from '@/components/ui'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { createRemoteTransferRetryController } from '@/lib/remote-transfer-retry'
import type { UserError } from '@/lib/user-error'
import type { RemoteDirectoryLocation, RemoteFilesView, RemoteLocalFilter } from '../model/remote-files.types'

type TransferError = { transferId: string | null; error: UserError }

export function useRemoteFilesState(preferredConnectionId: string | null) {
  const [connections, setConnections] = useState<ManagedSshConnection[]>([])
  const [profiles, setProfiles] = useState<WorkspaceCommand[]>([])
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(preferredConnectionId)
  const [locations, setLocations] = useState<RemoteDirectoryLocation[]>([{ id: null, path: '' }])
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [search, setSearch] = useState('')
  const [view, setView] = useState<RemoteFilesView>('server')
  const [localFilter, setLocalFilter] = useState<RemoteLocalFilter>('all')
  const [trackedFiles, setTrackedFiles] = useState<RemoteTrackedFile[]>([])
  const [loadingTracked, setLoadingTracked] = useState(false)
  const [loadingConnections, setLoadingConnections] = useState(false)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [connectionError, setConnectionError] = useState<UserError | null>(null)
  const [browseError, setBrowseError] = useState<UserError | null>(null)
  const [trackedError, setTrackedError] = useState<UserError | null>(null)
  const [renameError, setRenameError] = useState<UserError | null>(null)
  const [transferError, setTransferError] = useState<TransferError | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [transfers, setTransfers] = useState<Record<string, RemoteTransfer>>({})
  const [, setRetryRevision] = useState(0)
  const [retryController] = useState(() => createRemoteTransferRetryController(() => setRetryRevision((current) => current + 1)))
  const [createName, setCreateName] = useState('')
  const [renaming, setRenaming] = useState<RemoteEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const transferErrorRef = useRef<TransferError | null>(null)
  const renameDialogOpener = useRef<HTMLElement | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)
  const captureRenameDialogOpener = useCallback(() => {
    renameDialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  const currentLocation = locations.at(-1) ?? { id: null, path: '' }
  const selectedConnection = connections.find((connection) => connection.id === connectionId) ?? null
  const profileCollection = useMemo(() => createListCollection({
    items: profiles,
    isItemDisabled: (profile) => connectingProfileId === profile.id,
    itemToString: (profile) => profile.title,
    itemToValue: (profile) => profile.id,
  }), [connectingProfileId, profiles])
  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('it-IT')
    return query ? entries.filter((entry) => entry.name.toLocaleLowerCase('it-IT').includes(query)) : entries
  }, [entries, search])
  const filteredTracked = useMemo(
    () => localFilter === 'all' ? trackedFiles : trackedFiles.filter((file) => file.localState === localFilter),
    [localFilter, trackedFiles],
  )
  const trackedSize = useMemo(() => trackedFiles.reduce((total, file) => total + file.cacheSize, 0), [trackedFiles])

  return {
    derived: { currentLocation, filteredEntries, filteredTracked, profileCollection, selectedConnection, trackedSize },
    elements: { renameDialogOpener, renameInput },
    internals: { transferErrorRef },
    captureRenameDialogOpener,
    retryController,
    state: {
      browseError,
      confirmation,
      connectionError,
      connectionId,
      connectingProfileId,
      connections,
      createName,
      entries,
      loadingConnections,
      loadingEntries,
      loadingTracked,
      localFilter,
      locations,
      profiles,
      refreshToken,
      renameError,
      renameValue,
      renaming,
      search,
      trackedError,
      trackedFiles,
      transferError,
      transfers,
      view,
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
      setLocalFilter,
      setLocations,
      setProfiles,
      setRefreshToken,
      setRenameError,
      setRenameValue,
      setRenaming,
      setSearch,
      setTrackedError,
      setTrackedFiles,
      setTransferError,
      setTransfers,
      setView,
    },
  }
}

export type RemoteFilesStateOwner = ReturnType<typeof useRemoteFilesState>
