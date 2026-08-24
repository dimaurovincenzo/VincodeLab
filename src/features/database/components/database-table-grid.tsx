import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Save, Search, X } from 'lucide-react'
import { Button, Editable, ErrorNotice, Field, IconButton, Spinner } from '@/components/ui'
import { databaseStyles as db } from '@/theme/styles/database'
import { discardVolatileDraft, readVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

export type DatabaseTableGridProps = {
  page: DatabaseTablePage | null
  loading: boolean
  filter: string
  transactionActive: boolean
  draftIdentity: VolatileDraftIdentity
  onFilterChange: (value: string) => void
  onLoadMore: () => void
  onRequestSave: (changes: DatabaseTableChange[]) => void
  onDraftGuardChange?: (guard: DatabaseTableDraftGuard | null) => void
}

type Draft = { key: Record<string, unknown>; values: Record<string, unknown> }
export type DatabaseTableDraftGuard = {
  hasChanges: () => boolean
  discardAll: () => void
}

function valueText(value: unknown) {
  if (value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '')
}

function draftId(key: Record<string, unknown>) {
  return JSON.stringify(Object.entries(key).sort(([left], [right]) => left.localeCompare(right)))
}

type RestoredDrafts = { drafts: Record<string, Draft>; failure: UserError | null }

function restoredDrafts(identity: VolatileDraftIdentity): RestoredDrafts {
  const snapshot = readVolatileDraft(identity)
  if (!snapshot) return { drafts: {}, failure: null }
  try {
    const value = JSON.parse(snapshot.content) as Record<string, Draft>
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    for (const draft of Object.values(value)) {
      if (!draft || typeof draft !== 'object' || !draft.key || typeof draft.key !== 'object' || !draft.values || typeof draft.values !== 'object') throw new Error('invalid')
    }
    return { drafts: value, failure: null }
  } catch (error) {
    return {
      drafts: {},
      failure: reportUserError(normalizeUserError(error, {
        category: 'persistence',
        code: 'DB_GRID_DRAFT_INVALID',
        component: 'database-grid',
        operation: 'restore-table-draft',
        severity: 'warning',
        title: 'Modifiche celle non ripristinate',
        description: 'La bozza della tabella non è leggibile e non è stata applicata. I dati del database non sono stati modificati; puoi rimuovere soltanto la bozza non valida.',
      })),
    }
  }
}

export function DatabaseTableGrid({ page, loading, filter, transactionActive, draftIdentity, onFilterChange, onLoadMore, onRequestSave, onDraftGuardChange }: DatabaseTableGridProps) {
  const [restored] = useState(() => restoredDrafts(draftIdentity))
  const [drafts, setDrafts] = useState<Record<string, Draft>>(restored.drafts)
  const draftsRef = useRef(drafts)
  const [activeCell, setActiveCell] = useState<string | null>(null)
  const [draftRecoveryFailure, setDraftRecoveryFailure] = useState<UserError | null>(restored.failure)
  const changes = useMemo(() => Object.values(drafts), [drafts])

  const discardAll = useCallback(() => {
    draftsRef.current = {}
    setDrafts({})
    setActiveCell(null)
    discardVolatileDraft(draftIdentity)
  }, [draftIdentity])

  useEffect(() => {
    if (!onDraftGuardChange) return
    const guard: DatabaseTableDraftGuard = {
      hasChanges: () => Object.keys(draftsRef.current).length > 0,
      discardAll,
    }
    onDraftGuardChange(guard)
    return () => onDraftGuardChange(null)
  }, [discardAll, onDraftGuardChange])

  const changeCell = (row: Record<string, unknown>, column: DatabaseColumn, value: unknown) => {
    if (!page || !column.editable || !transactionActive) return
    const key = Object.fromEntries(page.table.primaryKey.map((name) => [name, row[name]]))
    const id = draftId(key)
    setDrafts((current) => {
      const previous = current[id] ?? { key, values: {} }
      const values = { ...previous.values }
      if (value === row[column.name]) delete values[column.name]
      else values[column.name] = value
      if (!Object.keys(values).length) {
        const next = { ...current }
        delete next[id]
        draftsRef.current = next
        writeVolatileDraft(draftIdentity, JSON.stringify(next), '{}')
        return next
      }
      const next = { ...current, [id]: { key, values } }
      draftsRef.current = next
      writeVolatileDraft(draftIdentity, JSON.stringify(next), '{}')
      return next
    })
  }

  if (!page) return <section className={db.gridEmptyRoot} aria-live="polite"><div className={db.gridEmpty}><Search aria-hidden="true" size={18} /><p className={db.gridEmptyText}>Seleziona una tabella dallo schema per visualizzarne i dati.</p></div></section>

  const editable = !page.readOnlyReason && transactionActive
  return <section className={db.grid} aria-label={`Dati tabella ${page.table.name}`}>
    {draftRecoveryFailure && <ErrorNotice
      action={{
        label: 'Rimuovi bozza',
        onClick: () => {
          discardVolatileDraft(draftIdentity)
          setDraftRecoveryFailure(null)
        },
      }}
      error={draftRecoveryFailure}
    />}
    <header className={db.gridHeader}>
      <div className={db.gridHeaderCopy}><strong className={db.gridTitle}>{page.table.name}</strong><small className={db.gridMeta}>{page.rows.length} righe · {page.durationMs} ms{changes.length ? ` · ${changes.length} Modifiche da salvare` : ''}</small></div>
      <div className={db.gridActions}>
        <Field.Root className={db.gridFilter}><Search aria-hidden="true" size={14} /><Field.Input className={db.gridFilterInput} aria-label="Filtra righe tabella" value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="Filtra testo…" /></Field.Root>
        <Button size="sm" variant="outline" disabled={!changes.length} onClick={discardAll}><RotateCcw size={14} /> Annulla</Button>
        <Button size="sm" disabled={!editable || !changes.length} onClick={() => onRequestSave(changes)}><Save size={14} /> Salva{changes.length ? ` (${changes.length})` : ''}</Button>
      </div>
    </header>
    {page.readOnlyReason ? <p className={db.gridNotice()}>{page.readOnlyReason}</p> : !transactionActive ? <p className={db.gridNotice()}>Avvia una transazione per modificare le celle. Le modifiche restano reversibili fino al Commit.</p> : <p className={db.gridNotice({ editable: true })}>Modalità modifica attiva: premi Esc per annullare una cella, Tab per passare alla successiva.</p>}
    <div className={db.gridScroll}><table className={db.gridTable}><thead><tr>{page.table.columns.map((column) => <th className={db.gridHeaderCell} key={column.name} title={column.type}><span className={db.gridHeaderName}>{column.name}</span>{column.primaryKeyPosition ? <small className={db.gridHeaderType}>PK</small> : <small className={db.gridHeaderType}>{column.type ?? '—'}</small>}</th>)}</tr></thead><tbody>{page.rows.map((row, rowIndex) => {
      const key = Object.fromEntries(page.table.primaryKey.map((name) => [name, row[name]]))
      const rowId = page.table.primaryKey.length ? draftId(key) : `${page.offset + rowIndex}`
      const rowDraft = drafts[draftId(key)]?.values ?? {}
      return <tr className={db.gridRow({ changed: Object.keys(rowDraft).length > 0 })} key={rowId}>
        {page.table.columns.map((column) => {
          const draftValue = rowDraft[column.name]
          const isChanged = Object.hasOwn(rowDraft, column.name)
          const value = isChanged ? draftValue : row[column.name]
          const cellId = `${rowId}:${column.name}`
          const canEdit = !page.readOnlyReason && column.editable && transactionActive
          return <td className={db.gridCell({ changed: isChanged })} key={column.name}>{canEdit ? <Editable.Root activationMode="focus" edit={activeCell === cellId} onEditChange={({ edit }) => setActiveCell(edit ? cellId : null)} onValueChange={({ value: nextValue }) => changeCell(row, column, nextValue)} onValueRevert={() => changeCell(row, column, row[column.name])} submitMode="both" translations={{ edit: `Modifica ${column.name}, riga ${page.offset + rowIndex + 1}` }} value={valueText(value)}>
            <Editable.Area><Editable.Input aria-label={`${column.name}, riga ${page.offset + rowIndex + 1}`} /><Editable.Preview title="Seleziona o usa Tab per modificare">{value === null ? <em className={db.nullValue}>NULL</em> : valueText(value)}</Editable.Preview></Editable.Area>
            {column.nullable && activeCell === cellId && <Editable.Control><IconButton size="icon-xs" tooltip={`Imposta NULL per ${column.name}`} onPointerDown={(event) => event.preventDefault()} onClick={() => { changeCell(row, column, null); setActiveCell(null) }}><X size={12} /></IconButton></Editable.Control>}
          </Editable.Root> : <span className={db.gridCellValue} title={valueText(value)}>{value === null ? <em className={db.nullValue}>NULL</em> : valueText(value)}</span>}</td>
        })}</tr>
    })}</tbody></table></div>
    <footer className={db.gridFooter}>{loading ? <span className={db.gridLoading}><Spinner size={14} /> Caricamento righe…</span> : page.hasMore ? <Button size="sm" variant="outline" onClick={onLoadMore}>Carica altre righe</Button> : <span>Tutte le righe disponibili sono state caricate.</span>}</footer>
  </section>
}
