import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { DatabaseConnection, DatabaseHistoryEntry, DatabaseQueryResult, DatabaseTablePage } from '@/bridge'
import { toast } from '@/components/ui'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { isMutativeSql } from '../model/database-query'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { databaseBridge } from '../api/database.bridge'
import type { QueryHistoryRefreshFailure } from '../model/database.types'
import { reportDatabaseFailure } from '../services/database-error'

type UseDatabaseQueryOptions = {
  activeSql: () => string
  beginExecutionRequest: () => number
  confirmMutations: boolean
  connectionReady: boolean
  databaseView: 'sql' | 'data'
  focusEditor: () => void
  getSelectedConnectionId: () => string | null
  invalidateExecutionRequest: () => void
  isExecutionRequestCurrent: (request: number) => boolean
  queryTimeoutMs: number
  rowLimit: number
  selected: DatabaseConnection | null
  selectedTableName: string | null
  setConfirmation: Dispatch<SetStateAction<ConfirmationRequest | null>>
  setDatabaseView: Dispatch<SetStateAction<'sql' | 'data'>>
  setHistory: Dispatch<SetStateAction<DatabaseHistoryEntry[]>>
  setSelectedTableName: Dispatch<SetStateAction<string | null>>
  setTableError: Dispatch<SetStateAction<UserError | null>>
  setTablePage: Dispatch<SetStateAction<DatabaseTablePage | null>>
  workspace: string
}

export function useDatabaseQuery({
  activeSql,
  beginExecutionRequest,
  confirmMutations,
  connectionReady,
  databaseView,
  focusEditor,
  getSelectedConnectionId,
  invalidateExecutionRequest,
  isExecutionRequestCurrent,
  queryTimeoutMs,
  rowLimit,
  selected,
  selectedTableName,
  setConfirmation,
  setDatabaseView,
  setHistory,
  setSelectedTableName,
  setTableError,
  setTablePage,
  workspace,
}: UseDatabaseQueryOptions) {
  const [result, setResult] = useState<DatabaseQueryResult | null>(null)
  const [lastExecutedSql, setLastExecutedSql] = useState('')
  const [executing, setExecuting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [queryError, setQueryError] = useState<UserError | null>(null)
  const [queryErrorRecovery, setQueryErrorRecovery] = useState<'run' | 'cancel'>('run')
  const [queryHistoryRefreshFailure, setQueryHistoryRefreshFailure] = useState<QueryHistoryRefreshFailure | null>(null)
  const resultsRegion = useRef<HTMLElement>(null)
  const pendingResultsFocus = useRef(false)
  const executingRef = useRef(false)
  const activeQuery = useRef<{ operationId: string; connectionId: string; mutative: boolean } | null>(null)

  async function cancelActiveQueryForContextChange() {
    const active = activeQuery.current
    if (!active) return null
    invalidateExecutionRequest()
    setCancelling(true)
    try {
      const outcome = await databaseBridge.database.cancel(active.operationId)
      const stillActive = activeQuery.current?.operationId === active.operationId
      if (!outcome.cancelled && stillActive) throw new Error('La query Database in corso non può essere annullata in sicurezza. Attendi il completamento e riprova.')
      if (stillActive) {
        activeQuery.current = null
        executingRef.current = false
        setExecuting(false)
      }
      return outcome
    } catch (error) {
      if (activeQuery.current?.operationId !== active.operationId) return null
      throw error
    } finally {
      setCancelling(false)
    }
  }

  async function cancelActiveQuery(announce = true) {
    try {
      const outcome = await cancelActiveQueryForContextChange()
      if (!outcome) {
        setQueryError(null)
        return
      }
      setQueryError(null)
      if (!announce) return
      if (outcome.mutative) toast.warning('Annullamento richiesto.', { description: 'La modifica potrebbe essere già stata applicata. Verifica i dati prima di ripetere la query.' })
      else if (outcome.cancelled) toast.info('Query annullata.', { description: 'Puoi eseguirne subito un’altra.' })
    } catch (error) {
      setQueryErrorRecovery('cancel')
      setQueryError(reportDatabaseFailure(
        error,
        'cancel-query',
        announce ? 'Query non annullata' : 'Query precedente non annullata',
        announce
          ? 'La query resta in corso. Attendi il completamento oppure riprova l’annullamento.'
          : 'Il cambio di contesto è proseguito, ma la query precedente potrebbe essere ancora in corso. Controlla la connessione prima di ripeterla.',
      ))
    }
  }

  async function execute(confirmed = false, offset = 0, query = activeSql()) {
    if (!selected || !connectionReady || !query.trim() || executingRef.current) return
    const connectionId = selected.id
    const operationId = crypto.randomUUID()
    const mutative = isMutativeSql(query)
    const request = beginExecutionRequest()
    executingRef.current = true
    activeQuery.current = { operationId, connectionId, mutative }
    setExecuting(true)
    setCancelling(false)
    setQueryErrorRecovery('run')
    setQueryError(null)
    setDatabaseView('sql')
    try {
      const nextResult = await databaseBridge.database.execute(connectionId, query, { operationId, confirmed, offset, limit: rowLimit, timeoutMs: queryTimeoutMs })
      if (!isExecutionRequestCurrent(request) || getSelectedConnectionId() !== connectionId) return
      setLastExecutedSql(query)
      setResult((current) => offset > 0 && current ? { ...nextResult, rows: [...current.rows, ...nextResult.rows], columns: current.columns } : nextResult)
      setSelectedTableName(null)
      setTablePage(null)
      setTableError(null)
      pendingResultsFocus.current = true
      setDatabaseView('data')
      const historyWasRecorded = nextResult.historyRecorded !== false
      if (!historyWasRecorded) {
        setQueryHistoryRefreshFailure({
          connectionId,
          error: reportUserError(normalizeUserError(new Error('database query history write failed'), {
            category: 'persistence',
            code: 'DATABASE_HISTORY_WRITE_FAILED',
            component: 'database-workspace',
            description: 'La query è stata eseguita e i risultati sono disponibili, ma questa voce non è stata salvata nella cronologia. Non rieseguire la query per questo avviso.',
            operation: 'record-query-history',
            severity: 'warning',
            title: 'Query completata, cronologia non salvata',
          })),
          recovery: 'copy-query',
          sql: query,
        })
      }
      try {
        const nextHistory = await databaseBridge.database.listHistory(connectionId)
        if (!isExecutionRequestCurrent(request) || getSelectedConnectionId() !== connectionId) return
        setHistory(nextHistory)
        if (historyWasRecorded) setQueryHistoryRefreshFailure(null)
      } catch (historyError) {
        if (!isExecutionRequestCurrent(request) || getSelectedConnectionId() !== connectionId) return
        if (!historyWasRecorded) return
        const error = reportUserError(normalizeUserError(historyError, {
          category: 'database',
          component: 'database-workspace',
          description: 'I risultati e le modifiche della query sono stati conservati. Aggiorna soltanto la cronologia per sincronizzare l’elenco.',
          operation: 'refresh-query-history',
          severity: 'warning',
          title: 'Query completata, cronologia non aggiornata',
        }))
        setQueryHistoryRefreshFailure({ connectionId, error, recovery: 'refresh-history' })
      }
    } catch (error) {
      if (!isExecutionRequestCurrent(request) || getSelectedConnectionId() !== connectionId) return
      setQueryErrorRecovery('run')
      setQueryError(reportDatabaseFailure(error, 'execute-query', 'Query non eseguita', 'Il testo della query e gli ultimi risultati sono stati mantenuti. Correggi il problema e riprova.'))
      requestAnimationFrame(focusEditor)
    } finally {
      if (activeQuery.current?.operationId === operationId) activeQuery.current = null
      executingRef.current = false
      setExecuting(false)
      setCancelling(false)
    }
  }

  async function retryQueryHistoryRefresh(connectionId: string) {
    const nextHistory = await databaseBridge.database.listHistory(connectionId)
    if (getSelectedConnectionId() !== connectionId) return
    setHistory(nextHistory)
    setQueryHistoryRefreshFailure((current) => current?.connectionId === connectionId ? null : current)
  }

  function requestRun() {
    const query = activeSql()
    if (isMutativeSql(query)) {
      if (!confirmMutations) {
        void execute(true, 0, query)
        return
      }
      setConfirmation({
        title: 'Conferma query mutativa',
        detail: query,
        confirmLabel: 'Esegui query',
        onConfirm: () => void execute(true, 0, query),
      })
      return
    }
    void execute(false, 0, query)
  }

  useEffect(() => () => {
    const active = activeQuery.current
    if (active) void databaseBridge.database.cancel(active.operationId).catch((error) => {
      reportDatabaseFailure(
        error,
        'cancel-query-on-unmount',
        'Annullamento query non confermato',
        'La vista Database è stata chiusa prima di confermare l’annullamento. Verifica la connessione prima di eseguire una nuova query.',
        'warning',
      )
    })
  }, [workspace])

  useEffect(() => {
    if (!pendingResultsFocus.current || databaseView !== 'data' || selectedTableName || !result) return
    const frame = requestAnimationFrame(() => {
      const region = resultsRegion.current
      if (!region || region.getClientRects().length === 0) return
      region.focus()
      if (document.activeElement === region) pendingResultsFocus.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [databaseView, result, selectedTableName])

  return {
    activeQuery,
    cancelActiveQuery,
    cancelActiveQueryForContextChange,
    cancelling,
    execute,
    executing,
    executingRef,
    lastExecutedSql,
    queryError,
    queryErrorRecovery,
    queryHistoryRefreshFailure,
    requestRun,
    result,
    resultsRegion,
    retryQueryHistoryRefresh,
    setQueryHistoryRefreshFailure,
    setResult,
  }
}
