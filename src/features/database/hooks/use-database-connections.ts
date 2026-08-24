import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserError } from '@/lib/user-error'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import {
  commitVolatileDraft,
  discardVolatileDraft,
  latestVolatileDraft,
  readVolatileDraft,
  writeVolatileDraft,
  type VolatileDraftIdentity,
} from '@/lib/volatile-draft-store'
import { databaseBridge } from '../api/database.bridge'
import {
  connectionDraftFor as toDraft,
  connectionDraftIdentity,
  connectionInput,
  defaultConnectionDraft as defaultDraft,
  parseConnectionDraft,
  sameConnectionDraft,
} from '../model/database-connections'
import type { DatabaseConnectionDraft as ConnectionDraft } from '../model/database.types'
import { reportDatabaseFailure } from '../services/database-error'

export function useDatabaseConnections(workspace: string) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [connectionError, setConnectionError] = useState<UserError | null>(null)
  const [selected, setSelected] = useState<DatabaseConnection | null>(null)
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(defaultDraft)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionDraftError, setConnectionDraftError] = useState<UserError | null>(null)
  const [connectionDraftRecoveryError, setConnectionDraftRecoveryError] = useState<{ error: UserError; identity: VolatileDraftIdentity } | null>(null)
  const selectedConnectionId = useRef<string | null>(null)
  const desiredConnectionId = useRef<string | null>(null)
  const connectionDialogOpener = useRef<HTMLElement | null>(null)
  const connectionNameInput = useRef<HTMLInputElement>(null)
  const connectionDraftRef = useRef(connectionDraft)
  const connectionDraftBaseline = useRef(connectionDraft)
  const connectionModalOpenRef = useRef(connectionModalOpen)
  const editingConnectionIdRef = useRef(editingConnectionId)

  const publishConnectionDraft = useCallback((next: ConnectionDraft | ((current: ConnectionDraft) => ConnectionDraft)) => {
    setConnectionDraft((current) => {
      const value = typeof next === 'function' ? next(current) : next
      connectionDraftRef.current = value
      writeVolatileDraft(
        connectionDraftIdentity(workspace, editingConnectionIdRef.current),
        JSON.stringify(value),
        JSON.stringify(connectionDraftBaseline.current),
      )
      return value
    })
  }, [workspace])

  const recoverConnectionDraft = useCallback((items: DatabaseConnection[]) => {
    const recovered = latestVolatileDraft('database-connection', workspace)
    if (!recovered) return
    const editingId = recovered.resource === 'new' ? null : recovered.resource
    const identity = connectionDraftIdentity(workspace, editingId)
    if (editingId && !items.some((item) => item.id === editingId)) {
      setConnectionDraftRecoveryError({
        error: reportUserError(normalizeUserError(new Error('Database connection draft target is no longer available [DB_DRAFT_TARGET_MISSING]'), {
          category: 'persistence',
          code: 'DB_DRAFT_TARGET_MISSING',
          component: 'database-workspace',
          operation: 'restore-connection-draft',
          severity: 'warning',
          title: 'Bozza connessione non ripristinata',
          description: 'La connessione associata non esiste più. La bozza non è stata applicata e puoi rimuoverla in modo esplicito.',
        })),
        identity,
      })
      return
    }
    const content = parseConnectionDraft(recovered.content)
    const baseline = parseConnectionDraft(recovered.baseline)
    if (!content || !baseline) {
      setConnectionDraftRecoveryError({
        error: reportUserError(normalizeUserError(new Error('Database connection draft is invalid [DB_DRAFT_INVALID]'), {
          category: 'persistence',
          code: 'DB_DRAFT_INVALID',
          component: 'database-workspace',
          operation: 'restore-connection-draft',
          severity: 'warning',
          title: 'Bozza connessione non leggibile',
          description: 'La bozza non è stata applicata e nessuna connessione è stata modificata. Puoi rimuovere soltanto la bozza non valida.',
        })),
        identity,
      })
      return
    }
    setConnectionDraftRecoveryError(null)
    editingConnectionIdRef.current = editingId
    connectionDraftBaseline.current = baseline
    connectionDraftRef.current = content
    connectionModalOpenRef.current = true
    setEditingConnectionId(editingId)
    setConnectionDraft(content)
    setConnectionModalOpen(true)
  }, [workspace])

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true)
    setConnectionError(null)
    try {
      const items = await databaseBridge.database.listConnections()
      setConnections(items)
      recoverConnectionDraft(items)
      setSelected((current) => {
        const desired = desiredConnectionId.current
        desiredConnectionId.current = null
        const next = items.find((item) => item.id === desired) ?? items.find((item) => item.id === current?.id) ?? items[0] ?? null
        selectedConnectionId.current = next?.id ?? null
        return next
      })
    } catch (error) {
      setConnectionError(reportDatabaseFailure(error, 'list-connections', 'Connessioni database non caricate', 'Le query e le bozze locali restano disponibili. Riprova a caricare le connessioni.'))
    } finally {
      setLoadingConnections(false)
    }
  }, [recoverConnectionDraft])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConnections(), 0)
    return () => window.clearTimeout(timer)
  }, [loadConnections])

  useEffect(() => {
    const desired = desiredConnectionId.current
    if (!desired || connections.length === 0) return
    desiredConnectionId.current = null
    const connection = connections.find((item) => item.id === desired) ?? connections[0] ?? null
    selectedConnectionId.current = connection?.id ?? null
    setSelected(connection)
  }, [connections])

  const persistConnectionDraft = useCallback(async (force = false) => {
    if (!connectionModalOpenRef.current || (!force && sameConnectionDraft(connectionDraftRef.current, connectionDraftBaseline.current))) return
    const draft = connectionDraftRef.current
    const editId = editingConnectionIdRef.current
    const input = connectionInput(draft)
    const savedConnection = editId
      ? await databaseBridge.database.updateConnection(editId, input)
      : await databaseBridge.database.createConnection(input)
    const identity = connectionDraftIdentity(workspace, editId)
    const savedContent = JSON.stringify(draft)
    commitVolatileDraft(identity, savedContent)
    connectionDraftBaseline.current = toDraft(savedConnection)
    if (editingConnectionIdRef.current !== editId || JSON.stringify(connectionDraftRef.current) !== savedContent) {
      if (!editId && editingConnectionIdRef.current === null) {
        const survivingDraft = connectionDraftRef.current
        discardVolatileDraft(identity)
        editingConnectionIdRef.current = savedConnection.id
        setEditingConnectionId(savedConnection.id)
        writeVolatileDraft(
          connectionDraftIdentity(workspace, savedConnection.id),
          JSON.stringify(survivingDraft),
          JSON.stringify(connectionDraftBaseline.current),
        )
      }
      await loadConnections()
      return
    }
    const reset = defaultDraft()
    connectionDraftRef.current = reset
    connectionDraftBaseline.current = reset
    connectionModalOpenRef.current = false
    editingConnectionIdRef.current = null
    setConnectionDraft(reset)
    setEditingConnectionId(null)
    setConnectionModalOpen(false)
    await loadConnections()
  }, [loadConnections, workspace])

  const saveConnection = useCallback(async () => {
    setConnectionDraftError(null)
    try {
      await persistConnectionDraft(true)
    } catch (error) {
      setConnectionDraftError(reportDatabaseFailure(error, 'save-connection', 'Connessione non salvata', 'I dati inseriti sono rimasti nel form. Controlla configurazione e credenziali, poi riprova.'))
    }
  }, [persistConnectionDraft])

  const openNewConnection = useCallback((opener: HTMLElement) => {
    const baseline = defaultDraft()
    const identity = connectionDraftIdentity(workspace, null)
    const recovered = readVolatileDraft(identity)
    const draft = recovered ? parseConnectionDraft(recovered.content) ?? baseline : baseline
    if (recovered) writeVolatileDraft(identity, JSON.stringify(draft), JSON.stringify(baseline))
    connectionDialogOpener.current = opener
    connectionDraftRef.current = draft
    connectionDraftBaseline.current = baseline
    connectionModalOpenRef.current = true
    editingConnectionIdRef.current = null
    setConnectionDraft(draft)
    setConnectionDraftError(null)
    setEditingConnectionId(null)
    setConnectionModalOpen(true)
  }, [workspace])

  const editConnection = useCallback((connection: DatabaseConnection, opener: HTMLElement) => {
    const baseline = toDraft(connection)
    const identity = connectionDraftIdentity(workspace, connection.id)
    const recovered = readVolatileDraft(identity)
    const draft = recovered ? parseConnectionDraft(recovered.content) ?? baseline : baseline
    if (recovered) writeVolatileDraft(identity, JSON.stringify(draft), JSON.stringify(baseline))
    connectionDialogOpener.current = opener
    connectionDraftRef.current = draft
    connectionDraftBaseline.current = baseline
    connectionModalOpenRef.current = true
    editingConnectionIdRef.current = connection.id
    setConnectionDraft(draft)
    setConnectionDraftError(null)
    setEditingConnectionId(connection.id)
    setConnectionModalOpen(true)
  }, [workspace])

  const closeConnectionModal = useCallback(() => {
    discardVolatileDraft(connectionDraftIdentity(workspace, editingConnectionIdRef.current))
    const reset = defaultDraft()
    connectionModalOpenRef.current = false
    editingConnectionIdRef.current = null
    connectionDraftRef.current = reset
    connectionDraftBaseline.current = reset
    setConnectionModalOpen(false)
    setConnectionDraftError(null)
    setEditingConnectionId(null)
    setConnectionDraft(reset)
  }, [workspace])

  const hasConnectionDraftChanges = useCallback(() => connectionModalOpenRef.current && !sameConnectionDraft(connectionDraftRef.current, connectionDraftBaseline.current), [])
  const getSelectedConnectionId = useCallback(() => selectedConnectionId.current, [])
  const publishSelectedConnectionId = useCallback((connectionId: string | null) => {
    selectedConnectionId.current = connectionId
  }, [])

  return {
    closeConnectionModal,
    connectionDialogOpener,
    connectionDraft,
    connectionDraftError,
    connectionDraftRecoveryError,
    connectionError,
    connectionModalOpen,
    connectionModalOpenRef,
    connectionNameInput,
    connections,
    desiredConnectionId,
    editConnection,
    editingConnectionId,
    hasConnectionDraftChanges,
    getSelectedConnectionId,
    loadConnections,
    loadingConnections,
    openNewConnection,
    persistConnectionDraft,
    publishConnectionDraft,
    publishSelectedConnectionId,
    saveConnection,
    selected,
    selectedConnectionId,
    setConnectionDraftRecoveryError,
    setSelected,
  }
}
