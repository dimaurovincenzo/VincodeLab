import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserError } from '@/lib/user-error'
import { readVolatileDraft } from '@/lib/volatile-draft-store'
import { databaseBridge } from '../api/database.bridge'
import { defaultSql, sqlDraftIdentity } from '../model/database-connections'
import type { DatabaseSchema, DatabaseSchemaPage } from '../model/database.types'
import { reportDatabaseFailure, showDatabaseWarningToast } from '../services/database-error'

const schemaPageSize = 40

type UseDatabaseResourcesOptions = {
  connectionId: string | null
  getSelectedConnectionId: () => string | null
  invalidateExecutionRequest: () => void
  publishSqlBaseline: (content: string, savedQueryId: string | null) => void
  publishTransactionActive: (active: boolean, connectionId?: string | null) => void
  restoreSqlDraft: (content: string, baseline: string) => void
  rowLimit: number
  publishSelectedConnectionId: (connectionId: string | null) => void
  workspace: string
}

type SchemaLoadProgress = {
  complete: boolean
  loaded: number
  total: number | null
}

function pageNextOffset(page: DatabaseSchemaPage) {
  if (!page.hasMore) return null
  if (typeof page.nextOffset === 'number') return page.nextOffset
  return (page.offset ?? 0) + schemaPageSize
}

function mergeSchema(current: DatabaseSchema, page: DatabaseSchemaPage): DatabaseSchema {
  const tables = new Map(current.tables.map((table) => [table.name, table]))
  const routines = new Map(current.routines.map((routine) => [`${routine.kind}:${routine.name}`, routine]))
  for (const table of page.tables) tables.set(table.name, table)
  for (const routine of page.routines) routines.set(`${routine.kind}:${routine.name}`, routine)
  return { tables: [...tables.values()], routines: [...routines.values()] }
}

function mergeInspectedTable(current: DatabaseSchema, table: DatabaseTableSchema): DatabaseSchema {
  const tables = current.tables.map((candidate) => candidate.name === table.name ? table : candidate)
  return tables.some((candidate) => candidate.name === table.name)
    ? { ...current, tables }
    : { ...current, tables: [...tables, table] }
}

export function useDatabaseResources({
  connectionId,
  getSelectedConnectionId,
  invalidateExecutionRequest,
  publishSqlBaseline,
  publishTransactionActive,
  restoreSqlDraft,
  rowLimit,
  publishSelectedConnectionId,
  workspace,
}: UseDatabaseResourcesOptions) {
  const [loadingResources, setLoadingResources] = useState(false)
  const [loadingMoreSchema, setLoadingMoreSchema] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectPending, setDisconnectPending] = useState(false)
  const [connectionReady, setConnectionReady] = useState(false)
  const [preparedConnectionId, setPreparedConnectionId] = useState<string | null>(null)
  const [resourceError, setResourceError] = useState<UserError | null>(null)
  const [resourceRecovery, setResourceRecovery] = useState<'connect' | 'disconnect' | 'refresh' | 'load-more' | 'local' | null>(null)
  const [localResourceRevision, setLocalResourceRevision] = useState(0)
  const [savedQueries, setSavedQueries] = useState<DatabaseSavedQuery[]>([])
  const [history, setHistory] = useState<DatabaseHistoryEntry[]>([])
  const [schema, setSchema] = useState<DatabaseSchema>({ tables: [], routines: [] })
  const [schemaProgress, setSchemaProgress] = useState<SchemaLoadProgress | null>(null)
  const [schemaFilter, setSchemaFilter] = useState('')
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState('')
  const [tablePage, setTablePage] = useState<DatabaseTablePage | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<UserError | null>(null)
  const [tableRevision, setTableRevision] = useState(0)
  const desiredSavedQueryId = useRef<string | null>(null)
  const desiredTableName = useRef<string | null>(null)
  const localResourceRequest = useRef(0)
  const schemaRequest = useRef(0)
  const schemaRef = useRef<DatabaseSchema>({ tables: [], routines: [] })
  const schemaNextOffsetRef = useRef<number | null>(null)
  const schemaTotalRef = useRef<number | null>(null)
  const tableRequest = useRef(0)

  useEffect(() => {
    const request = ++localResourceRequest.current
    ++schemaRequest.current
    let current = true
    publishSelectedConnectionId(connectionId)
    invalidateExecutionRequest()
    const recoveredSql = readVolatileDraft(sqlDraftIdentity(workspace, connectionId))
    queueMicrotask(() => {
      if (!current || request !== localResourceRequest.current) return
      setLoadingResources(false)
      setLoadingMoreSchema(false)
      setDisconnecting(false)
      setDisconnectPending(false)
      setConnectionReady(false)
      setPreparedConnectionId(connectionId)
      setResourceError(null)
      setResourceRecovery(null)
      schemaRef.current = { tables: [], routines: [] }
      schemaNextOffsetRef.current = null
      schemaTotalRef.current = null
      setSchema(schemaRef.current)
      setSchemaProgress(null)
      publishTransactionActive(false)
      setSelectedTableName(null)
      setTablePage(null)
      setTableError(null)
      if (!connectionId) {
        setSavedQueries([])
        setHistory([])
        if (recoveredSql) restoreSqlDraft(recoveredSql.content, recoveredSql.baseline)
      }
    })
    if (!connectionId) {
      return () => { current = false }
    }

    void Promise.all([
      databaseBridge.database.listSavedQueries(connectionId),
      databaseBridge.database.listHistory(connectionId),
    ]).then(([queries, entries]) => {
      if (!current || request !== localResourceRequest.current || getSelectedConnectionId() !== connectionId) return
      const restoredQuery = queries.find((query) => query.id === desiredSavedQueryId.current) ?? null
      desiredSavedQueryId.current = null
      setSavedQueries(queries)
      setHistory(entries)
      setResourceRecovery(null)
      if (recoveredSql) restoreSqlDraft(recoveredSql.content, recoveredSql.baseline)
      else if (restoredQuery) publishSqlBaseline(restoredQuery.sql, restoredQuery.id)
      else publishSqlBaseline(defaultSql, null)
    }).catch((error) => {
      if (!current || request !== localResourceRequest.current || getSelectedConnectionId() !== connectionId) return
      setSavedQueries([])
      setHistory([])
      setResourceRecovery('local')
      setResourceError(reportDatabaseFailure(
        error,
        'load-local-database-resources',
        'Query salvate e cronologia non disponibili',
        'La connessione non è stata aperta. Puoi comunque connetterti e riprovare a caricare i dati locali.',
        'warning',
      ))
    })
    return () => { current = false }
  }, [connectionId, getSelectedConnectionId, invalidateExecutionRequest, localResourceRevision, publishSelectedConnectionId, publishSqlBaseline, publishTransactionActive, restoreSqlDraft, workspace])

  const loadSchemaSequence = useCallback(async ({
    force = false,
    request,
    reset,
    startOffset,
    targetConnectionId,
  }: {
    force?: boolean
    request: number
    reset: boolean
    startOffset: number
    targetConnectionId: string
  }) => {
    let firstPage = true
    let offset: number | null = startOffset
    setLoadingMoreSchema(true)
    try {
      while (offset !== null) {
        const page = await databaseBridge.database.inspectSchema(targetConnectionId, {
          ...(firstPage && force ? { force: true } : {}),
          offset,
          limit: schemaPageSize,
        }) as DatabaseSchemaPage
        if (request !== schemaRequest.current || getSelectedConnectionId() !== targetConnectionId) return false

        const nextSchema = reset && firstPage
          ? { tables: page.tables, routines: page.routines }
          : mergeSchema(schemaRef.current, page)
        const nextOffset = pageNextOffset(page)
        const nextTotal = typeof page.totalResources === 'number' ? page.totalResources : schemaTotalRef.current
        schemaRef.current = nextSchema
        schemaNextOffsetRef.current = nextOffset
        schemaTotalRef.current = nextTotal
        setSchema(nextSchema)
        setSchemaProgress({
          complete: nextOffset === null,
          loaded: nextSchema.tables.length + nextSchema.routines.length,
          total: nextOffset === null && nextTotal === null ? nextSchema.tables.length + nextSchema.routines.length : nextTotal,
        })
        firstPage = false
        offset = nextOffset
      }
      return true
    } finally {
      if (request === schemaRequest.current) setLoadingMoreSchema(false)
    }
  }, [getSelectedConnectionId])

  const recoverSchemaSession = useCallback(async (targetConnectionId: string, request: number) => {
    await databaseBridge.database.connect(targetConnectionId)
    return request === schemaRequest.current && getSelectedConnectionId() === targetConnectionId
  }, [getSelectedConnectionId])

  const connect = useCallback(async (options: { force?: boolean; preserveSchema?: boolean } = {}) => {
    if (!connectionId || preparedConnectionId !== connectionId || disconnectPending) return false
    const preserveReadyState = Boolean(options.preserveSchema && connectionReady)
    const request = ++schemaRequest.current
    setLoadingResources(true)
    setConnectionReady(preserveReadyState)
    setResourceError(null)
    setResourceRecovery(null)
    setSchemaProgress({
      complete: false,
      loaded: options.preserveSchema ? schemaRef.current.tables.length + schemaRef.current.routines.length : 0,
      total: options.preserveSchema ? schemaTotalRef.current : null,
    })
    if (!options.preserveSchema) {
      schemaRef.current = { tables: [], routines: [] }
      schemaNextOffsetRef.current = null
      schemaTotalRef.current = null
      setSchema(schemaRef.current)
    }
    try {
      await databaseBridge.database.connect(connectionId)
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(true)
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(preserveReadyState)
      setSchemaProgress(null)
      setResourceRecovery('connect')
      setResourceError(reportDatabaseFailure(
        error,
        'connect-database',
        'Connessione database non pronta',
        'Query, bozze e risultati precedenti sono rimasti al sicuro. Verifica la configurazione e riprova la connessione.',
      ))
      return false
    }
    try {
      const completed = await loadSchemaSequence({ force: options.force, request, reset: true, startOffset: 0, targetConnectionId: connectionId })
      if (!completed || request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(true)
      setResourceError(null)
      setResourceRecovery(null)
      setSchemaFilter('')
      setTableFilter('')
      const restoredTable = schemaRef.current.tables.some((table) => table.name === desiredTableName.current) ? desiredTableName.current : null
      desiredTableName.current = null
      if (restoredTable) setSelectedTableName(restoredTable)
      return true
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      const partial = schemaRef.current.tables.length + schemaRef.current.routines.length > 0
      try {
        if (!await recoverSchemaSession(connectionId, request)) return false
        setConnectionReady(true)
        setResourceRecovery(partial && schemaNextOffsetRef.current !== null ? 'load-more' : 'refresh')
        setResourceError(reportDatabaseFailure(
          error,
          partial ? 'continue-database-schema' : options.preserveSchema ? 'refresh-database-schema' : 'load-database-schema',
          partial ? 'Caricamento schema interrotto' : options.preserveSchema ? 'Schema database non aggiornato' : 'Schema database non caricato',
          partial
            ? 'Le risorse già caricate restano disponibili. Riprendi il caricamento progressivo dal punto interrotto.'
            : options.preserveSchema
              ? 'La connessione e le risorse già caricate restano disponibili. Riprova l’aggiornamento quando vuoi.'
              : 'La connessione è attiva: puoi eseguire query anche senza l’elenco delle risorse. Riprova il caricamento dello schema quando vuoi.',
        ))
      } catch (recoveryError) {
        if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
        setConnectionReady(false)
        setResourceRecovery('connect')
        setResourceError(reportDatabaseFailure(
          recoveryError,
          'recover-database-after-schema',
          'Connessione database da ripristinare',
          'Lo schema non è stato caricato e la sessione non è più disponibile. Riconnettiti per continuare; query e bozze sono rimaste al sicuro.',
        ))
      }
      return false
    } finally {
      if (request === schemaRequest.current) setLoadingResources(false)
    }
  }, [connectionId, connectionReady, disconnectPending, getSelectedConnectionId, loadSchemaSequence, preparedConnectionId, recoverSchemaSession])

  const resumeSchema = useCallback(async () => {
    const offset = schemaNextOffsetRef.current
    if (!connectionId || !connectionReady || offset === null || loadingMoreSchema) return false
    const request = ++schemaRequest.current
    setLoadingResources(true)
    setResourceError(null)
    setResourceRecovery(null)
    setSchemaProgress((current) => current ? { ...current, complete: false } : current)
    try {
      const completed = await loadSchemaSequence({ request, reset: false, startOffset: offset, targetConnectionId: connectionId })
      if (!completed || request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setResourceError(null)
      setResourceRecovery(null)
      return true
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      try {
        if (!await recoverSchemaSession(connectionId, request)) return false
        setConnectionReady(true)
        setResourceRecovery('load-more')
        setResourceError(reportDatabaseFailure(error, 'continue-database-schema', 'Caricamento schema interrotto', 'Le risorse già caricate restano disponibili. Riprendi dal punto interrotto.'))
      } catch (recoveryError) {
        if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
        setConnectionReady(false)
        setResourceRecovery('connect')
        setResourceError(reportDatabaseFailure(recoveryError, 'recover-database-after-schema', 'Connessione database da ripristinare', 'Le risorse già caricate restano visibili, ma devi riconnetterti per continuare.'))
      }
      return false
    } finally {
      if (request === schemaRequest.current) setLoadingResources(false)
    }
  }, [connectionId, connectionReady, getSelectedConnectionId, loadSchemaSequence, loadingMoreSchema, recoverSchemaSession])

  const disconnect = useCallback(async () => {
    if (!connectionId || (!connectionReady && !disconnectPending) || disconnecting) return false
    const request = ++schemaRequest.current
    ++tableRequest.current
    setDisconnecting(true)
    setDisconnectPending(true)
    setConnectionReady(false)
    setLoadingResources(false)
    setLoadingMoreSchema(false)
    invalidateExecutionRequest()
    try {
      await databaseBridge.database.disconnect(connectionId)
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setDisconnectPending(false)
      schemaRef.current = { tables: [], routines: [] }
      schemaNextOffsetRef.current = null
      schemaTotalRef.current = null
      setSchema(schemaRef.current)
      setSchemaProgress(null)
      setResourceError(null)
      setResourceRecovery(null)
      setSelectedTableName(null)
      setTablePage(null)
      setTableError(null)
      publishTransactionActive(false)
      return true
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(false)
      setDisconnectPending(true)
      setResourceRecovery('disconnect')
      setResourceError(reportDatabaseFailure(error, 'disconnect-database', 'Disconnessione database non confermata', 'La sessione potrebbe essere ancora attiva. Riprova la disconnessione prima di continuare o cambiare configurazione.'))
      return false
    } finally {
      if (request === schemaRequest.current) setDisconnecting(false)
    }
  }, [connectionId, connectionReady, disconnectPending, disconnecting, getSelectedConnectionId, invalidateExecutionRequest, publishTransactionActive])

  const retryResources = useCallback(() => {
    if (resourceRecovery === 'local') {
      setLocalResourceRevision((current) => current + 1)
      return
    }
    if (resourceRecovery === 'load-more') {
      void resumeSchema()
      return
    }
    if (resourceRecovery === 'disconnect') {
      void disconnect()
      return
    }
    void connect({ force: resourceRecovery === 'refresh', preserveSchema: resourceRecovery === 'refresh' })
  }, [connect, disconnect, resourceRecovery, resumeSchema])

  useEffect(() => {
    if (!connectionId || !connectionReady || !selectedTableName) return
    const request = ++tableRequest.current
    const timer = window.setTimeout(() => {
      setTableLoading(true)
      setTableError(null)
      void databaseBridge.database.tableRows(connectionId, selectedTableName, { filter: tableFilter, limit: rowLimit }).then((page) => {
        if (request !== tableRequest.current || getSelectedConnectionId() !== connectionId) return
        setTablePage(page)
        setSchema((current) => mergeInspectedTable(current, page.table))
      }).catch((error) => {
        if (request !== tableRequest.current || getSelectedConnectionId() !== connectionId) return
        setTablePage(null)
        setTableError(reportDatabaseFailure(error, 'load-table-rows', 'Dati della tabella non caricati', 'La selezione e le modifiche locali sono rimaste disponibili. Riprova la lettura.'))
      }).finally(() => {
        if (request === tableRequest.current) setTableLoading(false)
      })
    }, tableFilter ? 220 : 0)
    return () => window.clearTimeout(timer)
  }, [connectionId, connectionReady, getSelectedConnectionId, rowLimit, selectedTableName, tableFilter, tableRevision])

  const refreshSavedQueries = useCallback(async function refreshSavedQueries(targetConnectionId: string) {
    try {
      setSavedQueries(await databaseBridge.database.listSavedQueries(targetConnectionId))
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'refresh-saved-queries', 'Elenco query salvate non aggiornato', 'L’ultima modifica è già al sicuro. Aggiorna soltanto l’elenco, senza ripetere il salvataggio o l’eliminazione.', 'warning')
      showDatabaseWarningToast(incident, { label: 'Aggiorna elenco', onClick: () => { void refreshSavedQueries(targetConnectionId) } })
    }
  }, [])

  const loadMoreTableRows = useCallback(() => {
    if (!connectionId || !connectionReady || !selectedTableName || !tablePage) return
    const request = ++tableRequest.current
    setTableLoading(true)
    setTableError(null)
    void databaseBridge.database.tableRows(connectionId, selectedTableName, { filter: tableFilter, offset: tablePage.offset + tablePage.rows.length }).then((nextPage) => {
      if (request !== tableRequest.current || getSelectedConnectionId() !== connectionId) return
      setTablePage((current) => current ? { ...nextPage, rows: [...current.rows, ...nextPage.rows], offset: current.offset } : nextPage)
    }).catch((error) => {
      if (request !== tableRequest.current || getSelectedConnectionId() !== connectionId) return
      setTableError(reportDatabaseFailure(error, 'load-more-table-rows', 'Altre righe non caricate', 'Le righe già visibili e le modifiche locali sono rimaste disponibili. Riprova.'))
    }).finally(() => {
      if (request === tableRequest.current) setTableLoading(false)
    })
  }, [connectionId, connectionReady, getSelectedConnectionId, selectedTableName, tableFilter, tablePage])

  return {
    connect,
    connectionPrepared: Boolean(connectionId && preparedConnectionId === connectionId),
    connectionReady,
    disconnectAvailable: connectionReady || disconnectPending,
    desiredSavedQueryId,
    desiredTableName,
    disconnect,
    disconnecting,
    history,
    loadMoreTableRows,
    loadingResources,
    refreshSavedQueries,
    resourceError,
    resourceRetryLabel: resourceRecovery === 'disconnect'
      ? 'Riprova disconnessione'
      : resourceRecovery === 'load-more'
      ? 'Riprova caricamento'
      : resourceRecovery === 'local'
        ? 'Ricarica dati locali'
        : resourceRecovery === 'refresh'
          ? 'Riprova aggiornamento'
          : 'Riprova connessione',
    retryResources,
    savedQueries,
    schema,
    schemaFilter,
    schemaProgress,
    selectedTableName,
    setHistory,
    setConnectionReady,
    setResourceError,
    setSavedQueries,
    setSchemaFilter,
    setSelectedTableName,
    setTableError,
    setTableFilter,
    setTablePage,
    setTableRevision,
    tableError,
    tableFilter,
    tableLoading,
    tablePage,
    tableRevision,
  }
}
