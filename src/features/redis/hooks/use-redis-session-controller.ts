import { useCallback, useEffect } from 'react'
import type { RedisApi, RedisConnection, RedisConnectionInput, RedisWorkspaceSession } from '../model/redis-types'
import { reportRedisFailure } from '../services/redis-error'
import type { RedisBrowserController } from './use-redis-browser-controller'
import type { RedisWorkspaceState } from './use-redis-workspace-state'

type RedisSessionControllerOptions = {
  api: RedisApi
  browser: RedisBrowserController
  initialState?: RedisWorkspaceSession
  state: RedisWorkspaceState
  workspace: string
}

export function useRedisSessionController({ api, browser, initialState, state, workspace }: RedisSessionControllerOptions) {
  const { readKey, scan } = browser
  const {
    beginConnectionRequest,
    beginSessionRequest,
    currentSnapshot,
    editingConnection,
    getActiveConnectionId,
    invalidateSessionRequest,
    isConnectionRequestCurrent,
    isSessionRequestCurrent,
    resetRemoteState,
    selectedId,
    selectedKeyRef,
    sessionBusy,
    sessionPhase,
    setConfirmation,
    setConnectionError,
    setConnections,
    setDialogOpen,
    setEditingConnection,
    setLoadingConnections,
    setScanError,
    setSelectedId,
    setSessionError,
    setSessionPhase,
    setSessionRecovery,
    publishActiveConnectionId,
  } = state

  const loadConnections = useCallback(async () => {
    const request = beginConnectionRequest()
    setLoadingConnections(true)
    setConnectionError(null)
    try {
      const next = await api.listConnections()
      if (!isConnectionRequestCurrent(request)) return
      setConnections(next)
      setSelectedId((current) => next.some((connection) => connection.id === current)
        ? current
        : next.find((connection) => connection.id === initialState?.selectedConnectionId)?.id ?? next[0]?.id ?? null)
    } catch (cause) {
      if (!isConnectionRequestCurrent(request)) return
      setConnections([])
      setSelectedId(null)
      setConnectionError(reportRedisFailure(cause, 'list-connections', 'Connessioni Redis non disponibili', 'Non è stato possibile caricare le connessioni del workspace.'))
    } finally {
      if (isConnectionRequestCurrent(request)) setLoadingConnections(false)
    }
  }, [api, beginConnectionRequest, initialState?.selectedConnectionId, isConnectionRequestCurrent, setConnectionError, setConnections, setLoadingConnections, setSelectedId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- l'apertura del workspace avvia il caricamento asincrono e il relativo stato osservabile
  useEffect(() => { void loadConnections() }, [loadConnections, workspace])

  const connectSelected = useCallback(async () => {
    if (!selectedId || sessionPhase !== 'passive') return
    const request = beginSessionRequest()
    setSessionPhase('connecting')
    setSessionError(null)
    setSessionRecovery('connect')
    resetRemoteState()
    const opened = await scan(undefined, false, undefined, selectedId, true)
    if (!isSessionRequestCurrent(request)) return
    if (!opened) {
      publishActiveConnectionId(null)
      setSessionPhase('passive')
      return
    }
    publishActiveConnectionId(selectedId)
    setSessionPhase('connected')
  }, [beginSessionRequest, isSessionRequestCurrent, publishActiveConnectionId, resetRemoteState, scan, selectedId, sessionPhase, setSessionError, setSessionPhase, setSessionRecovery])

  const reconnect = useCallback(async () => {
    const connectionId = getActiveConnectionId()
    if (!connectionId || sessionPhase !== 'connected') return
    const request = beginSessionRequest()
    setSessionPhase('connecting')
    setSessionError(null)
    setSessionRecovery('reconnect')
    setScanError(null)
    try {
      await api.reconnect(connectionId)
    } catch (cause) {
      if (!isSessionRequestCurrent(request)) return
      setSessionPhase('connected')
      setSessionRecovery('reconnect')
      setSessionError(reportRedisFailure(cause, 'reconnect', 'Redis non riconnesso', 'La sessione corrente resta selezionata. Riprova oppure disconnettiti.'))
      return
    }
    if (!isSessionRequestCurrent(request)) return
    const opened = await scan(currentSnapshot?.inputCursor, Boolean(currentSnapshot), undefined, connectionId, true)
    if (!isSessionRequestCurrent(request)) return
    if (!opened) {
      publishActiveConnectionId(null)
      setSessionPhase('passive')
      return
    }
    publishActiveConnectionId(connectionId)
    setSessionPhase('connected')
    if (selectedKeyRef) void readKey(selectedKeyRef)
  }, [api, beginSessionRequest, currentSnapshot, getActiveConnectionId, isSessionRequestCurrent, publishActiveConnectionId, readKey, scan, selectedKeyRef, sessionPhase, setScanError, setSessionError, setSessionPhase, setSessionRecovery])

  const disconnect = useCallback(async () => {
    const connectionId = getActiveConnectionId()
    if (!connectionId || sessionPhase !== 'connected') return
    const request = beginSessionRequest()
    setSessionPhase('disconnecting')
    setSessionError(null)
    setSessionRecovery('disconnect')
    try {
      await api.reconnect(connectionId)
    } catch (cause) {
      if (!isSessionRequestCurrent(request)) return
      setSessionPhase('connected')
      setSessionRecovery('disconnect')
      setSessionError(reportRedisFailure(cause, 'disconnect', 'Redis non disconnesso', 'La sessione resta disponibile. Riprova la disconnessione prima di cambiare configurazione.'))
      return
    }
    if (!isSessionRequestCurrent(request)) return
    publishActiveConnectionId(null)
    setSessionPhase('passive')
    resetRemoteState()
  }, [api, beginSessionRequest, getActiveConnectionId, isSessionRequestCurrent, publishActiveConnectionId, resetRemoteState, sessionPhase, setSessionError, setSessionPhase, setSessionRecovery])

  const selectConnection = useCallback((connectionId: string | null) => {
    if (connectionId === selectedId || sessionBusy) return
    const activeId = getActiveConnectionId()
    if (!activeId) {
      setSessionError(null)
      resetRemoteState()
      setSelectedId(connectionId)
      return
    }
    const request = beginSessionRequest()
    setSessionPhase('disconnecting')
    setSessionError(null)
    setSessionRecovery('disconnect')
    void api.reconnect(activeId).then(() => {
      if (!isSessionRequestCurrent(request)) return
      publishActiveConnectionId(null)
      resetRemoteState()
      setSelectedId(connectionId)
      setSessionPhase('passive')
    }).catch((cause) => {
      if (!isSessionRequestCurrent(request)) return
      setSessionPhase('connected')
      setSessionRecovery('disconnect')
      setSessionError(reportRedisFailure(cause, 'switch-connection', 'Connessione Redis non cambiata', 'La sessione corrente resta aperta. Riprova la disconnessione, poi seleziona la nuova configurazione.'))
    })
  }, [api, beginSessionRequest, getActiveConnectionId, isSessionRequestCurrent, publishActiveConnectionId, resetRemoteState, selectedId, sessionBusy, setSelectedId, setSessionError, setSessionPhase, setSessionRecovery])

  const saveConnection = useCallback(async (input: RedisConnectionInput) => {
    const activeId = getActiveConnectionId()
    if (activeId) {
      await api.reconnect(activeId)
      invalidateSessionRequest()
      publishActiveConnectionId(null)
      setSessionPhase('passive')
      setSessionError(null)
      resetRemoteState()
    }
    const saved = editingConnection
      ? await api.updateConnection(editingConnection.id, input)
      : await api.createConnection(input)
    await loadConnections()
    setSelectedId(saved.id)
  }, [api, editingConnection, getActiveConnectionId, invalidateSessionRequest, loadConnections, publishActiveConnectionId, resetRemoteState, setSelectedId, setSessionError, setSessionPhase])

  const deleteConnection = useCallback((connection: RedisConnection) => {
    setConfirmation({
      title: `Eliminare “${connection.name}”?`,
      detail: 'La configurazione viene rimossa dal workspace. Le chiavi sul server Redis non vengono modificate.',
      confirmLabel: 'Elimina connessione',
      destructive: true,
      onConfirm: () => {
        void api.deleteConnection(connection.id).then(() => {
          if (getActiveConnectionId() === connection.id) {
            invalidateSessionRequest()
            publishActiveConnectionId(null)
            setSessionPhase('passive')
            resetRemoteState()
          }
          return loadConnections()
        }).catch((cause) => setConnectionError(reportRedisFailure(cause, 'delete-connection', 'Connessione Redis non eliminata', 'La configurazione è ancora disponibile. Puoi riprovare.')))
      },
    })
  }, [api, getActiveConnectionId, invalidateSessionRequest, loadConnections, publishActiveConnectionId, resetRemoteState, setConfirmation, setConnectionError, setSessionPhase])

  const openNewConnection = useCallback(() => {
    setEditingConnection(null)
    setDialogOpen(true)
  }, [setDialogOpen, setEditingConnection])

  const editConnection = useCallback((connection: RedisConnection) => {
    setEditingConnection(connection)
    setDialogOpen(true)
  }, [setDialogOpen, setEditingConnection])

  return {
    connectSelected,
    deleteConnection,
    disconnect,
    editConnection,
    loadConnections,
    openNewConnection,
    reconnect,
    saveConnection,
    selectConnection,
  }
}

export type RedisSessionController = ReturnType<typeof useRedisSessionController>
