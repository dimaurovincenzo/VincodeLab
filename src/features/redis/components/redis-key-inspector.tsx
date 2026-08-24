import { Braces, Database, RefreshCw } from 'lucide-react'
import { memo } from 'react'
import { Button, ErrorNotice, Spinner, Tabs } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { redisTypeLabel, type RedisInspection } from '../model/redis-types'
import type { UserError } from '@/lib/user-error'
import { redisStyles as rs, redisTypeBadge } from '@/theme/styles/redis'

const MAX_VISIBLE_ITEMS_LABEL = '2.000'

type Props = {
  disabled?: boolean
  error: UserError | null
  inspection: RedisInspection | null
  loading: boolean
  selectedKey: string | null
  tab: 'value' | 'metadata'
  onLoadMore: () => void
  onRefresh: () => void
  onTabChange: (tab: 'value' | 'metadata') => void
}

function humanBytes(value?: number) {
  if (value === undefined) return 'non disponibile'
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

function ttlText(value: number | null, state?: RedisInspection['ttlState']) {
  if (state === 'unavailable') return 'Non disponibile'
  if (state === 'missing') return 'Chiave non più disponibile'
  if (value === null || value < 0) return 'Nessuna scadenza'
  return `${value.toLocaleString('it-IT')} ms`
}

function inspectionHasMore(inspection: RedisInspection) {
  return inspection.type !== 'string' && inspection.type !== 'json' && inspection.hasMore
}

function KeyValueTable({ headers, rows }: { headers: readonly string[]; rows: ReadonlyArray<readonly string[]> }) {
  return <table className={rs.dataTable}><thead><tr>{headers.map((header) => <th className={rs.tableHeader} key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr className={rs.tableRow} key={`${row[0]}:${rowIndex}`}>{row.map((cell, index) => <td className={`${rs.tableCell} ${index === 0 ? rs.indexCell : ''}`} key={index}>{cell}</td>)}</tr>)}</tbody></table>
}

const InspectionValue = memo(function InspectionValue({ inspection }: { inspection: RedisInspection }) {
  if (inspection.type === 'string') return <pre className={rs.codeBlock}>{inspection.value}</pre>
  if (inspection.type === 'json') return <pre className={rs.codeBlock}>{JSON.stringify(inspection.value, null, 2)}</pre>
  if (inspection.type === 'hash') return <KeyValueTable headers={['Campo', 'Valore']} rows={inspection.entries.map((entry) => [entry.field, entry.value])} />
  if (inspection.type === 'list') return <KeyValueTable headers={['Indice', 'Valore']} rows={inspection.items.map((item) => [String(item.index), item.value])} />
  if (inspection.type === 'set') return <KeyValueTable headers={['#', 'Membro']} rows={inspection.members.map((member, index) => [String(index + 1), member])} />
  if (inspection.type === 'zset') return <KeyValueTable headers={['Score', 'Membro']} rows={inspection.members.map((member) => [String(member.score), member.value])} />
  return <KeyValueTable headers={['ID', 'Campi']} rows={inspection.entries.map((entry) => [entry.id, entry.fields.map((field) => `${field.field}: ${field.value}`).join('\n')])} />
})

export const RedisKeyInspector = memo(function RedisKeyInspector({ disabled = false, error, inspection, loading, selectedKey, tab, onLoadMore, onRefresh, onTabChange }: Props) {
  if (!selectedKey) return <EmptyState description="Scegli una chiave dal browser per leggerne valore, struttura e scadenza." eyebrow="Inspector in sola lettura" icon={<Database size={24} />} title="Nessuna chiave selezionata" />
  if (error) return <ErrorNotice action={{ label: 'Riprova lettura', onClick: onRefresh }} className={rs.notice} error={error} />
  if (loading || !inspection) return <div className={rs.centerState} role="status"><Spinner size={20} /><span>Lettura della chiave…</span></div>

  return <Tabs.Root asChild value={tab} onValueChange={({ value }) => onTabChange(value as 'value' | 'metadata')}><section className={rs.inspector} data-context-has-visible-value={tab === 'value' ? 'true' : undefined} data-context-menu-id={inspection.keyRef} data-context-menu-kind="redis-key">
    <header className={rs.inspectorHeader}>
      <div>
        <h2 className={rs.keyHeading}>{inspection.key}{inspection.binary ? ' · binaria' : ''}</h2>
        <div className={rs.keyFacts}>
          <span className={redisTypeBadge({ type: inspection.type })}>{redisTypeLabel(inspection.type)}</span>
          <span className={rs.fact}>TTL · {ttlText(inspection.ttlMs, inspection.ttlState)}</span>
          <span className={rs.fact}>Memoria · {humanBytes(inspection.sizeBytes)}</span>
          {inspection.type === 'string' && inspection.truncated && <span className={rs.fact}>Anteprima · {humanBytes(inspection.previewBytes)} di {humanBytes(inspection.totalBytes)}</span>}
          {inspection.viewTruncated && <span className={rs.fact}>Vista limitata a {MAX_VISIBLE_ITEMS_LABEL} elementi</span>}
          {inspection.encoding && <span className={rs.fact}>Encoding · {inspection.encoding}</span>}
        </div>
      </div>
      <Button disabled={disabled} size="sm" variant="outline" onClick={onRefresh}><RefreshCw aria-hidden="true" size={14} /> Aggiorna</Button>
    </header>
    <div className={rs.content}>
      <Tabs.List aria-label="Dettagli chiave Redis" className={rs.viewTabs}><Tabs.Trigger value="value">Valore</Tabs.Trigger><Tabs.Trigger value="metadata">Metadati</Tabs.Trigger><Tabs.Indicator /></Tabs.List>
      <Tabs.Content className={rs.viewPanel} value="value"><div className={rs.dataRegion}><InspectionValue inspection={inspection} /></div></Tabs.Content>
      <Tabs.Content className={rs.viewPanel} value="metadata"><div className={rs.dataRegion}><KeyValueTable headers={['Proprietà', 'Valore']} rows={[
        ['Chiave', inspection.key],
        ['Tipo', redisTypeLabel(inspection.type)],
        ['TTL', ttlText(inspection.ttlMs, inspection.ttlState)],
        ['Memoria', humanBytes(inspection.sizeBytes)],
        ...(inspection.type === 'string' ? [['Dimensione valore', humanBytes(inspection.totalBytes)], ['Anteprima completa', inspection.truncated ? 'No' : 'Sì']] : []),
        ['Encoding', inspection.encoding ?? 'non disponibile'],
      ]} /></div></Tabs.Content>
    </div>
    {inspectionHasMore(inspection) && <footer className={rs.loadMore}><Button disabled={disabled} size="sm" variant="outline" onClick={onLoadMore}>Carica altri elementi</Button></footer>}
  </section></Tabs.Root>
})

export function RedisInspectorEmpty() {
  return <EmptyState description="Configura o seleziona una connessione Redis per iniziare a esplorare le chiavi." eyebrow="Redis" icon={<Braces size={24} />} title="Nessuna connessione attiva" />
}
