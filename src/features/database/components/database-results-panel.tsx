import type { RefObject } from 'react'
import { Button, ErrorNotice, Tabs } from '@/components/ui'
import type { UserError } from '@/lib/user-error'
import { gridDraftIdentity } from '../model/database-connections'
import type { QueryHistoryRefreshFailure } from '../model/database.types'
import { databaseStyles as db } from '@/theme/styles/database'
import { DatabaseTableGrid, type DatabaseTableDraftGuard } from './database-table-grid'

type DatabaseResultsPanelProps = {
  historyFailure: QueryHistoryRefreshFailure | null
  onDraftGuardChange: (guard: DatabaseTableDraftGuard | null) => void
  onLoadMoreQuery: () => void
  onLoadMoreTableRows: () => void
  onRequestSaveTableChanges: (changes: DatabaseTableChange[]) => void
  onRetryHistory: (connectionId: string) => Promise<void>
  onRetryTable: () => void
  onTableFilterChange: (value: string) => void
  result: DatabaseQueryResult | null
  resultsRegion: RefObject<HTMLElement | null>
  selected: DatabaseConnection | null
  selectedTableName: string | null
  tableError: UserError | null
  tableFilter: string
  tableLoading: boolean
  tablePage: DatabaseTablePage | null
  tableRevision: number
  transactionActive: boolean
  workspace: string
}

export function DatabaseResultsPanel({
  historyFailure,
  onDraftGuardChange,
  onLoadMoreQuery,
  onLoadMoreTableRows,
  onRequestSaveTableChanges,
  onRetryHistory,
  onRetryTable,
  onTableFilterChange,
  result,
  resultsRegion,
  selected,
  selectedTableName,
  tableError,
  tableFilter,
  tableLoading,
  tablePage,
  tableRevision,
  transactionActive,
  workspace,
}: DatabaseResultsPanelProps) {
  return <Tabs.Content value="data" className={db.viewPanel}>
    {historyFailure && <ErrorNotice
      action={historyFailure.recovery === 'copy-query'
        ? { label: 'Copia query', onClick: () => navigator.clipboard.writeText(historyFailure.sql ?? '') }
        : { label: 'Aggiorna cronologia', pendingLabel: 'Aggiornamento cronologia…', onClick: () => onRetryHistory(historyFailure.connectionId) }}
      error={historyFailure.error}
    />}
    {tableError && <ErrorNotice action={{ label: 'Riprova lettura', onClick: onRetryTable }} error={tableError} />}
    {selectedTableName && selected
      ? <DatabaseTableGrid
          key={`${selectedTableName}:${tableRevision}`}
          draftIdentity={gridDraftIdentity(workspace, selected.id, selectedTableName)}
          filter={tableFilter}
          loading={tableLoading}
          onDraftGuardChange={onDraftGuardChange}
          onFilterChange={onTableFilterChange}
          onLoadMore={onLoadMoreTableRows}
          onRequestSave={onRequestSaveTableChanges}
          page={tablePage}
          transactionActive={transactionActive}
        />
      : <section className={db.results} aria-live="polite" ref={resultsRegion} tabIndex={-1}>
          {result
            ? <>
                <div className={db.resultsSummary}>
                  <p className={db.resultsSummaryText}>{result.rows.length} righe · {result.durationMs} ms{result.affectedRows !== null ? ` · ${result.affectedRows} coinvolte` : ''}</p>
                  {result.hasMore && <Button size="sm" variant="outline" onClick={onLoadMoreQuery}>Carica altre righe</Button>}
                </div>
                <table className={db.resultsTable}>
                  <thead><tr>{result.columns.map((column) => <th className={db.resultsHeaderCell} key={column}>{column}</th>)}</tr></thead>
                  <tbody>{result.rows.map((row, index) => <tr key={index}>{result.columns.map((column) => <td className={db.resultsCell} key={column}>{String(row[column] ?? '')}</td>)}</tr>)}</tbody>
                </table>
              </>
            : <p className={db.resultsEmpty}>Seleziona una tabella dallo schema o esegui una query.</p>}
        </section>}
  </Tabs.Content>
}
