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
  const [connectionReady, setConnectionReady] = useState(false)
  const [preparedConnectionId, setPreparedConnectionId] = useState<string | null>(null)
  const [resourceError, setResourceError] = useState<UserError | null>(null)
  const [resourceRecovery, setResourceRecovery] = useState<'connect' | 'refresh' | 'load-more' | 'local' | null>(null)
  const [localResourceRevision, setLocalResourceRevision] = useState(0)
  const [savedQueries, setSavedQueries] = useState<DatabaseSavedQuery[]>([])
  const [history, setHistory] = useState<DatabaseHistoryEntry[]>([])
  const [schema, setSchema] = useState<DatabaseSchema>({ tables: [], routines: [] })
  const [schemaNextOffset, setSchemaNextOffset] = useState<number | null>(null)
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
      setConnectionReady(false)
      setPreparedConnectionId(connectionId)
      setResourceError(null)
      setResourceRecovery(null)
      setSchema({ tables: [], routines: [] })
      setSchemaNextOffset(null)
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

  const connect = useCallback(async (options: { force?: boolean; preserveSchema?: boolean } = {}) => {
    if (!connectionId || preparedConnectionId !== connectionId) return false
    const preserveReadyState = Boolean(options.preserveSchema && connectionReady)
    const request = ++schemaRequest.current
    setLoadingResources(true)
    setConnectionReady(preserveReadyState)
    setResourceError(null)
    setResourceRecovery(null)
    if (!options.preserveSchema) {
      setSchema({ tables: [], routines: [] })
      setSchemaNextOffset(null)
    }
    try {
      await databaseBridge.database.connect(connectionId)
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(true)
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(preserveReadyState)
      setResourceRecovery('connect')
      setResourceError(reportDatabaseFailure(
        error,
        'connect-database',
        'Connessione database non pronta',
        'Query, bozze e risultati precedenti sono rimasti al sicuro. Verifica la configurazione e riprova la connessione.',
      ))
      if (request === schemaRequest.current) setLoadingResources(false)
      return false
    }
    try {
      const page = await databaseBridge.database.inspectSchema(connectionId, {
        force: options.force,
        offset: 0,
        limit: schemaPageSize,
      }) as DatabaseSchemaPage
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setSchema({ tables: page.tables, routines: page.routines })
      setSchemaNextOffset(pageNextOffset(page))
      setConnectionReady(true)
      setResourceError(null)
      setResourceRecovery(null)
      setSchemaFilter('')
      setTableFilter('')
      const restoredTable = page.tables.some((table) => table.name === desiredTableName.current) ? desiredTableName.current : null
      if (restoredTable) {
        desiredTableName.current = null
        setSelectedTableName(restoredTable)
      } else if (!page.hasMore) {
        desiredTableName.current = null
      }
      return true
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return false
      setConnectionReady(true)
      setResourceRecovery('refresh')
      setResourceError(reportDatabaseFailure(
        error,
        options.preserveSchema ? 'refresh-database-schema' : 'load-database-schema',
        options.preserveSchema ? 'Schema database non aggiornato' : 'Schema database non caricato',
        options.preserveSchema
          ? 'La connessione e le risorse già caricate restano disponibili. Riprova l’aggiornamento quando vuoi.'
          : 'La connessione è attiva: puoi eseguire query anche senza l’elenco delle risorse. Riprova il caricamento dello schema quando vuoi.',
      ))
      return false
    } finally {
      if (request === schemaRequest.current) setLoadingResources(false)
    }
  }, [connectionId, connectionReady, getSelectedConnectionId, preparedConnectionId])

  const loadMoreSchema = useCallback(async () => {
    if (!connectionId || !connectionReady || schemaNextOffset === null || loadingMoreSchema) return
    const request = schemaRequest.current
    const offset = schemaNextOffset
    setLoadingMoreSchema(true)
    setResourceError(null)
    setResourceRecovery(null)
    try {
      const page = await databaseBridge.database.inspectSchema(connectionId, { offset, limit: schemaPageSize }) as DatabaseSchemaPage
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return
      setSchema((current) => mergeSchema(current, page))
      setSchemaNextOffset(pageNextOffset(page))
      setResourceRecovery(null)
      if (page.tables.some((table) => table.name === desiredTableName.current)) {
        const restoredTable = desiredTableName.current
        desiredTableName.current = null
        setSelectedTableName(restoredTable)
      } else if (!page.hasMore) {
        desiredTableName.current = null
      }
    } catch (error) {
      if (request !== schemaRequest.current || getSelectedConnectionId() !== connectionId) return
      setResourceRecovery('load-more')
      setResourceError(reportDatabaseFailure(
        error,
        'load-more-schema-resources',
        'Altre risorse dello schema non caricate',
        'Le tabelle e le routine già disponibili sono rimaste visibili. Riprova il caricamento progressivo.',
      ))
    } finally {
      if (request === schemaRequest.current) setLoadingMoreSchema(false)
    }
  }, [connectionId, connectionReady, getSelectedConnectionId, loadingMoreSchema, schemaNextOffset])

  const retryResources = useCallback(() => {
    if (resourceRecovery === 'local') {
      setLocalResourceRevision((current) => current + 1)
      return
    }
    if (resourceRecovery === 'load-more') {
      void loadMoreSchema()
      return
    }
    void connect({ force: resourceRecovery === 'refresh', preserveSchema: resourceRecovery === 'refresh' })
  }, [connect, loadMoreSchema, resourceRecovery])

  useEffect(() => {
    if (!connectionId || !connectionReady || !selectedTableName) return
    const request = ++tableRequest.current
    const timer = window.setTimeout(() => {
      setTableLoading(true)
      setTableError(null)
      void databaseBridge.database.tableRows(connectionId, selectedTableName, { filter: tableFilter, limit: rowLimit }).then((page) => {
        if (request !== tableRequest.current || getSelectedConnectionId() !== connectionId) return
        setTablePage(page)
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
    desiredSavedQueryId,
    desiredTableName,
    history,
    loadMoreSchema,
    loadMoreTableRows,
    loadingMoreSchema,
    loadingResources,
    refreshSavedQueries,
    resourceError,
    resourceRetryLabel: resourceRecovery === 'load-more'
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
    schemaHasMore: schemaNextOffset !== null,
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
