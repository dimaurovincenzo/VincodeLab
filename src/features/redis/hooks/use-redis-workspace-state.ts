import { useCallback, useMemo, useRef, useState } from 'react'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import type { UserError } from '@/lib/user-error'
import {
  emptyRedisScanPage,
  type RedisScanSnapshot,
  type RedisSessionPhase,
  type RedisSessionRecovery,
} from '../model/redis-workspace'
import type {
  RedisConnection,
  RedisInspection,
  RedisKeyTypeFilter,
  RedisPayloadMatch,
  RedisWorkspaceSession,
} from '../model/redis-types'

export function useRedisWorkspaceState(initialState?: RedisWorkspaceSession) {
  const [connections, setConnections] = useState<readonly RedisConnection[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => initialState?.selectedConnectionId ?? null)
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null)
  const [sessionPhase, setSessionPhase] = useState<RedisSessionPhase>('passive')
  const [sessionError, setSessionError] = useState<UserError | null>(null)
  const [sessionRecovery, setSessionRecovery] = useState<RedisSessionRecovery>('connect')
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [connectionError, setConnectionError] = useState<UserError | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<RedisConnection | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<RedisKeyTypeFilter>(() => initialState?.typeFilter ?? 'all')
  const [scanHistory, setScanHistory] = useState<readonly RedisScanSnapshot[]>([])
  const [pageIndex, setPageIndex] = useState(0)
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState<UserError | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedKeyRef, setSelectedKeyRef] = useState<string | null>(null)
  const [inspection, setInspection] = useState<RedisInspection | null>(null)
  const [inspectionLoading, setInspectionLoading] = useState(false)
  const [inspectionError, setInspectionError] = useState<UserError | null>(null)
  const [mode, setMode] = useState<'keys' | 'search'>(() => initialState?.view ?? 'keys')
  const [inspectorTab, setInspectorTab] = useState<'value' | 'metadata'>(() => initialState?.inspectorTab ?? 'value')
  const [searching, setSearching] = useState(false)
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const [searchKeyRequest, setSearchKeyRequest] = useState<{ keyPattern: string; keyRef: string; nonce: number } | undefined>()

  const connectionRequest = useRef(0)
  const sessionRequest = useRef(0)
  const scanRequest = useRef(0)
  const inspectionRequest = useRef(0)
  const inspectionRef = useRef<RedisInspection | null>(null)
  const visibleMatchesRef = useRef<readonly RedisPayloadMatch[]>([])
  const activeConnectionRef = useRef<string | null>(null)

  const beginConnectionRequest = useCallback(() => ++connectionRequest.current, [])
  const isConnectionRequestCurrent = useCallback((request: number) => request === connectionRequest.current, [])
  const beginSessionRequest = useCallback(() => ++sessionRequest.current, [])
  const invalidateSessionRequest = useCallback(() => { sessionRequest.current += 1 }, [])
  const isSessionRequestCurrent = useCallback((request: number) => request === sessionRequest.current, [])
  const beginScanRequest = useCallback(() => ++scanRequest.current, [])
  const isScanRequestCurrent = useCallback((request: number) => request === scanRequest.current, [])
  const beginInspectionRequest = useCallback(() => ++inspectionRequest.current, [])
  const isInspectionRequestCurrent = useCallback((request: number) => request === inspectionRequest.current, [])
  const getActiveConnectionId = useCallback(() => activeConnectionRef.current, [])
  const publishActiveConnectionId = useCallback((connectionId: string | null) => {
    activeConnectionRef.current = connectionId
    setActiveConnectionId(connectionId)
  }, [])
  const getInspectionSnapshot = useCallback(() => inspectionRef.current, [])
  const publishInspectionSnapshot = useCallback((next: RedisInspection | null) => {
    inspectionRef.current = next
  }, [])
  const getVisibleMatches = useCallback(() => visibleMatchesRef.current, [])
  const publishVisibleMatches = useCallback((matches: readonly RedisPayloadMatch[]) => {
    visibleMatchesRef.current = matches
  }, [])

  const selected = useMemo(
    () => connections.find((connection) => connection.id === selectedId) ?? null,
    [connections, selectedId],
  )
  const connectionOptions = useMemo(
    () => connections.map((connection) => ({ value: connection.id, label: `${connection.name} · DB ${connection.database}` })),
    [connections],
  )
  const currentSnapshot = scanHistory[pageIndex]
  const page = currentSnapshot?.page ?? emptyRedisScanPage
  const operational = sessionPhase === 'connected' && activeConnectionId === selectedId
  const sessionBusy = sessionPhase === 'connecting' || sessionPhase === 'disconnecting'

  const resetRemoteState = useCallback(() => {
    scanRequest.current += 1
    inspectionRequest.current += 1
    inspectionRef.current = null
    visibleMatchesRef.current = []
    setScanHistory([])
    setPageIndex(0)
    setSelectedKey(null)
    setSelectedKeyRef(null)
    setInspection(null)
    setInspectionLoading(false)
    setInspectionError(null)
    setScanError(null)
    setScanLoading(false)
    setSearching(false)
    setSearchKeyRequest(undefined)
  }, [])

  return {
    activeConnectionId,
    beginConnectionRequest,
    beginInspectionRequest,
    beginScanRequest,
    beginSessionRequest,
    confirmation,
    connectionError,
    connectionOptions,
    connections,
    currentSnapshot,
    dialogOpen,
    editingConnection,
    filter,
    inspection,
    inspectionError,
    inspectionLoading,
    getActiveConnectionId,
    getInspectionSnapshot,
    getVisibleMatches,
    inspectorTab,
    loadingConnections,
    mode,
    operational,
    page,
    pageIndex,
    resetRemoteState,
    scanError,
    scanHistory,
    scanLoading,
    searchFocusRequest,
    searchKeyRequest,
    searching,
    selected,
    selectedId,
    selectedKey,
    selectedKeyRef,
    sessionBusy,
    sessionError,
    sessionPhase,
    sessionRecovery,
    invalidateSessionRequest,
    isConnectionRequestCurrent,
    isInspectionRequestCurrent,
    isScanRequestCurrent,
    isSessionRequestCurrent,
    publishActiveConnectionId,
    publishInspectionSnapshot,
    publishVisibleMatches,
    setConfirmation,
    setConnectionError,
    setConnections,
    setDialogOpen,
    setEditingConnection,
    setFilter,
    setInspection,
    setInspectionError,
    setInspectionLoading,
    setInspectorTab,
    setLoadingConnections,
    setMode,
    setPageIndex,
    setScanError,
    setScanHistory,
    setScanLoading,
    setSearchFocusRequest,
    setSearchKeyRequest,
    setSearching,
    setSelectedId,
    setSelectedKey,
    setSelectedKeyRef,
    setSessionError,
    setSessionPhase,
    setSessionRecovery,
    setTypeFilter,
    typeFilter,
  }
}

export type RedisWorkspaceState = ReturnType<typeof useRedisWorkspaceState>
