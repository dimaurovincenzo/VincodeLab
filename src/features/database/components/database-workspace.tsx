import { useEffect, useRef, useState } from 'react'
import type { DatabaseConnection, DatabaseRoutine, DatabaseSavedQuery, DatabaseTableChange, WorkspaceSessionState } from '@/bridge'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { ErrorNotice, Spinner, Splitter, Tabs, toast, type SplitterPanelData } from '@/components/ui'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { schemaTablePreviewSql } from '../model/database-query'
import { createSqlFormatChange } from '../services/sql-format'
import { commitVolatileDraft, discardVolatileDraft } from '@/lib/volatile-draft-store'
import { databaseBridge } from '../api/database.bridge'
import { sqlDraftIdentity } from '../model/database-connections'
import type { DatabaseWorkspaceProps as Props } from '../model/database.types'
import { reportDatabaseFailure, showDatabaseErrorToast } from '../services/database-error'
import { useDatabaseConnections } from '../hooks/use-database-connections'
import { useDatabaseExecutionGate } from '../hooks/use-database-execution-gate'
import { useDatabaseQuery } from '../hooks/use-database-query'
import { useDatabaseResources } from '../hooks/use-database-resources'
import { useDatabaseSqlEditor } from '../hooks/use-database-sql-editor'
import { useDatabaseTransactions } from '../hooks/use-database-transactions'
import { useDatabaseWorkspaceGuard } from '../hooks/use-database-workspace-guard'
import { databaseStyles as db } from '@/theme/styles/database'
import { DatabaseConnectionDialog } from './database-connection-dialog'
import { DatabaseExplorer } from './database-explorer'
import { DatabaseResultsPanel } from './database-results-panel'
import { DatabaseToolbar } from './database-toolbar'
import type { DatabaseTableDraftGuard } from './database-table-grid'

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
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'items' | 'queries' | 'history'>(() => initialState?.sidebarTab ?? 'items')
  const [databaseView, setDatabaseView] = useState<'sql' | 'data'>(() => initialState?.view ?? 'sql')
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(() => new Set(initialState?.expandedSchemaIds.length ? initialState.expandedSchemaIds : ['dbo', 'Tabelle']))
  const restoredSession = useRef<WorkspaceSessionState['database'] | null>(null)
  const tableDraftGuard = useRef<DatabaseTableDraftGuard | null>(null)
  const tableUpdateInFlight = useRef(false)
  const tableRevisionRefresh = useRef<() => void>(() => undefined)

  const connections = useDatabaseConnections(workspace)
  const executionGate = useDatabaseExecutionGate()
  const transactions = useDatabaseTransactions({
    onTransactionFinished: () => tableRevisionRefresh.current(),
    selected: connections.selected,
    selectedConnectionId: connections.selectedConnectionId,
    tableDraftGuard,
  })
  const editor = useDatabaseSqlEditor({ connectionIdRef: connections.selectedConnectionId, workspace })
  const resources = useDatabaseResources({
    connectionId: connections.selected?.id ?? null,
    getSelectedConnectionId: connections.getSelectedConnectionId,
    invalidateExecutionRequest: executionGate.invalidate,
    publishSqlBaseline: editor.publishSqlBaseline,
    publishTransactionActive: transactions.publishTransactionActive,
    restoreSqlDraft: editor.restoreSqlDraft,
    rowLimit,
    publishSelectedConnectionId: connections.publishSelectedConnectionId,
    workspace,
  })
  const query = useDatabaseQuery({
    activeSql: editor.activeSql,
    beginExecutionRequest: executionGate.begin,
    confirmMutations,
    connectionReady: resources.connectionReady,
    databaseView,
    focusEditor: editor.focusEditor,
    getSelectedConnectionId: connections.getSelectedConnectionId,
    invalidateExecutionRequest: executionGate.invalidate,
    isExecutionRequestCurrent: executionGate.isCurrent,
    queryTimeoutMs,
    rowLimit,
    selected: connections.selected,
    selectedTableName: resources.selectedTableName,
    setConfirmation,
    setDatabaseView,
    setHistory: resources.setHistory,
    setSelectedTableName: resources.setSelectedTableName,
    setTableError: resources.setTableError,
    setTablePage: resources.setTablePage,
    workspace,
  })
  const currentConnectionId = connections.selected?.id ?? null
  const desiredConnectionId = connections.desiredConnectionId
  const desiredSavedQueryId = resources.desiredSavedQueryId
  const desiredTableName = resources.desiredTableName
  const reconfigureLanguage = editor.reconfigureLanguage
  const setActiveSavedQueryId = editor.setActiveSavedQueryId
  const setQueryHistoryRefreshFailure = query.setQueryHistoryRefreshFailure
  const setResult = query.setResult
  const setSelectedTableName = resources.setSelectedTableName
  const setTableRevision = resources.setTableRevision

  useEffect(() => {
    tableRevisionRefresh.current = () => setTableRevision((current) => current + 1)
  }, [setTableRevision])

  useEffect(() => {
    reconfigureLanguage(connections.selected?.driver, resources.schema)
  }, [connections.selected?.driver, reconfigureLanguage, resources.schema])

  useEffect(() => {
    onContextChange?.({
      connectionId: connections.selected?.id ?? null,
      connectionName: connections.selected?.name ?? null,
      executing: query.executing,
      sql: editor.sql,
      tableName: resources.selectedTableName,
      transactionActive: transactions.transactionActive,
    })
  }, [connections.selected?.id, connections.selected?.name, editor.sql, onContextChange, query.executing, resources.selectedTableName, transactions.transactionActive])

  useEffect(() => {
    if (focusRequest <= 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDatabaseView('sql')
    requestAnimationFrame(editor.focusEditor)
  }, [editor.focusEditor, focusRequest])

  useEffect(() => {
    if (!initialState || restoredSession.current === initialState) return
    restoredSession.current = initialState
    desiredConnectionId.current = initialState.selectedConnectionId
    desiredSavedQueryId.current = initialState.activeSavedQueryId
    desiredTableName.current = initialState.selectedTableName
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSidebarTab(initialState.sidebarTab)
    setDatabaseView(initialState.view)
    setActiveSavedQueryId(initialState.activeSavedQueryId)
    setExpandedSchemas(new Set(initialState.expandedSchemaIds.length ? initialState.expandedSchemaIds : ['dbo', 'Tabelle']))
    setSelectedTableName(initialState.selectedTableName)
  }, [desiredConnectionId, desiredSavedQueryId, desiredTableName, initialState, setActiveSavedQueryId, setSelectedTableName])

  useEffect(() => {
    if (connections.loadingConnections) return
    onSessionChange?.({
      selectedConnectionId: connections.selected?.id ?? null,
      sidebarTab,
      view: databaseView,
      expandedSchemaIds: [...expandedSchemas],
      selectedTableName: resources.selectedTableName,
      activeSavedQueryId: editor.activeSavedQueryId,
    })
  }, [connections.loadingConnections, connections.selected?.id, databaseView, editor.activeSavedQueryId, expandedSchemas, onSessionChange, resources.selectedTableName, sidebarTab])

  useEffect(() => {
    setResult(null)
    setQueryHistoryRefreshFailure(null)
  }, [currentConnectionId, setQueryHistoryRefreshFailure, setResult])

  function selectConnection(connection: DatabaseConnection | null) {
    if (connection?.id !== connections.selected?.id && transactions.transactionActive) {
      toast.warning('Completa la transazione prima di cambiare connessione.', { description: 'Scegli Commit o Rollback per non lasciare modifiche sospese.' })
      return
    }
    if (connection?.id !== connections.selected?.id) void query.cancelActiveQuery(false)
    connections.publishSelectedConnectionId(connection?.id ?? null)
    resources.desiredSavedQueryId.current = null
    resources.desiredTableName.current = null
    editor.setActiveSavedQueryId(null)
    executionGate.invalidate()
    resources.setConnectionReady(false)
    resources.setResourceError(null)
    query.setQueryHistoryRefreshFailure(null)
    resources.setSavedQueries([])
    resources.setHistory([])
    query.setResult(null)
    resources.setSelectedTableName(null)
    resources.setTablePage(null)
    resources.setTableError(null)
    connections.setSelected(connection)
  }

  async function formatSql() {
    const view = editor.editorView.current
    if (!view || transactions.toolbarAction !== null) return
    const initialDocument = view.state.doc
    const initialSelection = view.state.selection
    const initialRevision = editor.sqlDocumentRevision.current
    const selection = initialSelection.main
    const document = initialDocument.toString()
    const source = document.slice(selection.empty ? 0 : selection.from, selection.empty ? document.length : selection.to)
    if (!source.trim()) { toast.info('Non c’è SQL da formattare.'); return }
    transactions.publishToolbarAction('format')
    try {
      const change = await createSqlFormatChange(document, { from: selection.from, to: selection.to }, connections.selected?.driver ?? 'sqlite')
      if (editor.editorView.current !== view) return
      if (editor.sqlDocumentRevision.current !== initialRevision || view.state.doc !== initialDocument || !view.state.selection.eq(initialSelection)) return
      if (document.slice(change.from, change.to) === change.insert) { toast.info('Il SQL è già formattato.'); view.focus(); return }
      view.dispatch({ changes: { from: change.from, to: change.to, insert: change.insert }, selection: { anchor: change.anchor, head: change.head }, userEvent: 'input.format' })
      view.focus()
      toast.success(selection.empty ? 'Query formattata.' : 'Selezione formattata.')
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'format-sql', 'SQL non formattato', 'Il testo originale è rimasto invariato. Controlla la sintassi e riprova.', 'warning')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void formatSql() } })
    } finally {
      transactions.publishToolbarAction(null)
    }
  }

  function deleteConnection(connection: DatabaseConnection) {
    setConfirmation({
      title: `Eliminare ${connection.name}?`,
      detail: 'Saranno eliminate anche query salvate e cronologia locali di questa connessione.',
      confirmLabel: 'Elimina connessione',
      destructive: true,
      onConfirm: () => void databaseBridge.database.deleteConnection(connection.id).then(async () => {
        if (connections.selected?.id === connection.id) selectConnection(null)
        await connections.loadConnections()
      }).catch((error) => {
        const incident = reportDatabaseFailure(error, 'delete-connection', 'Connessione non eliminata', `“${connection.name}” e i relativi dati locali sono rimasti disponibili. Riprova.`)
        showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: () => deleteConnection(connection) })
      }),
    })
  }

  async function persistCurrentQuery() {
    const content = editor.sqlRef.current
    if (content === editor.sqlBaseline.current.content) return
    const connectionId = connections.getSelectedConnectionId()
    if (!connectionId) throw new Error('Seleziona una connessione prima di salvare la query SQL.')
    if (!content.trim()) throw new Error('La query SQL vuota non può essere salvata automaticamente.')
    const saved = await databaseBridge.database.saveQuery({ connectionId, name: `Query ${new Date().toLocaleTimeString('it-IT')}`, sql: content })
    editor.sqlBaseline.current = { content, savedQueryId: saved.id }
    commitVolatileDraft(sqlDraftIdentity(workspace, connectionId), content)
    editor.setActiveSavedQueryId(editor.sqlRef.current === content ? saved.id : null)
    await resources.refreshSavedQueries(connectionId)
  }

  async function saveCurrentQuery() {
    try { await persistCurrentQuery() }
    catch (error) {
      const incident = reportDatabaseFailure(error, 'save-query', 'Query non salvata', 'Il testo è rimasto nell’editor. Seleziona una connessione valida e riprova.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void saveCurrentQuery() } })
    }
  }

  function deleteSavedQuery(savedQuery: DatabaseSavedQuery) {
    setConfirmation({
      title: `Eliminare ${savedQuery.name}?`,
      detail: 'La query salvata verrà rimossa solo da questo workspace.',
      confirmLabel: 'Elimina query',
      destructive: true,
      onConfirm: () => void (async () => {
        try { await databaseBridge.database.deleteSavedQuery(savedQuery.id) }
        catch (error) {
          const incident = reportDatabaseFailure(error, 'delete-saved-query', 'Query salvata non eliminata', `“${savedQuery.name}” è rimasta disponibile. Riprova.`)
          showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: () => deleteSavedQuery(savedQuery) })
          return
        }
        if (editor.activeSavedQueryId === savedQuery.id) editor.setActiveSavedQueryId(null)
        if (connections.selected) await resources.refreshSavedQueries(connections.selected.id)
      })(),
    })
  }

  function requestClearHistory() {
    if (!connections.selected || !resources.history.length) return
    const connectionId = connections.selected.id
    setConfirmation({
      title: 'Pulire la cronologia query?',
      detail: `Saranno rimosse ${resources.history.length} query eseguite per ${connections.selected.name}. Le query salvate non verranno modificate.`,
      confirmLabel: 'Pulisci cronologia',
      destructive: true,
      onConfirm: () => void databaseBridge.database.clearHistory(connectionId).then((outcome) => {
        if (connections.getSelectedConnectionId() === connectionId) resources.setHistory([])
        toast.success(`${outcome.deleted} query rimosse dalla cronologia.`)
      }).catch((error) => {
        const incident = reportDatabaseFailure(error, 'clear-query-history', 'Cronologia non eliminata', 'La cronologia locale non è stata modificata. Riprova.')
        showDatabaseErrorToast(incident, { label: 'Riapri conferma', onClick: requestClearHistory })
      }),
    })
  }

  async function refreshSchema() {
    if (!connections.selected || transactions.toolbarAction) return
    if (tableDraftGuard.current?.hasChanges()) {
      toast.warning('Modifiche tabella non applicate.', { description: 'Salvale o annullale prima di aggiornare lo schema.' })
      return
    }
    const connection = connections.selected
    transactions.publishToolbarAction('schema')
    try {
      const refreshed = await resources.connect({ force: true, preserveSchema: resources.connectionReady })
      if (refreshed && connections.getSelectedConnectionId() === connection.id) {
        resources.setTableRevision((current) => current + 1)
        toast.success('Schema aggiornato. Tutte le risorse sono state caricate progressivamente.')
      }
    } finally {
      transactions.publishToolbarAction(null)
    }
  }

  function openSql(nextSql: string, savedQueryId: string | null = null) {
    executionGate.invalidate()
    discardVolatileDraft(sqlDraftIdentity(workspace, connections.getSelectedConnectionId()))
    editor.publishSqlBaseline(nextSql, savedQueryId)
    setDatabaseView('sql')
    requestAnimationFrame(editor.focusEditor)
  }

  function openTable(tableName: string) {
    executionGate.invalidate()
    editor.publishSqlBaseline(schemaTablePreviewSql(connections.selected?.driver ?? 'sqlite', tableName), null)
    resources.setSelectedTableName(tableName)
    resources.setTableFilter('')
    resources.setTablePage(null)
    resources.setTableError(null)
    setDatabaseView('data')
  }

  async function openRoutine(routine: DatabaseRoutine) {
    const connectionId = connections.selected?.id
    if (!connectionId || !resources.connectionReady) return
    try {
      const loaded = await databaseBridge.database.inspectRoutine(connectionId, routine.name, routine.kind)
      if (connections.getSelectedConnectionId() !== connectionId) return
      const truncationNotice = loaded.definitionTruncated
        ? '-- Definizione parziale: il testo supera il limite sicuro dell’editor.\n\n'
        : ''
      openSql(loaded.definition
        ? `${truncationNotice}${loaded.definition}`
        : `-- Definizione non disponibile per ${routine.name}. Verifica il permesso VIEW DEFINITION sulla connessione.`)
      resources.setSelectedTableName(null)
      resources.setTableFilter('')
      resources.setTablePage(null)
      resources.setTableError(null)
      query.setResult(null)
    } catch (error) {
      const incident = reportDatabaseFailure(
        error,
        'load-routine-definition',
        'Definizione routine non caricata',
        'La connessione e il testo SQL corrente sono rimasti disponibili. Verifica i permessi e riprova.',
      )
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void openRoutine(routine) } })
    }
  }

  function requestSaveTableChanges(changes: DatabaseTableChange[]) {
    if (!connections.selected || !resources.selectedTableName) return
    const connectionId = connections.selected.id
    const tableName = resources.selectedTableName
    setConfirmation({
      title: `Salvare ${changes.length} modifiche?`,
      detail: 'Le modifiche saranno applicate nella transazione attiva. Usa Commit per renderle permanenti o Rollback per annullarle.',
      confirmLabel: 'Salva modifiche',
      onConfirm: () => {
        tableUpdateInFlight.current = true
        resources.setTableError(null)
        void databaseBridge.database.updateTableRows(connectionId, tableName, changes).then((outcome) => {
          toast.success(`${outcome.updated} righe aggiornate nella transazione.`)
          tableDraftGuard.current?.discardAll()
          resources.setTableRevision((current) => current + 1)
        }).catch((error) => {
          resources.setTableError(reportDatabaseFailure(error, 'update-table-rows', 'Modifiche tabella non applicate', 'Le modifiche locali sono rimaste nella griglia. Correggi il problema e riprova il salvataggio.'))
        }).finally(() => { tableUpdateInFlight.current = false })
      },
    })
  }

  const hasUnsafeDatabaseWork = () => Boolean(tableDraftGuard.current?.hasChanges()
    || transactions.transactionActiveRef.current
    || tableUpdateInFlight.current
    || ['begin', 'commit', 'rollback'].includes(transactions.toolbarActionRef.current ?? ''))
  const hasDatabaseWork = () => Boolean(editor.sqlRef.current !== editor.sqlBaseline.current.content
    || connections.hasConnectionDraftChanges()
    || hasUnsafeDatabaseWork()
    || query.activeQuery.current)
  const saveDatabaseWork = async () => {
    if (tableUpdateInFlight.current || ['begin', 'commit', 'rollback'].includes(transactions.toolbarActionRef.current ?? '')) throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
    if (tableDraftGuard.current?.hasChanges()) throw new Error('Le modifiche locali della griglia non possono essere applicate automaticamente. Usa “Salva” nella griglia e poi scegli Commit o Rollback.')
    if (transactions.transactionActiveRef.current) throw new Error('La transazione Database attiva richiede una scelta esplicita: Commit o Rollback. Non verrà eseguito alcun commit automatico.')
    const cancellation = await query.cancelActiveQueryForContextChange()
    if (cancellation?.mutative) toast.warning('Query mutativa annullata.', { description: 'La modifica potrebbe essere già stata applicata: verifica i dati prima di ripetere la query.' })
    await connections.persistConnectionDraft()
    await persistCurrentQuery()
  }
  const discardDatabaseWork = async () => {
    if (tableUpdateInFlight.current || ['begin', 'commit', 'rollback'].includes(transactions.toolbarActionRef.current ?? '')) throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
    const cancellation = await query.cancelActiveQueryForContextChange()
    if (cancellation?.mutative) toast.warning('Query mutativa annullata.', { description: 'La modifica potrebbe essere già stata applicata; il discard non ripete la query.' })
    if (transactions.transactionActiveRef.current) await transactions.finishTransactionCore('rollback')
    tableDraftGuard.current?.discardAll()
    const baseline = editor.sqlBaseline.current
    discardVolatileDraft(sqlDraftIdentity(workspace, connections.getSelectedConnectionId()))
    editor.publishSqlBaseline(baseline.content, baseline.savedQueryId)
    if (connections.connectionModalOpenRef.current) connections.closeConnectionModal()
    setConfirmation(null)
  }
  const guard = useDatabaseWorkspaceGuard({ discardWork: discardDatabaseWork, hasUnsavedChanges: hasDatabaseWork, onWorkspaceGuardChange, saveWork: saveDatabaseWork })

  useApplicationMenuCommand('database.execute', query.requestRun)
  useApplicationMenuCommand('database.cancel', () => { void query.cancelActiveQuery() })
  useApplicationMenuCommand('database.format', () => { void formatSql() })
  useApplicationMenuCommand('database.schema', () => { void refreshSchema() })
  useApplicationMenuCommand('database.saveQuery', () => { void saveCurrentQuery() })
  useApplicationMenuCommand('database.begin', () => { void transactions.begin() })
  useApplicationMenuCommand('database.commit', () => { void transactions.finishTransaction('commit') })
  useApplicationMenuCommand('database.rollback', () => { void transactions.finishTransaction('rollback') })

  return <Splitter.Root asChild defaultFixedSize={explorerWidth} panels={databasePanels} storageKey={`vincodelab.database.sidebar-width:${workspace}`}>
    <section aria-busy={resources.loadingResources} className={db.workspace} aria-label="Database workspace">
      <Splitter.Panel id="database-sidebar">
        <DatabaseExplorer
          activeSavedQueryId={editor.activeSavedQueryId} connectionError={connections.connectionError} connections={connections.connections}
          connectionLocked={resources.disconnectAvailable} connectionReady={resources.connectionReady} expandedSchemas={expandedSchemas} history={resources.history} loadingConnections={connections.loadingConnections}
          onClearHistory={requestClearHistory} onDeleteConnection={deleteConnection} onDeleteSavedQuery={deleteSavedQuery}
          onEditConnection={connections.editConnection} onExpandedSchemasChange={setExpandedSchemas} onNewConnection={connections.openNewConnection}
          onOpenRoutine={(routine) => { void openRoutine(routine) }} onOpenSql={openSql} onOpenTable={openTable} onReloadConnections={() => { void connections.loadConnections() }}
          onSchemaFilterChange={resources.setSchemaFilter} onSelectConnection={selectConnection} onSidebarTabChange={setSidebarTab}
          savedQueries={resources.savedQueries} schema={resources.schema} schemaFilter={resources.schemaFilter} schemaProgress={resources.schemaProgress} selected={connections.selected}
          selectedTableName={resources.selectedTableName} sidebarTab={sidebarTab}
        />
      </Splitter.Panel>
      <Splitter.ResizeTrigger aria-label="Ridimensiona explorer Database" id="database-sidebar:database-editor" title="Trascina per ridimensionare l’explorer Database. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
      <Splitter.Panel id="database-editor">
        <Tabs.Root asChild value={databaseView} onValueChange={({ value }) => setDatabaseView(value as typeof databaseView)}>
          <main className={db.editorPane}>
            <DatabaseToolbar
              cancelling={query.cancelling} connectionPrepared={resources.connectionPrepared} connectionReady={resources.connectionReady} disconnectAvailable={resources.disconnectAvailable} disconnecting={resources.disconnecting} executing={query.executing} loadingResources={resources.loadingResources}
              onBegin={() => { void transactions.begin() }} onCancel={() => { void query.cancelActiveQuery() }} onFinishTransaction={(action) => { void transactions.finishTransaction(action) }}
              onConnect={() => { void resources.connect() }} onDisconnect={() => { void resources.disconnect() }} onFormat={() => { void formatSql() }} onRefreshSchema={() => { void refreshSchema() }} onRun={query.requestRun} onSaveQuery={() => { void saveCurrentQuery() }}
              selected={connections.selected} toolbarAction={transactions.toolbarAction} transactionActive={transactions.transactionActive}
            />
            {guard.guardFailure && <ErrorNotice action={{ label: guard.guardFailure.recovery === 'save' ? 'Salva e riprova' : 'Ripristina di nuovo', onClick: () => (guard.guardFailure?.recovery === 'save' ? guard.saveAll() : guard.discardAll()).catch(() => undefined) }} error={guard.guardFailure.error} />}
            {connections.connectionDraftRecoveryError && <ErrorNotice action={{ label: 'Rimuovi bozza', onClick: () => { discardVolatileDraft(connections.connectionDraftRecoveryError!.identity); connections.setConnectionDraftRecoveryError(null) } }} error={connections.connectionDraftRecoveryError.error} />}
            {resources.resourceError && <ErrorNotice action={{ label: resources.resourceRetryLabel, onClick: resources.retryResources }} error={resources.resourceError} />}
            <Tabs.List aria-label="Viste Database" className={db.viewTabs}><Tabs.Trigger value="sql">SQL</Tabs.Trigger><Tabs.Trigger value="data">Dati</Tabs.Trigger><Tabs.Indicator /></Tabs.List>
            <Tabs.Content value="sql" className={`${db.viewPanel} ${db.sqlPanel}`}>
              {query.queryError && <ErrorNotice action={query.queryErrorRecovery === 'cancel' ? { label: 'Annulla di nuovo', onClick: () => query.cancelActiveQuery() } : { label: 'Riprova query', onClick: query.requestRun }} error={query.queryError} />}
              <div aria-label="Editor SQL" className={db.editorHost} data-database-editor-host ref={editor.editorHost} />
            </Tabs.Content>
            <DatabaseResultsPanel
              historyFailure={query.queryHistoryRefreshFailure} onDraftGuardChange={(value) => { tableDraftGuard.current = value }}
              onLoadMoreQuery={() => { void query.execute(false, query.result?.rows.length ?? 0, query.lastExecutedSql) }} onLoadMoreTableRows={resources.loadMoreTableRows}
              onRequestSaveTableChanges={requestSaveTableChanges} onRetryHistory={query.retryQueryHistoryRefresh}
              onRetryTable={() => resources.setTableRevision((current) => current + 1)} onTableFilterChange={resources.setTableFilter}
              result={query.result} resultsRegion={query.resultsRegion} selected={connections.selected} selectedTableName={resources.selectedTableName}
              tableError={resources.tableError} tableFilter={resources.tableFilter} tableLoading={resources.tableLoading} tablePage={resources.tablePage}
              tableRevision={resources.tableRevision} transactionActive={transactions.transactionActive} workspace={workspace}
            />
          </main>
        </Tabs.Root>
      </Splitter.Panel>
      {resources.loadingResources && !resources.connectionReady && <div aria-live="polite" className={db.loadingOverlay} role="status"><Spinner className={db.loadingIcon} size={20} /><strong>Connessione al database</strong><span className={db.loadingDescription}>Apertura della sessione…</span></div>}
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
      <DatabaseConnectionDialog
        draft={connections.connectionDraft} editingConnectionId={connections.editingConnectionId} error={connections.connectionDraftError}
        nameInputRef={connections.connectionNameInput} onClose={connections.closeConnectionModal} onDraftChange={connections.publishConnectionDraft}
        onSave={connections.saveConnection} open={connections.connectionModalOpen} openerRef={connections.connectionDialogOpener}
      />
    </section>
  </Splitter.Root>
}
