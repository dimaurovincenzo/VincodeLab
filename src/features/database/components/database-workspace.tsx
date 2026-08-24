import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history as editorHistory, historyKeymap } from '@codemirror/commands'
import { sql as sqlLanguage, MSSQL, MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { lintGutter, linter } from '@codemirror/lint'
import { AlignLeft, FilePenLine, Play, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { Button, Dialog, ErrorNotice, Field, IconButton, SelectField, Spinner, Splitter, Tabs, TreeView, createTreeCollection, toast, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { databaseBridge } from '../api/database.bridge'
import {
  connectionDraftFor as toDraft,
  connectionDraftIdentity,
  connectionInput,
  databaseDriverLabel as driverLabel,
  defaultConnectionDraft as defaultDraft,
  defaultDatabasePort as defaultPort,
  defaultSql,
  gridDraftIdentity,
  parseConnectionDraft,
  sameConnectionDraft,
  sqlDraftIdentity,
  tableLabel,
  tableSchemaName,
} from '../model/database-connections'
import {
  type DatabaseConnectionDraft as ConnectionDraft,
  type DatabaseDriver as Driver,
  type DatabaseGuardFailure,
  type DatabaseSchema,
  type DatabaseSchemaTreeNode as SchemaTreeNode,
  type DatabaseToolbarAction,
  type DatabaseWorkspaceProps as Props,
  type QueryHistoryRefreshFailure,
} from '../model/database.types'
import { reportDatabaseFailure, showDatabaseErrorToast, showDatabaseWarningToast } from '../services/database-error'
import { DatabaseSchemaTreeNodeView } from './database-schema-tree-node'
import { DatabaseTableGrid, type DatabaseTableDraftGuard } from './database-table-grid'
import { isMutativeSql, schemaTablePreviewSql } from '@/lib/database-query'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { graphiteCodeMirrorTheme } from '@/lib/codemirror-theme'
import { sqlLintSource } from '@/lib/sql-lint'
import { createSqlFormatChange } from '@/lib/sql-format'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { commitVolatileDraft, discardVolatileDraft, latestVolatileDraft, readVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import { databaseStyles as db } from '@/theme/styles/database'

export type { DatabaseWorkbenchContext } from '../model/database.types'

const databasePanels: SplitterPanelData[] = [
  { id: 'database-sidebar', minSize: '240px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'database-editor', minSize: '460px' },
]

export function DatabaseWorkspace({ workspace, focusRequest = 0, initialState, onContextChange, onSessionChange, onWorkspaceGuardChange }: Props) {
  const { preferences } = useAppPreferences()
  const rowLimit = effectivePreference(preferences, 'database.rowLimit', 500)
  const queryTimeoutMs = effectivePreference(preferences, 'database.queryTimeoutMs', 30_000)
  const confirmMutations = effectivePreference(preferences, 'database.confirmMutations', true)
  const explorerWidth = effectivePreference(preferences, 'database.explorerWidth', 300)
  const [connections, setConnections] = useState<DatabaseConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)
  const [loadingResources, setLoadingResources] = useState(false)
  const [connectionReady, setConnectionReady] = useState(false)
  const [resourceError, setResourceError] = useState<UserError | null>(null)
  const [resourceRevision, setResourceRevision] = useState(0)
  const [toolbarAction, setToolbarAction] = useState<DatabaseToolbarAction>(null)
  const [connectionError, setConnectionError] = useState<UserError | null>(null)
  const [selected, setSelected] = useState<DatabaseConnection | null>(null)
  const [sql, setSql] = useState(defaultSql)
  const [result, setResult] = useState<DatabaseQueryResult | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft>(defaultDraft)
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const [connectionDraftError, setConnectionDraftError] = useState<UserError | null>(null)
  const [connectionDraftRecoveryError, setConnectionDraftRecoveryError] = useState<{ error: UserError; identity: VolatileDraftIdentity } | null>(null)
  const [savedQueries, setSavedQueries] = useState<DatabaseSavedQuery[]>([])
  const [history, setHistory] = useState<DatabaseHistoryEntry[]>([])
  const [transactionActive, setTransactionActive] = useState(false)
  const [schema, setSchema] = useState<DatabaseSchema>({ tables: [], routines: [] })
  const [schemaFilter, setSchemaFilter] = useState('')
  const [sidebarTab, setSidebarTab] = useState<'items' | 'queries' | 'history'>(() => initialState?.sidebarTab ?? 'items')
  const [databaseView, setDatabaseView] = useState<'sql' | 'data'>(() => initialState?.view ?? 'sql')
  const [activeSavedQueryId, setActiveSavedQueryId] = useState<string | null>(() => initialState?.activeSavedQueryId ?? null)
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(() => new Set(initialState?.expandedSchemaIds.length ? initialState.expandedSchemaIds : ['dbo', 'Tabelle']))
  const [selectedTableName, setSelectedTableName] = useState<string | null>(() => initialState?.selectedTableName ?? null)
  const [tableFilter, setTableFilter] = useState('')
  const [tablePage, setTablePage] = useState<DatabaseTablePage | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<UserError | null>(null)
  const [tableRevision, setTableRevision] = useState(0)
  const [lastExecutedSql, setLastExecutedSql] = useState('')
  const [executing, setExecuting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [queryError, setQueryError] = useState<UserError | null>(null)
  const [queryErrorRecovery, setQueryErrorRecovery] = useState<'run' | 'cancel'>('run')
  const [guardFailure, setGuardFailure] = useState<DatabaseGuardFailure | null>(null)
  const [queryHistoryRefreshFailure, setQueryHistoryRefreshFailure] = useState<QueryHistoryRefreshFailure | null>(null)
  const editorHost = useRef<HTMLDivElement>(null)
  const editorView = useRef<EditorView | null>(null)
  const resultsRegion = useRef<HTMLElement>(null)
  const pendingResultsFocus = useRef(false)
  const sqlLanguageCompartment = useRef(new Compartment())
  const workspaceRef = useRef(workspace)
  const sqlRef = useRef(sql)
  const sqlBaseline = useRef({ content: defaultSql, savedQueryId: null as string | null })
  const sqlDocumentRevision = useRef(0)
  const executingRef = useRef(false)
  const executionRequest = useRef(0)
  const activeQuery = useRef<{ operationId: string; connectionId: string; mutative: boolean } | null>(null)
  const selectedConnectionId = useRef<string | null>(null)
  const desiredConnectionId = useRef<string | null>(initialState?.selectedConnectionId ?? null)
  const desiredSavedQueryId = useRef<string | null>(initialState?.activeSavedQueryId ?? null)
  const desiredTableName = useRef<string | null>(initialState?.selectedTableName ?? null)
  const expectedProgrammaticSql = useRef<string | null>(null)
  const restoredSession = useRef<WorkspaceSessionState['database'] | null>(null)
  const resourceRequest = useRef(0)
  const tableRequest = useRef(0)
  const connectionDialogOpener = useRef<HTMLElement | null>(null)
  const connectionNameInput = useRef<HTMLInputElement>(null)
  const connectionDraftRef = useRef(connectionDraft)
  const connectionDraftBaseline = useRef(connectionDraft)
  const connectionModalOpenRef = useRef(connectionModalOpen)
  const editingConnectionIdRef = useRef(editingConnectionId)
  const transactionActiveRef = useRef(transactionActive)
  const transactionConnectionId = useRef<string | null>(null)
  const toolbarActionRef = useRef(toolbarAction)
  const tableDraftGuard = useRef<DatabaseTableDraftGuard | null>(null)
  const tableUpdateInFlight = useRef(false)
  const databaseGuardActions = useRef<Pick<WorkspaceChangeGuard, 'hasUnsavedChanges' | 'saveAll' | 'discardAll'>>({
    hasUnsavedChanges: () => false,
    saveAll: async () => undefined,
    discardAll: async () => undefined,
  })
  const currentConnectionId = selected?.id ?? null

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

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

  const publishTransactionActive = useCallback((active: boolean, connectionId: string | null = selectedConnectionId.current) => {
    transactionActiveRef.current = active
    transactionConnectionId.current = active ? connectionId : null
    setTransactionActive(active)
  }, [])

  const publishToolbarAction = useCallback((action: DatabaseToolbarAction) => {
    toolbarActionRef.current = action
    setToolbarAction(action)
  }, [])

  const publishSqlBaseline = useCallback((content: string, savedQueryId: string | null) => {
    sqlBaseline.current = { content, savedQueryId }
    sqlRef.current = content
    expectedProgrammaticSql.current = content
    setActiveSavedQueryId(savedQueryId)
    setSql(content)
  }, [])

  const handleTableDraftGuardChange = useCallback((guard: DatabaseTableDraftGuard | null) => {
    tableDraftGuard.current = guard
  }, [])

  useEffect(() => {
    onContextChange?.({
      connectionId: selected?.id ?? null,
      connectionName: selected?.name ?? null,
      executing,
      sql,
      tableName: selectedTableName,
      transactionActive,
    })
  }, [executing, onContextChange, selected?.id, selected?.name, selectedTableName, sql, transactionActive])

  useEffect(() => {
    if (focusRequest <= 0) return
    // La richiesta proviene dalla command palette/menu e deve rendere operativo
    // l'editor SQL prima di trasferirgli il focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDatabaseView('sql')
    requestAnimationFrame(() => editorView.current?.focus())
  }, [focusRequest])

  useEffect(() => {
    if (!initialState || restoredSession.current === initialState) return
    restoredSession.current = initialState
    desiredConnectionId.current = initialState.selectedConnectionId
    desiredSavedQueryId.current = initialState.activeSavedQueryId
    desiredTableName.current = initialState.selectedTableName
    // Lo snapshot arriva dal processo Electron dopo il mount: questo effect è
    // il confine intenzionale che sincronizza la vista con lo stato persistito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarTab(initialState.sidebarTab)
    setDatabaseView(initialState.view)
    setActiveSavedQueryId(initialState.activeSavedQueryId)
    setExpandedSchemas(new Set(initialState.expandedSchemaIds.length ? initialState.expandedSchemaIds : ['dbo', 'Tabelle']))
    setSelectedTableName(initialState.selectedTableName)
  }, [initialState])

  useEffect(() => {
    if (loadingConnections) return
    onSessionChange?.({
      selectedConnectionId: selected?.id ?? null,
      sidebarTab,
      view: databaseView,
      expandedSchemaIds: [...expandedSchemas],
      selectedTableName,
      activeSavedQueryId,
    })
  }, [activeSavedQueryId, databaseView, expandedSchemas, loadingConnections, onSessionChange, selected?.id, selectedTableName, sidebarTab])

  const sqlSchema = useMemo(() => Object.fromEntries(schema.tables.map((table) => [table.name, table.columns.map((column) => ({ label: column.name, type: 'property', detail: column.type }))])), [schema])
  // Il renderer può aggiornarsi prima del processo Electron: una risposta
  // schema precedente non contiene ancora le routine e non deve abbattere la vista.
  const routines = useMemo(() => Array.isArray(schema.routines) ? schema.routines : [], [schema.routines])
  const schemaGroups = useMemo(() => {
    const search = schemaFilter.trim().toLocaleLowerCase('it-IT')
    return schema.tables.filter((table) => !search || table.name.toLocaleLowerCase('it-IT').includes(search) || table.columns.some((column) => column.name.toLocaleLowerCase('it-IT').includes(search))).reduce<Map<string, DatabaseTableSchema[]>>((groups, table) => {
      const group = tableSchemaName(table.name)
      groups.set(group, [...(groups.get(group) ?? []), table])
      return groups
    }, new Map())
  }, [schema.tables, schemaFilter])
  const routineGroups = useMemo(() => {
    const search = schemaFilter.trim().toLocaleLowerCase('it-IT')
    const matches = routines.filter((routine) => !search || routine.name.toLocaleLowerCase('it-IT').includes(search))
    return { procedures: matches.filter((routine) => routine.kind === 'procedure'), functions: matches.filter((routine) => routine.kind === 'function') }
  }, [routines, schemaFilter])
  const schemaTreeCollection = useMemo(() => createTreeCollection<SchemaTreeNode>({
    nodeToChildren: (node) => node.children ?? [],
    nodeToChildrenCount: (node) => node.kind === 'group' ? node.count ?? 0 : undefined,
    nodeToString: (node) => node.label,
    nodeToValue: (node) => node.value,
    rootNode: {
      kind: 'root',
      label: 'Schema',
      value: 'schema:root',
      children: [
        {
          kind: 'group',
          label: 'Procedure archiviate',
          value: 'schema:routines:procedures',
          expansionKey: 'Procedure archiviate',
          count: routineGroups.procedures.length,
          children: routineGroups.procedures.map((routine) => ({ kind: 'routine', label: routine.name, value: `routine:${routine.kind}:${routine.name}`, routine })),
        },
        {
          kind: 'group',
          label: 'Funzioni',
          value: 'schema:routines:functions',
          expansionKey: 'Funzioni',
          count: routineGroups.functions.length,
          children: routineGroups.functions.map((routine) => ({ kind: 'routine', label: routine.name, value: `routine:${routine.kind}:${routine.name}`, routine })),
        },
        ...[...schemaGroups.entries()].map(([group, tables]): SchemaTreeNode => ({
          kind: 'group',
          label: group,
          value: `schema:tables:${group}`,
          expansionKey: group,
          count: tables.length,
          children: tables.map((table) => ({ kind: 'table', label: tableLabel(table.name), value: `table:${table.name}`, tableName: table.name })),
        })),
      ],
    },
  }), [routineGroups, schemaGroups])
  const schemaExpandedValue = useMemo(() => {
    const branchValues = schemaTreeCollection.getBranchValues()
    if (schemaFilter.trim()) return branchValues
    return branchValues.filter((value) => {
      const node = schemaTreeCollection.findNode(value)
      return node?.kind === 'group' && node.expansionKey !== undefined && expandedSchemas.has(node.expansionKey)
    })
  }, [expandedSchemas, schemaFilter, schemaTreeCollection])
  const schemaSelectedValue = useMemo(() => {
    if (!selectedTableName) return []
    const value = `table:${selectedTableName}`
    return schemaTreeCollection.findNode(value) ? [value] : []
  }, [schemaTreeCollection, selectedTableName])

  async function cancelActiveQueryForContextChange() {
    const active = activeQuery.current
    if (!active) return null
    executionRequest.current += 1
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

  const selectConnection = (connection: DatabaseConnection | null) => {
    if (connection?.id !== selected?.id && transactionActive) {
      toast.warning('Completa la transazione prima di cambiare connessione.', { description: 'Scegli Commit o Rollback per non lasciare modifiche sospese.' })
      return
    }
    if (connection?.id !== selected?.id) void cancelActiveQuery(false)
    selectedConnectionId.current = connection?.id ?? null
    desiredSavedQueryId.current = null
    desiredTableName.current = null
    setActiveSavedQueryId(null)
    executionRequest.current += 1
    setConnectionReady(false)
    setResourceError(null)
    setQueryHistoryRefreshFailure(null)
    setSavedQueries([])
    setHistory([])
    setSchema({ tables: [], routines: [] })
    setResult(null)
    setSelectedTableName(null)
    setTablePage(null)
    setTableError(null)
    setSelected(connection)
  }

  useEffect(() => {
    const desired = desiredConnectionId.current
    if (!desired || connections.length === 0) return
    desiredConnectionId.current = null
    const connection = connections.find((item) => item.id === desired) ?? connections[0] ?? null
    selectedConnectionId.current = connection?.id ?? null
    setSelected(connection)
  }, [connections, initialState])

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
        return items.find((item) => item.id === desired) ?? items.find((item) => item.id === current?.id) ?? items[0] ?? null
      })
    } catch (error) {
      setConnectionError(reportDatabaseFailure(error, 'list-connections', 'Connessioni database non caricate', 'Le query e le bozze locali restano disponibili. Riprova a caricare le connessioni.'))
    } finally { setLoadingConnections(false) }
  }, [recoverConnectionDraft])

  useEffect(() => { const timer = window.setTimeout(() => void loadConnections(), 0); return () => window.clearTimeout(timer) }, [loadConnections])
  useEffect(() => {
    const connectionId = currentConnectionId
    const request = ++resourceRequest.current
    selectedConnectionId.current = connectionId ?? null
    executionRequest.current += 1
    if (!connectionId) {
      const recoveredSql = readVolatileDraft(sqlDraftIdentity(workspace, null))
      queueMicrotask(() => {
        setLoadingResources(false); setConnectionReady(false); setResourceError(null); setQueryHistoryRefreshFailure(null); setSavedQueries([]); setHistory([]); setSchema({ tables: [], routines: [] }); setResult(null); publishTransactionActive(false); setSelectedTableName(null); setTablePage(null); setTableError(null)
        if (!recoveredSql) return
        sqlBaseline.current = { content: recoveredSql.baseline, savedQueryId: null }
        sqlRef.current = recoveredSql.content
        expectedProgrammaticSql.current = recoveredSql.content
        setActiveSavedQueryId(null)
        setSql(recoveredSql.content)
      })
      return
    }
    let current = true
    queueMicrotask(() => {
      if (!current || request !== resourceRequest.current) return
      setLoadingResources(true)
      setConnectionReady(false)
      setResourceError(null)
      setSavedQueries([])
      setHistory([])
      setSchema({ tables: [], routines: [] })
      setResult(null)
      setSelectedTableName(null)
      setTablePage(null)
      setTableError(null)
    })
    void Promise.all([databaseBridge.database.listSavedQueries(connectionId), databaseBridge.database.listHistory(connectionId), databaseBridge.database.inspectSchema(connectionId)]).then(([queries, entries, currentSchema]) => {
      if (!current) return
      const restoredQuery = queries.find((query) => query.id === desiredSavedQueryId.current) ?? null
      const restoredTable = currentSchema.tables.some((table) => table.name === desiredTableName.current) ? desiredTableName.current : null
      desiredSavedQueryId.current = null
      desiredTableName.current = null
      setSavedQueries(queries); setHistory(entries); setSchema(currentSchema); setResult(null); publishTransactionActive(false); setSelectedTableName(restoredTable); setTablePage(null); setSchemaFilter(''); setTableFilter(''); setConnectionReady(true); setResourceError(null); setQueryHistoryRefreshFailure(null)
      const recoveredSql = readVolatileDraft(sqlDraftIdentity(workspace, connectionId))
      if (recoveredSql) {
        sqlBaseline.current = { content: recoveredSql.baseline, savedQueryId: null }
        sqlRef.current = recoveredSql.content
        expectedProgrammaticSql.current = recoveredSql.content
        setActiveSavedQueryId(null)
        setSql(recoveredSql.content)
      } else if (restoredQuery) {
        publishSqlBaseline(restoredQuery.sql, restoredQuery.id)
      } else {
        publishSqlBaseline(defaultSql, null)
      }
    }).catch((error) => {
      if (!current || request !== resourceRequest.current) return
      setConnectionReady(false)
      setResourceError(reportDatabaseFailure(error, 'load-connection-resources', 'Connessione database non pronta', 'Query e risultati precedenti sono stati mantenuti. Riconnetti o riprova prima di eseguire nuove query.'))
    }).finally(() => { if (current && request === resourceRequest.current) setLoadingResources(false) })
    return () => { current = false }
  }, [currentConnectionId, publishSqlBaseline, publishTransactionActive, resourceRevision, workspace])

  useEffect(() => () => {
    const active = activeQuery.current
    if (active) void databaseBridge.database.cancel(active.operationId).catch((error) => {
      // La vista non esiste più: il cleanup possiede l'incidente e lo registra senza
      // delegarlo all'handler globale o creare una notifica fuori contesto.
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
    if (!currentConnectionId || !selectedTableName) return
    const connectionId = currentConnectionId
    const request = ++tableRequest.current
    const timer = window.setTimeout(() => {
      setTableLoading(true)
      setTableError(null)
      void databaseBridge.database.tableRows(connectionId, selectedTableName, { filter: tableFilter, limit: rowLimit }).then((page) => {
        if (request !== tableRequest.current || selectedConnectionId.current !== connectionId) return
        setTablePage(page)
      }).catch((error) => {
        if (request !== tableRequest.current || selectedConnectionId.current !== connectionId) return
        setTablePage(null)
        setTableError(reportDatabaseFailure(error, 'load-table-rows', 'Dati della tabella non caricati', 'La selezione e le modifiche locali sono rimaste disponibili. Riprova la lettura.'))
      }).finally(() => { if (request === tableRequest.current) setTableLoading(false) })
    }, tableFilter ? 220 : 0)
    return () => window.clearTimeout(timer)
  }, [currentConnectionId, rowLimit, selectedTableName, tableFilter, tableRevision])

  useEffect(() => {
    if (!editorHost.current) return
    const view = new EditorView({ state: EditorState.create({ doc: sqlRef.current, extensions: [
      graphiteCodeMirrorTheme,
      lineNumbers(),
      editorHistory(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      sqlLanguageCompartment.current.of(sqlLanguage({ dialect: SQLite, schema: {} })),
      linter(sqlLintSource, { delay: 350 }),
      lintGutter(),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        sqlDocumentRevision.current += 1
        const value = update.state.doc.toString()
        sqlRef.current = value
        setSql(value)
        if (expectedProgrammaticSql.current === value) {
          expectedProgrammaticSql.current = null
          return
        }
        setActiveSavedQueryId(null)
        writeVolatileDraft(sqlDraftIdentity(workspaceRef.current, selectedConnectionId.current), value, sqlBaseline.current.content)
      }),
    ] }), parent: editorHost.current })
    editorView.current = view
    return () => { view.destroy(); editorView.current = null }
  }, [])

  useEffect(() => {
    const view = editorView.current
    if (!view) return
    const dialect = selected?.driver === 'postgres' ? PostgreSQL : selected?.driver === 'mysql' ? MySQL : selected?.driver === 'mssql' ? MSSQL : SQLite
    view.dispatch({ effects: sqlLanguageCompartment.current.reconfigure(sqlLanguage({ dialect, schema: sqlSchema })) })
  }, [selected?.driver, sqlSchema])

  useEffect(() => { sqlRef.current = sql; const view = editorView.current; if (!view || view.state.doc.toString() === sql) return; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } }) }, [sql])

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

  const activeSql = () => {
    const view = editorView.current
    const selection = view?.state.selection.main
    return selection && !selection.empty ? view.state.sliceDoc(selection.from, selection.to) : sql
  }

  const execute = async (confirmed = false, offset = 0, query = activeSql()) => {
    if (!selected || !connectionReady || !query.trim() || executingRef.current) return
    const connectionId = selected.id
    const operationId = crypto.randomUUID()
    const mutative = isMutativeSql(query)
    const request = ++executionRequest.current
    executingRef.current = true
    activeQuery.current = { operationId, connectionId, mutative }
    setExecuting(true)
    setCancelling(false)
    setQueryErrorRecovery('run')
    setQueryError(null)
    setDatabaseView('sql')
    try {
      const nextResult = await databaseBridge.database.execute(connectionId, query, { operationId, confirmed, offset, limit: rowLimit, timeoutMs: queryTimeoutMs })
      if (request !== executionRequest.current || selectedConnectionId.current !== connectionId) return
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
        if (request !== executionRequest.current || selectedConnectionId.current !== connectionId) return
        setHistory(nextHistory)
        if (historyWasRecorded) setQueryHistoryRefreshFailure(null)
      } catch (historyError) {
        if (request !== executionRequest.current || selectedConnectionId.current !== connectionId) return
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
      if (request !== executionRequest.current || selectedConnectionId.current !== connectionId) return
      setQueryErrorRecovery('run')
      setQueryError(reportDatabaseFailure(error, 'execute-query', 'Query non eseguita', 'Il testo della query e gli ultimi risultati sono stati mantenuti. Correggi il problema e riprova.'))
      requestAnimationFrame(() => editorView.current?.focus())
    } finally {
      if (activeQuery.current?.operationId === operationId) activeQuery.current = null
      executingRef.current = false
      setExecuting(false)
      setCancelling(false)
    }
  }

  const retryQueryHistoryRefresh = async (connectionId: string) => {
    const nextHistory = await databaseBridge.database.listHistory(connectionId)
    if (selectedConnectionId.current !== connectionId) return
    setHistory(nextHistory)
    setQueryHistoryRefreshFailure((current) => current?.connectionId === connectionId ? null : current)
  }

  const requestRun = () => {
    const query = activeSql()
    if (isMutativeSql(query)) {
      if (!confirmMutations) { void execute(true, 0, query); return }
      setConfirmation({ title: 'Conferma query mutativa', detail: query, confirmLabel: 'Esegui query', onConfirm: () => void execute(true, 0, query) }); return
    }
    void execute(false, 0, query)
  }

  async function formatSql() {
    const view = editorView.current
    if (!view || toolbarAction !== null) return
    const initialDocument = view.state.doc
    const initialSelection = view.state.selection
    const initialRevision = sqlDocumentRevision.current
    const selection = initialSelection.main
    const document = initialDocument.toString()
    const source = document.slice(selection.empty ? 0 : selection.from, selection.empty ? document.length : selection.to)
    if (!source.trim()) { toast.info('Non c’è SQL da formattare.'); return }

    setToolbarAction('format')
    try {
      const change = await createSqlFormatChange(document, { from: selection.from, to: selection.to }, selected?.driver ?? 'sqlite')
      if (editorView.current !== view) return
      if (sqlDocumentRevision.current !== initialRevision || view.state.doc !== initialDocument || !view.state.selection.eq(initialSelection)) return
      if (document.slice(change.from, change.to) === change.insert) { toast.info('Il SQL è già formattato.'); view.focus(); return }
      view.dispatch({
        changes: { from: change.from, to: change.to, insert: change.insert },
        selection: { anchor: change.anchor, head: change.head },
        userEvent: 'input.format',
      })
      view.focus()
      toast.success(selection.empty ? 'Query formattata.' : 'Selezione formattata.')
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'format-sql', 'SQL non formattato', 'Il testo originale è rimasto invariato. Controlla la sintassi e riprova.', 'warning')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void formatSql() } })
    } finally {
      setToolbarAction(null)
    }
  }

  const setDraftDriver = (driver: Driver) => publishConnectionDraft((current) => ({ ...current, driver, port: driver === 'sqlite' ? undefined : defaultPort[driver] }))
  const persistConnectionDraft = async (force = false) => {
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
  }
  const saveConnection = async () => {
    setConnectionDraftError(null)
    try {
      await persistConnectionDraft(true)
    } catch (error) {
      setConnectionDraftError(reportDatabaseFailure(error, 'save-connection', 'Connessione non salvata', 'I dati inseriti sono rimasti nel form. Controlla configurazione e credenziali, poi riprova.'))
    }
  }

  const openNewConnection = (opener: HTMLElement) => {
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
  }
  const editConnection = (connection: DatabaseConnection, opener: HTMLElement) => {
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
  }
  const closeConnectionModal = () => {
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
  }
  function deleteConnection(connection: DatabaseConnection) {
    setConfirmation({
      title: `Eliminare ${connection.name}?`,
      detail: 'Saranno eliminate anche query salvate e cronologia locali di questa connessione.',
      confirmLabel: 'Elimina connessione',
      destructive: true,
      onConfirm: () => void databaseBridge.database.deleteConnection(connection.id).then(async () => {
        if (selected?.id === connection.id) selectConnection(null)
        await loadConnections()
      }).catch((error) => {
        const incident = reportDatabaseFailure(error, 'delete-connection', 'Connessione non eliminata', `“${connection.name}” e i relativi dati locali sono rimasti disponibili. Riprova.`)
        showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: () => deleteConnection(connection) })
      }),
    })
  }

  async function refreshSavedQueries(connectionId: string) {
    try {
      setSavedQueries(await databaseBridge.database.listSavedQueries(connectionId))
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'refresh-saved-queries', 'Elenco query salvate non aggiornato', 'L’ultima modifica è già al sicuro. Aggiorna soltanto l’elenco, senza ripetere il salvataggio o l’eliminazione.', 'warning')
      showDatabaseWarningToast(incident, { label: 'Aggiorna elenco', onClick: () => { void refreshSavedQueries(connectionId) } })
    }
  }
  const persistCurrentQuery = async () => {
    const content = sqlRef.current
    if (content === sqlBaseline.current.content) return
    const connectionId = selectedConnectionId.current
    if (!connectionId) throw new Error('Seleziona una connessione prima di salvare la query SQL.')
    if (!content.trim()) throw new Error('La query SQL vuota non può essere salvata automaticamente.')
    const saved = await databaseBridge.database.saveQuery({ connectionId, name: `Query ${new Date().toLocaleTimeString('it-IT')}`, sql: content })
    sqlBaseline.current = { content, savedQueryId: saved.id }
    commitVolatileDraft(sqlDraftIdentity(workspace, connectionId), content)
    setActiveSavedQueryId(sqlRef.current === content ? saved.id : null)
    await refreshSavedQueries(connectionId)
  }
  async function saveCurrentQuery() {
    try { await persistCurrentQuery() }
    catch (error) {
      const incident = reportDatabaseFailure(error, 'save-query', 'Query non salvata', 'Il testo è rimasto nell’editor. Seleziona una connessione valida e riprova.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void saveCurrentQuery() } })
    }
  }
  function deleteSavedQuery(query: DatabaseSavedQuery) {
    setConfirmation({
      title: `Eliminare ${query.name}?`,
      detail: 'La query salvata verrà rimossa solo da questo workspace.',
      confirmLabel: 'Elimina query',
      destructive: true,
      onConfirm: () => void (async () => {
        try {
          await databaseBridge.database.deleteSavedQuery(query.id)
        } catch (error) {
          const incident = reportDatabaseFailure(error, 'delete-saved-query', 'Query salvata non eliminata', `“${query.name}” è rimasta disponibile. Riprova.`)
          showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: () => deleteSavedQuery(query) })
          return
        }
        if (activeSavedQueryId === query.id) setActiveSavedQueryId(null)
        if (selected) await refreshSavedQueries(selected.id)
      })(),
    })
  }
  function requestClearHistory() {
    if (!selected || !history.length) return
    const connectionId = selected.id
    setConfirmation({
      title: 'Pulire la cronologia query?',
      detail: `Saranno rimosse ${history.length} query eseguite per ${selected.name}. Le query salvate non verranno modificate.`,
      confirmLabel: 'Pulisci cronologia',
      destructive: true,
      onConfirm: () => void databaseBridge.database.clearHistory(connectionId).then((outcome) => {
        if (selectedConnectionId.current === connectionId) setHistory([])
        toast.success(`${outcome.deleted} query rimosse dalla cronologia.`)
      }).catch((error) => {
        const incident = reportDatabaseFailure(error, 'clear-query-history', 'Cronologia non eliminata', 'La cronologia locale non è stata modificata. Riprova.')
        showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: requestClearHistory })
      }),
    })
  }
  async function refreshSchema() {
    if (!selected || toolbarAction) return
    if (tableDraftGuard.current?.hasChanges()) {
      toast.warning('Modifiche tabella non applicate.', { description: 'Salvale o annullale prima di aggiornare lo schema.' })
      return
    }
    const connection = selected
    setToolbarAction('schema')
    try {
      const nextSchema = await databaseBridge.database.inspectSchema(connection.id, { force: true })
      if (selectedConnectionId.current === connection.id) {
        setSchema(nextSchema)
        setTableRevision((current) => current + 1)
      }
      toast.success(`Schema aggiornato: ${nextSchema.tables.length} tabelle e ${nextSchema.routines.length} routine.`)
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'refresh-schema', 'Schema non aggiornato', 'Lo schema precedente è rimasto disponibile. Controlla la connessione e riprova.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void refreshSchema() } })
    } finally { setToolbarAction(null) }
  }
  async function begin() {
    if (!selected || toolbarActionRef.current) return
    const connectionId = selected.id
    publishToolbarAction('begin')
    try {
      const outcome = await databaseBridge.database.begin(connectionId)
      if (selectedConnectionId.current === connectionId) publishTransactionActive(outcome.active, connectionId)
      toast.success('Transazione avviata.', { description: 'Le modifiche restano temporanee finché non scegli Commit.' })
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'begin-transaction', 'Transazione non avviata', 'Nessuna modifica è stata applicata. Controlla la connessione e riprova.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void begin() } })
    } finally { publishToolbarAction(null) }
  }
  const finishTransactionCore = async (action: 'commit' | 'rollback') => {
    const connectionId = transactionConnectionId.current ?? selectedConnectionId.current
    if (!connectionId) throw new Error('La connessione della transazione non è più disponibile.')
    if (toolbarActionRef.current) throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
    publishToolbarAction(action)
    try {
      const outcome = await databaseBridge.database[action](connectionId)
      if (outcome.active) throw new Error('Il database segnala che la transazione è ancora attiva.')
      publishTransactionActive(false)
      if (selectedConnectionId.current === connectionId) setTableRevision((current) => current + 1)
    } finally { publishToolbarAction(null) }
  }
  async function finishTransaction(action: 'commit' | 'rollback') {
    if (!transactionActiveRef.current) return
    if (action === 'commit' && tableDraftGuard.current?.hasChanges()) {
      toast.warning('Commit non eseguito.', { description: 'Salva o annulla prima le modifiche locali della griglia.' })
      return
    }
    try {
      await finishTransactionCore(action)
      toast.success(action === 'commit' ? 'Transazione confermata.' : 'Transazione annullata.')
    } catch (error) {
      const incident = reportDatabaseFailure(error, `${action}-transaction`, action === 'commit' ? 'Commit non completato' : 'Rollback non completato', 'La transazione resta attiva. Verifica lo stato della connessione e riprova la stessa azione.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void finishTransaction(action) } })
    }
  }
  const openSql = (nextSql: string, savedQueryId: string | null = null) => {
    executionRequest.current += 1
    discardVolatileDraft(sqlDraftIdentity(workspace, selectedConnectionId.current))
    publishSqlBaseline(nextSql, savedQueryId)
    setDatabaseView('sql')
    requestAnimationFrame(() => editorView.current?.focus())
  }
  const openTable = (tableName: string) => { executionRequest.current += 1; publishSqlBaseline(schemaTablePreviewSql(selected?.driver ?? 'sqlite', tableName), null); setSelectedTableName(tableName); setTableFilter(''); setTablePage(null); setTableError(null); setDatabaseView('data') }
  const openRoutine = (routine: DatabaseRoutine) => { openSql(routine.definition || `-- Definizione non disponibile per ${routine.name}. Verifica il permesso VIEW DEFINITION sulla connessione.`); setSelectedTableName(null); setTableFilter(''); setTablePage(null); setTableError(null); setResult(null) }
  const loadMoreTableRows = () => {
    if (!selected || !selectedTableName || !tablePage) return
    const request = ++tableRequest.current
    setTableLoading(true)
    setTableError(null)
    void databaseBridge.database.tableRows(selected.id, selectedTableName, { filter: tableFilter, offset: tablePage.offset + tablePage.rows.length }).then((nextPage) => {
      if (request !== tableRequest.current || selectedConnectionId.current !== selected.id) return
      setTablePage((current) => current ? { ...nextPage, rows: [...current.rows, ...nextPage.rows], offset: current.offset } : nextPage)
    }).catch((error) => {
      if (request !== tableRequest.current || selectedConnectionId.current !== selected.id) return
      setTableError(reportDatabaseFailure(error, 'load-more-table-rows', 'Altre righe non caricate', 'Le righe già visibili e le modifiche locali sono rimaste disponibili. Riprova.'))
    }).finally(() => { if (request === tableRequest.current) setTableLoading(false) })
  }
  const requestSaveTableChanges = (changes: DatabaseTableChange[]) => {
    if (!selected || !selectedTableName) return
    const connectionId = selected.id
    const tableName = selectedTableName
    setConfirmation({
      title: `Salvare ${changes.length} modifiche?`,
      detail: 'Le modifiche saranno applicate nella transazione attiva. Usa Commit per renderle permanenti o Rollback per annullarle.',
      confirmLabel: 'Salva modifiche',
      onConfirm: () => {
        tableUpdateInFlight.current = true
        setTableError(null)
        void databaseBridge.database.updateTableRows(connectionId, tableName, changes).then((outcome) => {
          toast.success(`${outcome.updated} righe aggiornate nella transazione.`)
          tableDraftGuard.current?.discardAll()
          setTableRevision((current) => current + 1)
        }).catch((error) => {
          setTableError(reportDatabaseFailure(error, 'update-table-rows', 'Modifiche tabella non applicate', 'Le modifiche locali sono rimaste nella griglia. Correggi il problema e riprova il salvataggio.'))
        }).finally(() => {
          tableUpdateInFlight.current = false
        })
      },
    })
  }

  const hasConnectionDraftChanges = () => connectionModalOpenRef.current && !sameConnectionDraft(connectionDraftRef.current, connectionDraftBaseline.current)
  const hasUnsafeDatabaseWork = () => Boolean(
    tableDraftGuard.current?.hasChanges()
    || transactionActiveRef.current
    || tableUpdateInFlight.current
    || toolbarActionRef.current === 'begin'
    || toolbarActionRef.current === 'commit'
    || toolbarActionRef.current === 'rollback',
  )
  const hasDatabaseWork = () => Boolean(
    sqlRef.current !== sqlBaseline.current.content
    || hasConnectionDraftChanges()
    || hasUnsafeDatabaseWork()
    || activeQuery.current,
  )

  const saveDatabaseWork = async () => {
    setGuardFailure(null)
    try {
      if (tableUpdateInFlight.current || toolbarActionRef.current === 'begin' || toolbarActionRef.current === 'commit' || toolbarActionRef.current === 'rollback') {
        throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
      }
      if (tableDraftGuard.current?.hasChanges()) {
        throw new Error('Le modifiche locali della griglia non possono essere applicate automaticamente. Usa “Salva” nella griglia e poi scegli Commit o Rollback.')
      }
      if (transactionActiveRef.current) {
        throw new Error('La transazione Database attiva richiede una scelta esplicita: Commit o Rollback. Non verrà eseguito alcun commit automatico.')
      }
      const cancellation = await cancelActiveQueryForContextChange()
      if (cancellation?.mutative) toast.warning('Query mutativa annullata.', { description: 'La modifica potrebbe essere già stata applicata: verifica i dati prima di ripetere la query.' })
      await persistConnectionDraft()
      await persistCurrentQuery()
    } catch (error) {
      setGuardFailure({
        error: reportDatabaseFailure(
          error,
          'save-before-context-change',
          'Cambio contesto Database sospeso',
          'Il lavoro Database non è stato salvato. Query, modifiche e transazione restano nel contesto corrente; correggi il problema e riprova.',
        ),
        recovery: 'save',
      })
      throw error
    }
  }

  const discardDatabaseWork = async () => {
    setGuardFailure(null)
    try {
      if (tableUpdateInFlight.current || toolbarActionRef.current === 'begin' || toolbarActionRef.current === 'commit' || toolbarActionRef.current === 'rollback') {
        throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
      }
      const cancellation = await cancelActiveQueryForContextChange()
      if (cancellation?.mutative) toast.warning('Query mutativa annullata.', { description: 'La modifica potrebbe essere già stata applicata; il discard non ripete la query.' })
      if (transactionActiveRef.current) await finishTransactionCore('rollback')
      tableDraftGuard.current?.discardAll()
      const baseline = sqlBaseline.current
      discardVolatileDraft(sqlDraftIdentity(workspace, selectedConnectionId.current))
      publishSqlBaseline(baseline.content, baseline.savedQueryId)
      if (connectionModalOpenRef.current) closeConnectionModal()
      setConfirmation(null)
    } catch (error) {
      setGuardFailure({
        error: reportDatabaseFailure(
          error,
          'discard-before-context-change',
          'Ripristino Database non completato',
          'Il lavoro Database è stato mantenuto per evitare perdite. Risolvi l’operazione in corso e riprova il ripristino.',
        ),
        recovery: 'discard',
      })
      throw error
    }
  }

  // Il callback nativo può arrivare prima del prossimo effect: conserva sempre
  // le azioni dell'ultimo render committibile senza registrare una guardia stale.
  // eslint-disable-next-line react-hooks/refs
  databaseGuardActions.current = {
    hasUnsavedChanges: hasDatabaseWork,
    saveAll: saveDatabaseWork,
    discardAll: discardDatabaseWork,
  }

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => databaseGuardActions.current.hasUnsavedChanges(),
      saveAll: () => databaseGuardActions.current.saveAll(),
      discardAll: () => databaseGuardActions.current.discardAll(),
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [onWorkspaceGuardChange])

  useApplicationMenuCommand('database.execute', requestRun)
  useApplicationMenuCommand('database.cancel', () => { void cancelActiveQuery() })
  useApplicationMenuCommand('database.format', () => { void formatSql() })
  useApplicationMenuCommand('database.schema', () => { void refreshSchema() })
  useApplicationMenuCommand('database.saveQuery', () => { void saveCurrentQuery() })
  useApplicationMenuCommand('database.begin', () => { void begin() })
  useApplicationMenuCommand('database.commit', () => { void finishTransaction('commit') })
  useApplicationMenuCommand('database.rollback', () => { void finishTransaction('rollback') })

  return <Splitter.Root asChild defaultFixedSize={explorerWidth} panels={databasePanels} storageKey={`vincodelab.database.sidebar-width:${workspace}`}><section aria-busy={loadingConnections || loadingResources} className={db.workspace} aria-label="Database workspace">
    <Splitter.Panel id="database-sidebar"><Tabs.Root asChild value={sidebarTab} onValueChange={({ value }) => setSidebarTab(value as typeof sidebarTab)}><aside className={db.sidebar}>
      <Tabs.List aria-label="Esplora database" className={db.explorerTabs}>
        <Tabs.Trigger value="items">Tabelle</Tabs.Trigger>
        <Tabs.Trigger value="queries">Query <small className={db.tabCount}>{savedQueries.length}</small></Tabs.Trigger>
        <Tabs.Trigger value="history">Cronologia <small className={db.tabCount}>{history.length}</small></Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>
      <section className={db.explorerContent}>
        <Tabs.Content className={db.schemaContent} value="items">
          <Field.Root className={db.schemaFilter}><Field.Input aria-label="Cerca nello schema" value={schemaFilter} onChange={(event) => setSchemaFilter(event.target.value)} placeholder="Cerca tabelle, procedure o funzioni…" /></Field.Root>
          <TreeView.Root collection={schemaTreeCollection} expandedValue={schemaExpandedValue} selectedValue={schemaSelectedValue} selectionMode="single" translations={{ treeLabel: 'Schema database' }} onExpandedChange={({ expandedNodes }) => {
            if (schemaFilter.trim()) return
            setExpandedSchemas(new Set(expandedNodes.flatMap((node) => node.kind === 'group' && node.expansionKey ? [node.expansionKey] : [])))
          }} onSelectionChange={({ selectedNodes }) => {
            const node = selectedNodes.at(-1)
            if (node?.kind === 'table' && node.tableName) openTable(node.tableName)
            if (node?.kind === 'routine' && node.routine) openRoutine(node.routine)
          }}><TreeView.Tree className={db.schemaTree}>{schemaTreeCollection.getNodeChildren(schemaTreeCollection.rootNode).map((node, index) => <DatabaseSchemaTreeNodeView indexPath={[index]} key={node.value} node={node} />)}</TreeView.Tree></TreeView.Root>
        </Tabs.Content>
        <Tabs.Content value="queries" className={db.explorerList}>{savedQueries.length ? savedQueries.map((query) => <div className={db.savedQuery} key={query.id}><Button className={db.queryButton} variant="plain" aria-current={activeSavedQueryId === query.id ? 'true' : undefined} onClick={() => openSql(query.sql, query.id)}>{query.name}</Button><IconButton size="icon-xs" tone="danger" tooltip={`Elimina ${query.name}`} onClick={() => deleteSavedQuery(query)}><Trash2 size={13} /></IconButton></div>) : <p className={db.listEmpty}>Nessuna query salvata.</p>}</Tabs.Content>
        <Tabs.Content value="history" className={db.historyPanel}><header className={db.historyToolbar}><span>Query eseguite</span><Button size="xs" tone="danger" variant="plain" aria-label="Pulisci cronologia query" disabled={!history.length} onClick={requestClearHistory} title="Pulisci cronologia"><Trash2 size={13} /> Pulisci</Button></header><div className={db.explorerList}>{history.length ? history.map((entry) => <Button className={db.queryButton} variant="plain" key={entry.id} onClick={() => openSql(entry.sql)} title={entry.sql}>{entry.sql.slice(0, 72)}</Button>) : <p className={db.listEmpty}>Nessuna query nella cronologia.</p>}</div></Tabs.Content>
      </section>
      <footer className={db.connectionSwitcher}>{loadingConnections ? <Spinner size={14} /> : connectionError ? <ErrorNotice action={{ label: 'Riprova', onClick: loadConnections }} error={connectionError} /> : <><SelectField aria-label="Connessione database attiva" placeholder="Nessuna connessione" options={connections.map((connection) => ({ value: connection.id, label: `${connection.name} · ${driverLabel(connection.driver)}` }))} value={selected?.id ?? ''} onValueChange={(value) => selectConnection(connections.find((connection) => connection.id === value) ?? null)} />{selected && <><IconButton tooltip={`Modifica ${selected.name}`} onClick={(event) => editConnection(selected, event.currentTarget)}><FilePenLine size={13} /></IconButton><IconButton tone="danger" tooltip={`Elimina ${selected.name}`} onClick={() => deleteConnection(selected)}><Trash2 size={13} /></IconButton></>}<IconButton tooltip="Nuova connessione" aria-label="Nuova connessione database" onClick={(event) => openNewConnection(event.currentTarget)}><Plus size={15} /></IconButton></>}</footer>
    </aside></Tabs.Root></Splitter.Panel>
    <Splitter.ResizeTrigger aria-label="Ridimensiona explorer Database" id="database-sidebar:database-editor" title="Trascina per ridimensionare l’explorer Database. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
    <Splitter.Panel id="database-editor"><Tabs.Root asChild value={databaseView} onValueChange={({ value }) => setDatabaseView(value as typeof databaseView)}><main className={db.editorPane}>
      <header className={db.toolbar}>
        <strong className={db.toolbarTitle}>{selected?.name ?? 'Seleziona una connessione'}</strong>
        <div className={db.toolbarActions}>
          <span aria-live="polite" className={db.toolbarStatus}>{executing ? 'Esecuzione query…' : toolbarAction === 'format' ? 'Formattazione SQL…' : toolbarAction === 'schema' ? 'Aggiornamento schema…' : toolbarAction === 'begin' ? 'Avvio transazione…' : toolbarAction === 'commit' ? 'Conferma transazione…' : toolbarAction === 'rollback' ? 'Annullamento transazione…' : transactionActive ? 'Transazione attiva' : ''}</span>
          <Button size="sm" variant="outline" disabled={!selected || !connectionReady || loadingResources || toolbarAction !== null} onClick={() => void refreshSchema()}>{toolbarAction === 'schema' ? <Spinner size={14} /> : <RefreshCw size={14} />} {toolbarAction === 'schema' ? 'Aggiornamento…' : 'Schema'}</Button>
          <Button size="sm" variant="outline" disabled={!selected || !connectionReady || transactionActive || loadingResources || toolbarAction !== null} onClick={() => void begin()}>{toolbarAction === 'begin' && <Spinner size={14} />}{toolbarAction === 'begin' ? 'Avvio…' : 'Inizia'}</Button>
          <Button size="sm" variant="outline" disabled={!selected || !transactionActive || toolbarAction !== null} onClick={() => void finishTransaction('commit')}>{toolbarAction === 'commit' ? 'Commit…' : 'Commit'}</Button>
          <Button size="sm" variant="outline" disabled={!selected || !transactionActive || toolbarAction !== null} onClick={() => void finishTransaction('rollback')}><RotateCcw size={14} /> {toolbarAction === 'rollback' ? 'Rollback…' : 'Rollback'}</Button>
          <Button size="sm" variant="outline" disabled={!selected || toolbarAction !== null} onClick={() => void saveCurrentQuery()}><Save size={14} /> Salva</Button>
          <Button size="sm" variant="outline" disabled={!selected || toolbarAction !== null} onClick={() => void formatSql()} title="Formatta SQL (⌥⇧F)">{toolbarAction === 'format' ? <Spinner size={14} /> : <AlignLeft size={14} />} {toolbarAction === 'format' ? 'Formattazione…' : 'Formatta'}</Button>
          {executing && <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void cancelActiveQuery()}><X size={14} /> {cancelling ? 'Annullamento…' : 'Annulla'}</Button>}
          <Button size="sm" disabled={!selected || !connectionReady || executing || toolbarAction !== null} onClick={requestRun}>{executing ? <Spinner size={14} /> : <Play size={14} />} {executing ? 'Esecuzione…' : 'Esegui'}</Button>
        </div>
      </header>
      {guardFailure && <ErrorNotice action={{
        label: guardFailure.recovery === 'save' ? 'Salva e riprova' : 'Ripristina di nuovo',
        onClick: () => (guardFailure.recovery === 'save' ? saveDatabaseWork() : discardDatabaseWork()).catch(() => {
          // La funzione di guardia conserva lo stato e aggiorna questo stesso avviso.
        }),
      }} error={guardFailure.error} />}
      {connectionDraftRecoveryError && <ErrorNotice
        action={{
          label: 'Rimuovi bozza',
          onClick: () => {
            discardVolatileDraft(connectionDraftRecoveryError.identity)
            setConnectionDraftRecoveryError(null)
          },
        }}
        error={connectionDraftRecoveryError.error}
      />}
      {resourceError && <ErrorNotice action={{ label: 'Riprova', onClick: () => setResourceRevision((current) => current + 1) }} error={resourceError} />}
      <Tabs.List aria-label="Viste Database" className={db.viewTabs}><Tabs.Trigger value="sql">SQL</Tabs.Trigger><Tabs.Trigger value="data">Dati</Tabs.Trigger><Tabs.Indicator /></Tabs.List>
      <Tabs.Content value="sql" className={`${db.viewPanel} ${db.sqlPanel}`}>{queryError && <ErrorNotice action={queryErrorRecovery === 'cancel' ? { label: 'Annulla di nuovo', onClick: () => cancelActiveQuery() } : { label: 'Riprova query', onClick: requestRun }} error={queryError} />}<div aria-label="Editor SQL" className={db.editorHost} data-database-editor-host ref={editorHost} /></Tabs.Content>
      <Tabs.Content value="data" className={db.viewPanel}>{queryHistoryRefreshFailure && <ErrorNotice action={queryHistoryRefreshFailure.recovery === 'copy-query' ? { label: 'Copia query', onClick: () => navigator.clipboard.writeText(queryHistoryRefreshFailure.sql ?? '') } : { label: 'Aggiorna cronologia', pendingLabel: 'Aggiornamento cronologia…', onClick: () => retryQueryHistoryRefresh(queryHistoryRefreshFailure.connectionId) }} error={queryHistoryRefreshFailure.error} />}{tableError && <ErrorNotice action={{ label: 'Riprova lettura', onClick: () => setTableRevision((current) => current + 1) }} error={tableError} />}{selectedTableName && selected ? <DatabaseTableGrid key={`${selectedTableName}:${tableRevision}`} draftIdentity={gridDraftIdentity(workspace, selected.id, selectedTableName)} filter={tableFilter} loading={tableLoading} onDraftGuardChange={handleTableDraftGuardChange} onFilterChange={setTableFilter} onLoadMore={loadMoreTableRows} onRequestSave={requestSaveTableChanges} page={tablePage} transactionActive={transactionActive} /> : <section className={db.results} aria-live="polite" ref={resultsRegion} tabIndex={-1}>{result ? <><div className={db.resultsSummary}><p className={db.resultsSummaryText}>{result.rows.length} righe · {result.durationMs} ms{result.affectedRows !== null ? ` · ${result.affectedRows} coinvolte` : ''}</p>{result.hasMore && <Button size="sm" variant="outline" onClick={() => void execute(false, result.rows.length, lastExecutedSql)}>Carica altre righe</Button>}</div><table className={db.resultsTable}><thead><tr>{result.columns.map((column) => <th className={db.resultsHeaderCell} key={column}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td className={db.resultsCell} key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody></table></> : <p className={db.resultsEmpty}>Seleziona una tabella dallo schema o esegui una query.</p>}</section>}</Tabs.Content>
    </main></Tabs.Root></Splitter.Panel>
    {(loadingConnections || loadingResources) && <div aria-live="polite" className={db.loadingOverlay} role="status"><Spinner className={db.loadingIcon} size={20} /><strong>{loadingConnections ? 'Caricamento connessioni database' : 'Caricamento risorse database'}</strong><span className={db.loadingDescription}>{loadingConnections ? 'Recupero delle connessioni del workspace…' : 'Lettura di tabelle, procedure, funzioni e cronologia…'}</span></div>}
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    <Dialog.Root
      finalFocusEl={() => connectionDialogOpener.current}
      initialFocusEl={() => connectionNameInput.current}
      lazyMount
      open={connectionModalOpen}
      unmountOnExit
      onOpenChange={({ open }) => { if (!open) closeConnectionModal() }}
    >
      <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={db.dialogContent}>
        <header className={db.dialogHeader}>
          <div className={db.dialogHeading}><p className={db.dialogEyebrow}>Database del workspace</p><Dialog.Title className={db.dialogTitle}>{editingConnectionId ? 'Modifica connessione' : 'Nuova connessione'}</Dialog.Title></div>
          <Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi connessione"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger>
        </header>
        <form className={db.connectionForm} onSubmit={(event) => { event.preventDefault(); void saveConnection() }}>
          <Field.Root><Field.Label>Nome connessione</Field.Label><Field.Input ref={connectionNameInput} placeholder="Nome connessione" value={connectionDraft.name} onChange={(event) => publishConnectionDraft((current) => ({ ...current, name: event.target.value }))} /></Field.Root>
          <SelectField label="Driver database" layer="modal" options={[{ value: 'sqlite', label: 'SQLite' }, { value: 'postgres', label: 'PostgreSQL' }, { value: 'mysql', label: 'MySQL' }, { value: 'mssql', label: 'SQL Server' }]} value={connectionDraft.driver} onValueChange={(value) => setDraftDriver(value as Driver)} />
          {connectionDraft.driver === 'sqlite' ? <Field.Root><Field.Label>Percorso SQLite</Field.Label><Field.Input placeholder="/percorso/database.sqlite" value={connectionDraft.sqlitePath ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, sqlitePath: event.target.value }))} /></Field.Root> : <div className={db.remoteFields}><Field.Root><Field.Label>Host</Field.Label><Field.Input placeholder="Host" value={connectionDraft.host ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, host: event.target.value }))} /></Field.Root><Field.Root><Field.Label>Porta</Field.Label><Field.Input min="1" max="65535" placeholder="Porta" type="number" value={connectionDraft.port ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, port: Number(event.target.value) }))} /></Field.Root><Field.Root><Field.Label>Database</Field.Label><Field.Input placeholder="Database" value={connectionDraft.database ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, database: event.target.value }))} /></Field.Root><Field.Root><Field.Label>Utente</Field.Label><Field.Input placeholder="Utente" value={connectionDraft.user ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, user: event.target.value }))} /></Field.Root><Field.Root><Field.Label>Password</Field.Label><Field.Input placeholder={connectionDraft.hasPassword ? 'Lascia vuoto per mantenere la password' : 'Password'} required={!connectionDraft.hasPassword} type="password" value={connectionDraft.password ?? ''} onChange={(event) => publishConnectionDraft((current) => ({ ...current, password: event.target.value }))} /></Field.Root></div>}
          {connectionDraftError && <ErrorNotice action={{ label: 'Riprova salvataggio', onClick: saveConnection }} error={connectionDraftError} />}
          <div className={db.formActions}><Dialog.CloseTrigger asChild unstyled><Button size="sm" type="button" variant="outline">Annulla</Button></Dialog.CloseTrigger><Button size="sm" type="submit"><Plus size={14} /> {editingConnectionId ? 'Salva modifiche' : 'Aggiungi connessione'}</Button></div>
        </form>
      </Dialog.Content></Dialog.Positioner></Dialog.Portal>
    </Dialog.Root>
  </section></Splitter.Root>
}
