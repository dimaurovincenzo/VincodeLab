import { Database, FilePenLine, Plug, Plus, RefreshCw, Search, Trash2, Unplug } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ErrorNotice, IconButton, SelectField, Spinner, Splitter, Tabs, toast, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { redisApi, redisBridge } from '../api/redis.bridge'
import {
  type RedisConnection,
  type RedisConnectionInput,
  type RedisInspection,
  type RedisKeySummary,
  type RedisKeyTypeFilter,
  type RedisPayloadMatch,
  type RedisScanPage,
  type RedisWorkbenchContext,
  type RedisWorkspaceSession,
} from '../model/redis-types'
import { RedisConnectionDialog } from './redis-connection-dialog'
import { RedisConnectionGate } from './redis-connection-gate'
import { RedisInspectorEmpty, RedisKeyInspector } from './redis-key-inspector'
import { RedisKeyBrowser } from './redis-key-browser'
import { RedisPayloadSearch } from './redis-payload-search'
import { redisStyles as rs } from '@/theme/styles/redis'

type Props = {
  workspace: string
  focusRequest?: number
  initialState?: RedisWorkspaceSession
  onContextChange?: (context: RedisWorkbenchContext) => void
  onSessionChange?: (state: RedisWorkspaceSession) => void
}

type ScanSnapshot = { inputCursor?: string; page: RedisScanPage }
type RedisSessionPhase = 'passive' | 'connecting' | 'connected' | 'disconnecting'
type RedisSessionRecovery = 'connect' | 'disconnect' | 'reconnect'

const panels: SplitterPanelData[] = [
  { id: 'redis-browser', minSize: '260px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'redis-content', minSize: '460px' },
]

const emptyPage: RedisScanPage = { cursor: '0', keys: [], scanned: 0, hasMore: false }
const MAX_SCAN_HISTORY_PAGES = 20
const MAX_INSPECTION_ITEMS = 2_000

function redisError(error: unknown, operation: string, title: string, fallbackDescription: string) {
  return reportUserError(normalizeUserError(error, { category: 'database', component: 'redis-workspace', operation, title, fallbackDescription }))
}

function mergeInspection(current: RedisInspection, incoming: RedisInspection): RedisInspection {
  if (current.type !== incoming.type || current.keyRef !== incoming.keyRef) return incoming
  if (current.type === 'hash' && incoming.type === 'hash') { const entries = [...current.entries, ...incoming.entries]; return { ...incoming, entries: entries.slice(0, MAX_INSPECTION_ITEMS), hasMore: entries.length < MAX_INSPECTION_ITEMS && incoming.hasMore, viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || entries.length > MAX_INSPECTION_ITEMS || (entries.length === MAX_INSPECTION_ITEMS && incoming.hasMore)) } }
  if (current.type === 'list' && incoming.type === 'list') { const items = [...current.items, ...incoming.items]; return { ...incoming, items: items.slice(0, MAX_INSPECTION_ITEMS), hasMore: items.length < MAX_INSPECTION_ITEMS && incoming.hasMore, viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || items.length > MAX_INSPECTION_ITEMS || (items.length === MAX_INSPECTION_ITEMS && incoming.hasMore)) } }
  if (current.type === 'set' && incoming.type === 'set') { const members = [...current.members, ...incoming.members]; return { ...incoming, members: members.slice(0, MAX_INSPECTION_ITEMS), hasMore: members.length < MAX_INSPECTION_ITEMS && incoming.hasMore, viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || members.length > MAX_INSPECTION_ITEMS || (members.length === MAX_INSPECTION_ITEMS && incoming.hasMore)) } }
  if (current.type === 'zset' && incoming.type === 'zset') { const members = [...current.members, ...incoming.members]; return { ...incoming, members: members.slice(0, MAX_INSPECTION_ITEMS), hasMore: members.length < MAX_INSPECTION_ITEMS && incoming.hasMore, viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || members.length > MAX_INSPECTION_ITEMS || (members.length === MAX_INSPECTION_ITEMS && incoming.hasMore)) } }
  if (current.type === 'stream' && incoming.type === 'stream') { const entries = [...current.entries, ...incoming.entries]; return { ...incoming, entries: entries.slice(0, MAX_INSPECTION_ITEMS), hasMore: entries.length < MAX_INSPECTION_ITEMS && incoming.hasMore, viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || entries.length > MAX_INSPECTION_ITEMS || (entries.length === MAX_INSPECTION_ITEMS && incoming.hasMore)) } }
  return incoming
}

function visibleInspectionValue(inspection: RedisInspection) {
  if (inspection.type === 'string') return inspection.value
  if (inspection.type === 'json') return JSON.stringify(inspection.value, null, 2)
  if (inspection.type === 'hash') return inspection.entries.map(({ field, value }) => `${field}\t${value}`).join('\n')
  if (inspection.type === 'list') return inspection.items.map(({ index, value }) => `${index}\t${value}`).join('\n')
  if (inspection.type === 'set') return inspection.members.join('\n')
  if (inspection.type === 'zset') return inspection.members.map(({ score, value }) => `${score}\t${value}`).join('\n')
  return inspection.entries.map((entry) => `${entry.id}\t${entry.fields.map(({ field, value }) => `${field}: ${value}`).join('\t')}`).join('\n')
}

function useRedisMenuCommand(command: string, handler: () => void) {
  const handlerRef = useRef(handler)
  useEffect(() => { handlerRef.current = handler }, [handler])
  useEffect(() => {
    const listener = (event: Event) => { if ((event as CustomEvent<string>).detail === command) handlerRef.current() }
    window.addEventListener('vincodelab:application-menu-command', listener)
    return () => window.removeEventListener('vincodelab:application-menu-command', listener)
  }, [command])
}

export function RedisWorkspace({ workspace, focusRequest = 0, initialState, onContextChange, onSessionChange }: Props) {
  const api = redisApi()
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
  const [scanHistory, setScanHistory] = useState<readonly ScanSnapshot[]>([])
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
  const contextActionHandlerRef = useRef<(action: ContextMenuAction) => void>(() => undefined)
  const activeConnectionRef = useRef<string | null>(null)
  const selected = useMemo(() => connections.find((connection) => connection.id === selectedId) ?? null, [connections, selectedId])
  const connectionOptions = useMemo(() => connections.map((connection) => ({ value: connection.id, label: `${connection.name} · DB ${connection.database}` })), [connections])
  const currentSnapshot = scanHistory[pageIndex]
  const page = currentSnapshot?.page ?? emptyPage
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

  const loadConnections = useCallback(async () => {
    const request = ++connectionRequest.current
    setLoadingConnections(true)
    setConnectionError(null)
    try {
      const next = await api.listConnections()
      if (request !== connectionRequest.current) return
      setConnections(next)
      setSelectedId((current) => next.some((connection) => connection.id === current) ? current : next.find((connection) => connection.id === initialState?.selectedConnectionId)?.id ?? next[0]?.id ?? null)
    } catch (cause) {
      if (request !== connectionRequest.current) return
      setConnections([])
      setSelectedId(null)
      setConnectionError(redisError(cause, 'list-connections', 'Connessioni Redis non disponibili', 'Non è stato possibile caricare le connessioni del workspace.'))
    } finally {
      if (request === connectionRequest.current) setLoadingConnections(false)
    }
  }, [api, initialState?.selectedConnectionId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- l'apertura del workspace avvia il caricamento asincrono e il relativo stato osservabile
  useEffect(() => { void loadConnections() }, [loadConnections, workspace])

  const scan = useCallback(async (
    cursor?: string,
    replace = false,
    criteria?: { filter: string; type: RedisKeyTypeFilter },
    connectionId = activeConnectionRef.current,
    opening = false,
  ) => {
    if (!connectionId) return false
    const request = ++scanRequest.current
    setScanLoading(true)
    setScanError(null)
    try {
      const activeFilter = criteria?.filter ?? filter
      const activeType = criteria?.type ?? typeFilter
      const nextPage = await api.scanKeys(connectionId, { cursor, match: activeFilter.trim() || '*', type: activeType === 'all' ? undefined : activeType, count: 250 })
      if (request !== scanRequest.current) return false
      const snapshot = { inputCursor: cursor, page: nextPage }
      if (replace) setScanHistory((current) => current.map((item, index) => index === pageIndex ? snapshot : item))
      else if (!cursor) { setScanHistory([snapshot]); setPageIndex(0) }
      else {
        setScanHistory((current) => {
          const next = [...current.slice(0, pageIndex + 1), snapshot]
          const overflow = Math.max(0, next.length - MAX_SCAN_HISTORY_PAGES)
          setPageIndex(next.length - overflow - 1)
          return next.slice(overflow)
        })
      }
      return true
    } catch (cause) {
      if (request !== scanRequest.current) return false
      const incident = opening
        ? redisError(cause, 'open-connection', 'Connessione Redis non aperta', 'La configurazione resta selezionata e nessun dato è stato perso. Verifica il server e riprova.')
        : redisError(cause, 'scan-keys', 'SCAN Redis non completato', 'La connessione resta selezionata. Puoi riprovare senza perdere i filtri.')
      if (opening) setSessionError(incident)
      else setScanError(incident)
      return false
    } finally {
      if (request === scanRequest.current) setScanLoading(false)
    }
  }, [api, filter, pageIndex, typeFilter])

  const readKey = useCallback(async (keyRef: string, append = false) => {
    const connectionId = activeConnectionRef.current
    if (!connectionId) return
    const request = ++inspectionRequest.current
    setInspectionLoading(true)
    setInspectionError(null)
    const current = append ? inspectionRef.current : null
    const input = current && current.type !== 'string' && current.type !== 'json'
      ? current.type === 'list' ? { offset: current.nextOffset, count: 200 } : { cursor: current.cursor, count: 200 }
      : { count: 200 }
    try {
      const next = await api.readKey(connectionId, keyRef, input)
      if (request !== inspectionRequest.current) return
      setInspection((latest) => {
        const merged = append && latest?.keyRef === keyRef ? mergeInspection(latest, next) : next
        inspectionRef.current = merged
        return merged
      })
    } catch (cause) {
      if (request !== inspectionRequest.current) return
      setInspectionError(redisError(cause, 'read-key', 'Chiave Redis non leggibile', 'La chiave potrebbe essere scaduta o il server non è raggiungibile. Aggiorna la lettura o la lista.'))
    } finally {
      if (request === inspectionRequest.current) setInspectionLoading(false)
    }
  }, [api])

  const selectKey = useCallback((key: string, keyRef: string) => {
    setSelectedKey(key)
    setSelectedKeyRef(keyRef)
    inspectionRef.current = null
    setInspection(null)
    setMode('keys')
    void readKey(keyRef)
  }, [readKey])

  const connectSelected = useCallback(async () => {
    if (!selectedId || sessionPhase !== 'passive') return
    const request = ++sessionRequest.current
    setSessionPhase('connecting')
    setSessionError(null)
    setSessionRecovery('connect')
    resetRemoteState()
    const opened = await scan(undefined, false, undefined, selectedId, true)
    if (request !== sessionRequest.current) return
    if (!opened) {
      activeConnectionRef.current = null
      setActiveConnectionId(null)
      setSessionPhase('passive')
      return
    }
    activeConnectionRef.current = selectedId
    setActiveConnectionId(selectedId)
    setSessionPhase('connected')
  }, [resetRemoteState, scan, selectedId, sessionPhase])

  const reconnect = useCallback(async () => {
    const connectionId = activeConnectionRef.current
    if (!connectionId || sessionPhase !== 'connected') return
    const request = ++sessionRequest.current
    setSessionPhase('connecting')
    setSessionError(null)
    setSessionRecovery('reconnect')
    setScanError(null)
    try {
      await api.reconnect(connectionId)
    } catch (cause) {
      if (request !== sessionRequest.current) return
      setSessionPhase('connected')
      setSessionRecovery('reconnect')
      setSessionError(redisError(cause, 'reconnect', 'Redis non riconnesso', 'La sessione corrente resta selezionata. Riprova oppure disconnettiti.'))
      return
    }
    if (request !== sessionRequest.current) return
    const opened = await scan(currentSnapshot?.inputCursor, Boolean(currentSnapshot), undefined, connectionId, true)
    if (request !== sessionRequest.current) return
    if (!opened) {
      activeConnectionRef.current = null
      setActiveConnectionId(null)
      setSessionPhase('passive')
      return
    }
    activeConnectionRef.current = connectionId
    setActiveConnectionId(connectionId)
    setSessionPhase('connected')
    if (selectedKeyRef) void readKey(selectedKeyRef)
  }, [api, currentSnapshot, readKey, scan, selectedKeyRef, sessionPhase])

  const disconnect = useCallback(async () => {
    const connectionId = activeConnectionRef.current
    if (!connectionId || sessionPhase !== 'connected') return
    const request = ++sessionRequest.current
    setSessionPhase('disconnecting')
    setSessionError(null)
    setSessionRecovery('disconnect')
    try {
      await api.reconnect(connectionId)
    } catch (cause) {
      if (request !== sessionRequest.current) return
      setSessionPhase('connected')
      setSessionRecovery('disconnect')
      setSessionError(redisError(cause, 'disconnect', 'Redis non disconnesso', 'La sessione resta disponibile. Riprova la disconnessione prima di cambiare configurazione.'))
      return
    }
    if (request !== sessionRequest.current) return
    activeConnectionRef.current = null
    setActiveConnectionId(null)
    setSessionPhase('passive')
    resetRemoteState()
  }, [api, resetRemoteState, sessionPhase])

  const selectConnection = useCallback((connectionId: string | null) => {
    if (connectionId === selectedId || sessionBusy) return
    const activeId = activeConnectionRef.current
    if (!activeId) {
      setSessionError(null)
      resetRemoteState()
      setSelectedId(connectionId)
      return
    }
    const request = ++sessionRequest.current
    setSessionPhase('disconnecting')
    setSessionError(null)
    setSessionRecovery('disconnect')
    void api.reconnect(activeId).then(() => {
      if (request !== sessionRequest.current) return
      activeConnectionRef.current = null
      setActiveConnectionId(null)
      resetRemoteState()
      setSelectedId(connectionId)
      setSessionPhase('passive')
    }).catch((cause) => {
      if (request !== sessionRequest.current) return
      setSessionPhase('connected')
      setSessionRecovery('disconnect')
      setSessionError(redisError(cause, 'switch-connection', 'Connessione Redis non cambiata', 'La sessione corrente resta aperta. Riprova la disconnessione, poi seleziona la nuova configurazione.'))
    })
  }, [api, resetRemoteState, selectedId, sessionBusy])

  const saveConnection = useCallback(async (input: RedisConnectionInput) => {
    const activeId = activeConnectionRef.current
    if (activeId) {
      await api.reconnect(activeId)
      sessionRequest.current += 1
      activeConnectionRef.current = null
      setActiveConnectionId(null)
      setSessionPhase('passive')
      setSessionError(null)
      resetRemoteState()
    }
    const saved = editingConnection ? await api.updateConnection(editingConnection.id, input) : await api.createConnection(input)
    await loadConnections()
    setSelectedId(saved.id)
  }, [api, editingConnection, loadConnections, resetRemoteState])

  const deleteConnection = useCallback((connection: RedisConnection) => {
    setConfirmation({ title: `Eliminare “${connection.name}”?`, detail: 'La configurazione viene rimossa dal workspace. Le chiavi sul server Redis non vengono modificate.', confirmLabel: 'Elimina connessione', destructive: true, onConfirm: () => {
      void api.deleteConnection(connection.id).then(() => {
        if (activeConnectionRef.current === connection.id) {
          sessionRequest.current += 1
          activeConnectionRef.current = null
          setActiveConnectionId(null)
          setSessionPhase('passive')
          resetRemoteState()
        }
        return loadConnections()
      }).catch((cause) => setConnectionError(redisError(cause, 'delete-connection', 'Connessione Redis non eliminata', 'La configurazione è ancora disponibile. Puoi riprovare.')))
    } })
  }, [api, loadConnections, resetRemoteState])

  useEffect(() => onContextChange?.({ connectionId: operational ? activeConnectionId : null, searching }), [activeConnectionId, onContextChange, operational, searching])
  useEffect(() => onSessionChange?.({ selectedConnectionId: selectedId, databaseIndex: selected?.database ?? initialState?.databaseIndex ?? 0, view: mode, typeFilter, inspectorTab }), [initialState?.databaseIndex, inspectorTab, mode, onSessionChange, selected?.database, selectedId, typeFilter])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- la richiesta esterna di focus è un comando edge-triggered proveniente dalla shell
  useEffect(() => { if (focusRequest > 0) { setMode('search'); setSearchFocusRequest((current) => current + 1) } }, [focusRequest])

  const openNewConnection = useCallback(() => { setEditingConnection(null); setDialogOpen(true) }, [])
  useRedisMenuCommand('redis.focusSearch', () => { setMode('search'); setSearchFocusRequest((current) => current + 1) })
  useRedisMenuCommand('redis.refresh', () => { if (operational) void scan(currentSnapshot?.inputCursor, Boolean(currentSnapshot)) })
  useRedisMenuCommand('redis.cancel', () => window.dispatchEvent(new CustomEvent('vincodelab:redis-cancel-search')))
  useRedisMenuCommand('redis.reconnect', () => { if (operational) void reconnect() })
  useRedisMenuCommand('redis.newConnection', openNewConnection)

  const applyFilters = useCallback((nextFilter: string, nextType: RedisKeyTypeFilter) => {
    setFilter(nextFilter)
    setTypeFilter(nextType)
    setSelectedKey(null)
    setSelectedKeyRef(null)
    inspectionRef.current = null
    setInspection(null)
    void scan(undefined, false, { filter: nextFilter, type: nextType })
  }, [scan])

  const showNextPage = useCallback(() => { void scan(page.cursor) }, [page.cursor, scan])
  const showPreviousPage = useCallback(() => setPageIndex((current) => Math.max(0, current - 1)), [])
  const refreshPage = useCallback(() => { void scan(currentSnapshot?.inputCursor, Boolean(currentSnapshot)) }, [currentSnapshot, scan])
  const handleVisibleMatchesChange = useCallback((matches: readonly RedisPayloadMatch[]) => { visibleMatchesRef.current = matches }, [])
  const handleKeySelect = useCallback((key: RedisKeySummary) => selectKey(key.key, key.keyRef), [selectKey])
  const handlePayloadMatchOpen = useCallback((match: RedisPayloadMatch) => selectKey(match.key, match.keyRef), [selectKey])
  const loadMoreInspection = useCallback(() => { if (selectedKeyRef) void readKey(selectedKeyRef, true) }, [readKey, selectedKeyRef])
  const refreshInspection = useCallback(() => { if (selectedKeyRef) void readKey(selectedKeyRef) }, [readKey, selectedKeyRef])

  const contextKey = useCallback((keyRef: string) => {
    const summary = page.keys.find((item) => item.keyRef === keyRef)
    if (summary) return { key: summary.key, keyRef: summary.keyRef, binary: summary.binary }
    if (inspection?.keyRef === keyRef) return { key: inspection.key, keyRef: inspection.keyRef, binary: inspection.binary }
    const match = visibleMatchesRef.current.find((item) => item.keyRef === keyRef)
    return match ? { key: match.key, keyRef: match.keyRef, binary: match.binary } : null
  }, [inspection, page.keys])

  const copyContextText = useCallback((text: string, successTitle: string) => {
    const write = () => navigator.clipboard.writeText(text).then(() => {
      toast.success(successTitle)
    }).catch((cause) => {
      const incident = redisError(cause, 'copy-redis-context', 'Contenuto Redis non copiato', 'Gli appunti non sono accessibili. I dati visibili non sono stati modificati.')
      toast.error(incident.title, {
        description: `${incident.description} Riferimento ${incident.correlationId}.`,
        dedupeKey: incident.operation,
        recoveryAction: { label: 'Riprova', onClick: () => { void write() } },
      })
    })
    void write()
  }, [])

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.contextKind !== 'redis-key' || !action.contextId) return
    const target = contextKey(action.contextId)
    if (!target) return
    if (action.command === 'redisKey.open' || action.command === 'redisKey.refresh') {
      selectKey(target.key, target.keyRef)
      return
    }
    if (action.command === 'redisKey.searchPayload') {
      setMode('search')
      setSearchKeyRequest({ keyPattern: target.key, keyRef: target.keyRef, nonce: Date.now() })
      setSearchFocusRequest((current) => current + 1)
      return
    }
    if (action.command === 'redisKey.copyName') {
      copyContextText(target.key, 'Nome chiave Redis copiato.')
      return
    }
    if (action.command !== 'redisKey.copyVisibleValue') return
    const visibleValue = mode === 'keys'
      ? inspectorTab === 'value' && inspection?.keyRef === target.keyRef ? visibleInspectionValue(inspection) : undefined
      : visibleMatchesRef.current.find((match) => match.keyRef === target.keyRef)?.excerpt
    if (visibleValue === undefined) {
      toast.warning('Valore Redis non visibile', { description: 'Apri la chiave nell’inspector prima di copiarne il valore.' })
      return
    }
    copyContextText(visibleValue, 'Valore Redis visibile copiato.')
  }, [contextKey, copyContextText, inspection, inspectorTab, mode, selectKey])
  useEffect(() => { contextActionHandlerRef.current = handleContextAction }, [handleContextAction])
  useEffect(() => redisBridge.contextMenu.onAction((action) => contextActionHandlerRef.current(action)), [])

  const sessionErrorAction = sessionRecovery === 'disconnect' && operational
    ? { label: 'Riprova disconnessione', onClick: disconnect }
    : sessionRecovery === 'reconnect' && operational
      ? { label: 'Riprova riconnessione', onClick: reconnect }
      : { label: 'Riprova connessione', onClick: connectSelected }

  return <Splitter.Root asChild defaultFixedSize={330} panels={panels} storageKey={`vincodelab.redis.browser-width:${workspace}`}><section aria-busy={loadingConnections || sessionBusy} aria-label="Workspace Redis" className={rs.workspace}>
    <Splitter.Panel id="redis-browser"><RedisKeyBrowser cursorDepth={pageIndex} disabled={!operational} error={scanError} filter={filter} hasMore={page.hasMore} keys={page.keys} loading={scanLoading} selectedKey={selectedKeyRef} typeFilter={typeFilter} onFilter={applyFilters} onNext={showNextPage} onPrevious={showPreviousPage} onRefresh={refreshPage} onSelect={handleKeySelect} /></Splitter.Panel>
    <Splitter.ResizeTrigger aria-label="Ridimensiona browser Redis" id="redis-browser:redis-content"><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
    <Splitter.Panel id="redis-content"><Tabs.Root asChild value={mode} onValueChange={({ value }) => setMode(value as 'keys' | 'search')}><main className={rs.main}>
      <header className={rs.toolbar}>
        <div className={rs.connectionBlock}>{selected ? <><Database aria-hidden="true" size={16} /><strong className={rs.connectionName}>{selected.name}</strong><span className={rs.meta}>DB {selected.database} · {selected.mode === 'sentinel' ? `Sentinel ${selected.sentinelMasterName} · ` : ''}{selected.host}:{selected.port}</span></> : <strong className={rs.connectionName}>Redis</strong>}</div>
        <div className={rs.connectionBlock}>{connections.length > 0 && <div className={rs.connectionSelect}><SelectField aria-label="Configurazione Redis selezionata" disabled={sessionBusy} options={connectionOptions} value={selectedId ?? ''} onValueChange={(value) => selectConnection(value || null)} /></div>}{selected && <>{operational ? <><IconButton tooltip="Riconnetti e aggiorna" onClick={() => void reconnect()}><RefreshCw aria-hidden="true" size={14} /></IconButton><Button size="sm" variant="outline" onClick={() => void disconnect()}><Unplug aria-hidden="true" size={14} /> Disconnetti</Button></> : <Button disabled={sessionBusy} size="sm" onClick={() => void connectSelected()}>{sessionBusy ? <Spinner size={14} /> : <Plug aria-hidden="true" size={14} />}{sessionPhase === 'connecting' ? 'Connessione…' : sessionPhase === 'disconnecting' ? 'Disconnessione…' : 'Connetti'}</Button>}<IconButton disabled={sessionBusy} tooltip={`Modifica ${selected.name}`} onClick={() => { setEditingConnection(selected); setDialogOpen(true) }}><FilePenLine aria-hidden="true" size={14} /></IconButton><IconButton disabled={sessionBusy} tone="danger" tooltip={`Elimina ${selected.name}`} onClick={() => deleteConnection(selected)}><Trash2 aria-hidden="true" size={14} /></IconButton></>}<Button disabled={sessionBusy} size="sm" variant="outline" onClick={openNewConnection}><Plus aria-hidden="true" size={14} /> Connessione</Button></div>
      </header>
      <section className={rs.content}>
        {connectionError && <ErrorNotice action={{ label: 'Riprova caricamento', onClick: loadConnections }} className={rs.notice} error={connectionError} />}
        {operational && sessionError && <ErrorNotice action={sessionErrorAction} className={rs.notice} error={sessionError} />}
        {operational && <Tabs.List aria-label="Viste Redis" className={rs.viewTabs}><Tabs.Trigger value="keys">Inspector</Tabs.Trigger><Tabs.Trigger value="search"><Search aria-hidden="true" size={13} /> Cerca nei payload</Tabs.Trigger><Tabs.Indicator /></Tabs.List>}
        <div className={rs.viewPanel}>{operational && activeConnectionId ? <><Tabs.Content className={rs.viewPanel} value="keys"><RedisKeyInspector error={inspectionError} inspection={inspection} loading={inspectionLoading} selectedKey={selectedKey} tab={inspectorTab} onLoadMore={loadMoreInspection} onRefresh={refreshInspection} onTabChange={setInspectorTab} /></Tabs.Content><Tabs.Content className={rs.viewPanel} value="search"><RedisPayloadSearch connectionId={activeConnectionId} focusRequest={searchFocusRequest} keyRequest={searchKeyRequest} onOpenKey={handlePayloadMatchOpen} onSearchingChange={setSearching} onVisibleMatchesChange={handleVisibleMatchesChange} /></Tabs.Content></> : sessionBusy ? <div className={rs.centerState} role="status"><Spinner size={20} /><span>{sessionPhase === 'connecting' ? 'Connessione a Redis…' : 'Disconnessione da Redis…'}</span></div> : selected ? <RedisConnectionGate connecting={false} connection={selected} error={sessionError} onConnect={() => void connectSelected()} /> : !loadingConnections && !connectionError ? <RedisInspectorEmpty /> : null}</div>
      </section>
    </main></Tabs.Root></Splitter.Panel>
    {loadingConnections && <div className={rs.loadingOverlay} role="status"><Spinner size={22} /><strong>Caricamento connessioni Redis</strong><span className={rs.meta}>Recupero delle configurazioni del workspace…</span></div>}
    <RedisConnectionDialog connection={editingConnection} open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={saveConnection} onTest={(input) => api.testConnection(input, editingConnection?.id)} />
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
  </section></Splitter.Root>
}

export type { RedisWorkbenchContext, RedisWorkspaceSession }
