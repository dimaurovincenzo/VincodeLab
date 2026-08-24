import { useCallback } from 'react'
import { MAX_REDIS_SCAN_HISTORY_PAGES, mergeRedisInspection } from '../model/redis-workspace'
import type {
  RedisApi,
  RedisKeySummary,
  RedisKeyTypeFilter,
  RedisPayloadMatch,
} from '../model/redis-types'
import { reportRedisFailure } from '../services/redis-error'
import type { RedisWorkspaceState } from './use-redis-workspace-state'

type RedisBrowserControllerOptions = {
  api: RedisApi
  state: RedisWorkspaceState
}

export function useRedisBrowserController({ api, state }: RedisBrowserControllerOptions) {
  const {
    beginInspectionRequest,
    beginScanRequest,
    currentSnapshot,
    filter,
    getActiveConnectionId,
    getInspectionSnapshot,
    isInspectionRequestCurrent,
    isScanRequestCurrent,
    page,
    pageIndex,
    publishInspectionSnapshot,
    publishVisibleMatches,
    selectedKeyRef,
    setFilter,
    setInspection,
    setInspectionError,
    setInspectionLoading,
    setMode,
    setPageIndex,
    setScanError,
    setScanHistory,
    setScanLoading,
    setSelectedKey,
    setSelectedKeyRef,
    setSessionError,
    setTypeFilter,
    typeFilter,
  } = state

  const scan = useCallback(async (
    cursor?: string,
    replace = false,
    criteria?: { filter: string; type: RedisKeyTypeFilter },
    connectionId = getActiveConnectionId(),
    opening = false,
  ) => {
    if (!connectionId) return false
    const request = beginScanRequest()
    setScanLoading(true)
    setScanError(null)
    try {
      const activeFilter = criteria?.filter ?? filter
      const activeType = criteria?.type ?? typeFilter
      const nextPage = await api.scanKeys(connectionId, {
        cursor,
        match: activeFilter.trim() || '*',
        type: activeType === 'all' ? undefined : activeType,
        count: 250,
      })
      if (!isScanRequestCurrent(request)) return false
      const snapshot = { inputCursor: cursor, page: nextPage }
      if (replace) {
        setScanHistory((current) => current.map((item, index) => index === pageIndex ? snapshot : item))
      } else if (!cursor) {
        setScanHistory([snapshot])
        setPageIndex(0)
      } else {
        setScanHistory((current) => {
          const next = [...current.slice(0, pageIndex + 1), snapshot]
          const overflow = Math.max(0, next.length - MAX_REDIS_SCAN_HISTORY_PAGES)
          setPageIndex(next.length - overflow - 1)
          return next.slice(overflow)
        })
      }
      return true
    } catch (cause) {
      if (!isScanRequestCurrent(request)) return false
      const incident = opening
        ? reportRedisFailure(cause, 'open-connection', 'Connessione Redis non aperta', 'La configurazione resta selezionata e nessun dato è stato perso. Verifica il server e riprova.')
        : reportRedisFailure(cause, 'scan-keys', 'SCAN Redis non completato', 'La connessione resta selezionata. Puoi riprovare senza perdere i filtri.')
      if (opening) setSessionError(incident)
      else setScanError(incident)
      return false
    } finally {
      if (isScanRequestCurrent(request)) setScanLoading(false)
    }
  }, [api, beginScanRequest, filter, getActiveConnectionId, isScanRequestCurrent, pageIndex, setPageIndex, setScanError, setScanHistory, setScanLoading, setSessionError, typeFilter])

  const readKey = useCallback(async (keyRef: string, append = false) => {
    const connectionId = getActiveConnectionId()
    if (!connectionId) return
    const request = beginInspectionRequest()
    setInspectionLoading(true)
    setInspectionError(null)
    const current = append ? getInspectionSnapshot() : null
    const input = current && current.type !== 'string' && current.type !== 'json'
      ? current.type === 'list' ? { offset: current.nextOffset, count: 200 } : { cursor: current.cursor, count: 200 }
      : { count: 200 }
    try {
      const next = await api.readKey(connectionId, keyRef, input)
      if (!isInspectionRequestCurrent(request)) return
      setInspection((latest) => {
        const merged = append && latest?.keyRef === keyRef ? mergeRedisInspection(latest, next) : next
        publishInspectionSnapshot(merged)
        return merged
      })
    } catch (cause) {
      if (!isInspectionRequestCurrent(request)) return
      setInspectionError(reportRedisFailure(cause, 'read-key', 'Chiave Redis non leggibile', 'La chiave potrebbe essere scaduta o il server non è raggiungibile. Aggiorna la lettura o la lista.'))
    } finally {
      if (isInspectionRequestCurrent(request)) setInspectionLoading(false)
    }
  }, [api, beginInspectionRequest, getActiveConnectionId, getInspectionSnapshot, isInspectionRequestCurrent, publishInspectionSnapshot, setInspection, setInspectionError, setInspectionLoading])

  const selectKey = useCallback((key: string, keyRef: string) => {
    setSelectedKey(key)
    setSelectedKeyRef(keyRef)
    publishInspectionSnapshot(null)
    setInspection(null)
    setMode('keys')
    void readKey(keyRef)
  }, [publishInspectionSnapshot, readKey, setInspection, setMode, setSelectedKey, setSelectedKeyRef])

  const applyFilters = useCallback((nextFilter: string, nextType: RedisKeyTypeFilter) => {
    setFilter(nextFilter)
    setTypeFilter(nextType)
    setSelectedKey(null)
    setSelectedKeyRef(null)
    publishInspectionSnapshot(null)
    setInspection(null)
    void scan(undefined, false, { filter: nextFilter, type: nextType })
  }, [publishInspectionSnapshot, scan, setFilter, setInspection, setSelectedKey, setSelectedKeyRef, setTypeFilter])

  const showNextPage = useCallback(() => { void scan(page.cursor) }, [page.cursor, scan])
  const showPreviousPage = useCallback(() => setPageIndex((current) => Math.max(0, current - 1)), [setPageIndex])
  const refreshPage = useCallback(() => { void scan(currentSnapshot?.inputCursor, Boolean(currentSnapshot)) }, [currentSnapshot, scan])
  const handleVisibleMatchesChange = useCallback((matches: readonly RedisPayloadMatch[]) => {
    publishVisibleMatches(matches)
  }, [publishVisibleMatches])
  const handleKeySelect = useCallback((key: RedisKeySummary) => selectKey(key.key, key.keyRef), [selectKey])
  const handlePayloadMatchOpen = useCallback((match: RedisPayloadMatch) => selectKey(match.key, match.keyRef), [selectKey])
  const loadMoreInspection = useCallback(() => {
    if (selectedKeyRef) void readKey(selectedKeyRef, true)
  }, [readKey, selectedKeyRef])
  const refreshInspection = useCallback(() => {
    if (selectedKeyRef) void readKey(selectedKeyRef)
  }, [readKey, selectedKeyRef])

  return {
    applyFilters,
    handleKeySelect,
    handlePayloadMatchOpen,
    handleVisibleMatchesChange,
    loadMoreInspection,
    readKey,
    refreshInspection,
    refreshPage,
    scan,
    selectKey,
    showNextPage,
    showPreviousPage,
  }
}

export type RedisBrowserController = ReturnType<typeof useRedisBrowserController>
