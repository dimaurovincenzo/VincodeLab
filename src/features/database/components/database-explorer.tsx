import { useMemo } from 'react'
import { FilePenLine, Plus, Trash2 } from 'lucide-react'
import { Button, ErrorNotice, Field, IconButton, SelectField, Spinner, Tabs, TreeView, createTreeCollection } from '@/components/ui'
import type { UserError } from '@/lib/user-error'
import { databaseDriverLabel as driverLabel, tableLabel, tableSchemaName } from '../model/database-connections'
import type { DatabaseSchema, DatabaseSchemaTreeNode as SchemaTreeNode } from '../model/database.types'
import { databaseStyles as db } from '@/theme/styles/database'
import { DatabaseSchemaTreeNodeView } from './database-schema-tree-node'

type DatabaseExplorerProps = {
  activeSavedQueryId: string | null
  connectionError: UserError | null
  connectionReady: boolean
  connections: DatabaseConnection[]
  expandedSchemas: Set<string>
  history: DatabaseHistoryEntry[]
  loadingConnections: boolean
  loadingMoreSchema: boolean
  onClearHistory: () => void
  onDeleteConnection: (connection: DatabaseConnection) => void
  onDeleteSavedQuery: (query: DatabaseSavedQuery) => void
  onEditConnection: (connection: DatabaseConnection, opener: HTMLElement) => void
  onExpandedSchemasChange: (schemas: Set<string>) => void
  onLoadMoreSchema: () => void
  onNewConnection: (opener: HTMLElement) => void
  onOpenRoutine: (routine: DatabaseRoutine) => void
  onOpenSql: (sql: string, savedQueryId?: string | null) => void
  onOpenTable: (tableName: string) => void
  onReloadConnections: () => void
  onSchemaFilterChange: (value: string) => void
  onSelectConnection: (connection: DatabaseConnection | null) => void
  onSidebarTabChange: (value: 'items' | 'queries' | 'history') => void
  savedQueries: DatabaseSavedQuery[]
  schema: DatabaseSchema
  schemaFilter: string
  schemaHasMore: boolean
  selected: DatabaseConnection | null
  selectedTableName: string | null
  sidebarTab: 'items' | 'queries' | 'history'
}

export function DatabaseExplorer({
  activeSavedQueryId,
  connectionError,
  connectionReady,
  connections,
  expandedSchemas,
  history,
  loadingConnections,
  loadingMoreSchema,
  onClearHistory,
  onDeleteConnection,
  onDeleteSavedQuery,
  onEditConnection,
  onExpandedSchemasChange,
  onLoadMoreSchema,
  onNewConnection,
  onOpenRoutine,
  onOpenSql,
  onOpenTable,
  onReloadConnections,
  onSchemaFilterChange,
  onSelectConnection,
  onSidebarTabChange,
  savedQueries,
  schema,
  schemaFilter,
  schemaHasMore,
  selected,
  selectedTableName,
  sidebarTab,
}: DatabaseExplorerProps) {
  const routines = useMemo(() => Array.isArray(schema.routines) ? schema.routines : [], [schema.routines])
  const schemaGroups = useMemo(() => {
    const search = schemaFilter.trim().toLocaleLowerCase('it-IT')
    return schema.tables
      .filter((table) => !search || table.name.toLocaleLowerCase('it-IT').includes(search) || table.columns.some((column) => column.name.toLocaleLowerCase('it-IT').includes(search)))
      .reduce<Map<string, DatabaseTableSchema[]>>((groups, table) => {
        const group = tableSchemaName(table.name)
        groups.set(group, [...(groups.get(group) ?? []), table])
        return groups
      }, new Map())
  }, [schema.tables, schemaFilter])
  const routineGroups = useMemo(() => {
    const search = schemaFilter.trim().toLocaleLowerCase('it-IT')
    const matches = routines.filter((routine) => !search || routine.name.toLocaleLowerCase('it-IT').includes(search))
    return {
      procedures: matches.filter((routine) => routine.kind === 'procedure'),
      functions: matches.filter((routine) => routine.kind === 'function'),
    }
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

  return <Tabs.Root asChild value={sidebarTab} onValueChange={({ value }) => onSidebarTabChange(value as typeof sidebarTab)}>
    <aside className={db.sidebar}>
      <Tabs.List aria-label="Esplora database" className={db.explorerTabs}>
        <Tabs.Trigger value="items">Tabelle</Tabs.Trigger>
        <Tabs.Trigger value="queries">Query <small className={db.tabCount}>{savedQueries.length}</small></Tabs.Trigger>
        <Tabs.Trigger value="history">Cronologia <small className={db.tabCount}>{history.length}</small></Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>
      <section className={db.explorerContent}>
        <Tabs.Content className={db.schemaContent} value="items">
          {!selected
            ? <p className={db.listEmpty}>Seleziona o crea una connessione. Nessun database viene aperto automaticamente.</p>
            : !connectionReady
              ? <div className={db.explorerList}>
                  <p className={db.listEmpty}>“{selected.name}” è selezionata ma non connessa.</p>
                  <p className={db.listEmpty}>Usa “Connetti” nella barra principale. La connessione parte solo su tua richiesta.</p>
                </div>
              : <>
                  <Field.Root className={db.schemaFilter}>
                    <Field.Input aria-label="Cerca nello schema" value={schemaFilter} onChange={(event) => onSchemaFilterChange(event.target.value)} placeholder="Cerca nelle risorse caricate…" />
                  </Field.Root>
                  <TreeView.Root
                    collection={schemaTreeCollection}
                    expandedValue={schemaExpandedValue}
                    selectedValue={schemaSelectedValue}
                    selectionMode="single"
                    translations={{ treeLabel: 'Schema database' }}
                    onExpandedChange={({ expandedNodes }) => {
                      if (schemaFilter.trim()) return
                      onExpandedSchemasChange(new Set(expandedNodes.flatMap((node) => node.kind === 'group' && node.expansionKey ? [node.expansionKey] : [])))
                    }}
                    onSelectionChange={({ selectedNodes }) => {
                      const node = selectedNodes.at(-1)
                      if (node?.kind === 'table' && node.tableName) onOpenTable(node.tableName)
                      if (node?.kind === 'routine' && node.routine) onOpenRoutine(node.routine)
                    }}
                  >
                    <TreeView.Tree className={db.schemaTree}>
                      {schemaTreeCollection.getNodeChildren(schemaTreeCollection.rootNode).map((node, index) => <DatabaseSchemaTreeNodeView indexPath={[index]} key={node.value} node={node} />)}
                    </TreeView.Tree>
                  </TreeView.Root>
                  {schemaHasMore && <Button size="sm" variant="outline" disabled={loadingMoreSchema} onClick={onLoadMoreSchema}>
                    {loadingMoreSchema && <Spinner size={14} />} {loadingMoreSchema ? 'Caricamento…' : 'Carica altre risorse'}
                  </Button>}
                </>}
        </Tabs.Content>
        <Tabs.Content value="queries" className={db.explorerList}>
          {savedQueries.length
            ? savedQueries.map((query) => <div className={db.savedQuery} key={query.id}>
                <Button className={db.queryButton} variant="plain" aria-current={activeSavedQueryId === query.id ? 'true' : undefined} onClick={() => onOpenSql(query.sql, query.id)}>{query.name}</Button>
                <IconButton size="icon-xs" tone="danger" tooltip={`Elimina ${query.name}`} onClick={() => onDeleteSavedQuery(query)}><Trash2 size={13} /></IconButton>
              </div>)
            : <p className={db.listEmpty}>Nessuna query salvata.</p>}
        </Tabs.Content>
        <Tabs.Content value="history" className={db.historyPanel}>
          <header className={db.historyToolbar}>
            <span>Query eseguite</span>
            <Button size="xs" tone="danger" variant="plain" aria-label="Pulisci cronologia query" disabled={!history.length} onClick={onClearHistory} title="Pulisci cronologia"><Trash2 size={13} /> Pulisci</Button>
          </header>
          <div className={db.explorerList}>
            {history.length
              ? history.map((entry) => <Button className={db.queryButton} variant="plain" key={entry.id} onClick={() => onOpenSql(entry.sql)} title={entry.sql}>{entry.sql.slice(0, 72)}</Button>)
              : <p className={db.listEmpty}>Nessuna query nella cronologia.</p>}
          </div>
        </Tabs.Content>
      </section>
      <footer className={db.connectionSwitcher}>
        {loadingConnections
          ? <Spinner size={14} />
          : connectionError
            ? <ErrorNotice action={{ label: 'Riprova', onClick: onReloadConnections }} error={connectionError} />
            : <>
                <SelectField
                  aria-label="Connessione database attiva"
                  placeholder="Nessuna connessione"
                  options={connections.map((connection) => ({ value: connection.id, label: `${connection.name} · ${driverLabel(connection.driver)}` }))}
                  value={selected?.id ?? ''}
                  onValueChange={(value) => onSelectConnection(connections.find((connection) => connection.id === value) ?? null)}
                />
                {selected && <>
                  <IconButton tooltip={`Modifica ${selected.name}`} onClick={(event) => onEditConnection(selected, event.currentTarget)}><FilePenLine size={13} /></IconButton>
                  <IconButton tone="danger" tooltip={`Elimina ${selected.name}`} onClick={() => onDeleteConnection(selected)}><Trash2 size={13} /></IconButton>
                </>}
                <IconButton tooltip="Nuova connessione" aria-label="Nuova connessione database" onClick={(event) => onNewConnection(event.currentTarget)}><Plus size={15} /></IconButton>
              </>}
      </footer>
    </aside>
  </Tabs.Root>
}
