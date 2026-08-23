import { ChevronLeft, ChevronRight, Database, Filter, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button, Field, IconButton, SelectField, Spinner } from '@/components/ui'
import { ErrorNotice } from '@/components/ui'
import { redisKeyTypes, redisTypeLabel, type RedisKeySummary, type RedisKeyTypeFilter } from '@/lib/redis-types'
import type { UserError } from '@/lib/user-error'
import { redisStyles as rs, redisTypeBadge } from '@/theme/styles/redis'

type Props = {
  cursorDepth: number
  error: UserError | null
  filter: string
  hasMore: boolean
  keys: readonly RedisKeySummary[]
  loading: boolean
  selectedKey: string | null
  typeFilter: RedisKeyTypeFilter
  onFilter: (filter: string, type: RedisKeyTypeFilter) => void
  onNext: () => void
  onPrevious: () => void
  onRefresh: () => void
  onSelect: (key: RedisKeySummary) => void
}

function ttlLabel(ttlMs: number | null, ttlState?: RedisKeySummary['ttlState']) {
  if (ttlState === 'unavailable') return 'TTL non disponibile'
  if (ttlState === 'missing') return 'chiave scaduta'
  if (ttlMs === null || ttlMs < 0) return 'senza scadenza'
  if (ttlMs < 1_000) return `${ttlMs} ms`
  if (ttlMs < 60_000) return `${Math.ceil(ttlMs / 1_000)} s`
  if (ttlMs < 3_600_000) return `${Math.ceil(ttlMs / 60_000)} min`
  return `${Math.ceil(ttlMs / 3_600_000)} h`
}

export function RedisKeyBrowser({ cursorDepth, error, filter, hasMore, keys, loading, selectedKey, typeFilter, onFilter, onNext, onPrevious, onRefresh, onSelect }: Props) {
  const [draftFilter, setDraftFilter] = useState(filter)
  const [draftType, setDraftType] = useState<RedisKeyTypeFilter>(typeFilter)

  return <aside aria-label="Browser chiavi Redis" className={rs.browser}>
    <header className={rs.browserHeader}>
      <strong className={rs.browserTitle}>Chiavi</strong>
      <span className={rs.meta}>{loading ? 'SCAN…' : `${keys.length} in questa pagina`}</span>
    </header>
    <form className={rs.filters} onSubmit={(event) => { event.preventDefault(); onFilter(draftFilter, draftType) }}>
      <Field.Root><Field.Input aria-label="Pattern chiavi Redis" placeholder="Pattern, es. user:*" value={draftFilter} onChange={(event) => setDraftFilter(event.target.value)} /></Field.Root>
      <SelectField aria-label="Tipo chiave Redis" options={redisKeyTypes.map((value) => ({ value, label: redisTypeLabel(value) }))} value={draftType} onValueChange={(value) => setDraftType(value as RedisKeyTypeFilter)} />
      <IconButton aria-label="Applica filtri chiavi" tooltip="Applica filtri" type="submit"><Filter aria-hidden="true" size={14} /></IconButton>
    </form>
    {error ? <ErrorNotice action={{ label: 'Riprova SCAN', onClick: onRefresh }} className={rs.notice} error={error} /> : loading ? <div className={rs.browserStatus} role="status"><Spinner size={18} /> Caricamento chiavi…</div> : keys.length ? <ul aria-label="Chiavi Redis" className={rs.keyList}>{keys.map((item) => <li className={rs.keyItem} data-context-menu-id={item.keyRef} data-context-menu-kind="redis-key" key={item.keyRef}>
      <Button aria-current={selectedKey === item.keyRef ? 'true' : undefined} className={rs.keyButton} title={item.key} variant="plain" onClick={() => onSelect(item)}>
        <span className={redisTypeBadge({ type: item.type })}>{redisTypeLabel(item.type)}</span>
        <span className={rs.keyName}>{item.key}{item.binary ? ' · binaria' : ''}</span>
        <span className={rs.keyTtl}>{ttlLabel(item.ttlMs, item.ttlState)}</span>
      </Button>
    </li>)}</ul> : <div className={rs.browserStatus}><Database aria-hidden="true" size={22} /><p>Nessuna chiave corrisponde ai filtri.</p></div>}
    <footer className={rs.pager}>
      <Button aria-label="Pagina precedente chiavi" disabled={loading || cursorDepth === 0} size="xs" variant="plain" onClick={onPrevious}><ChevronLeft aria-hidden="true" size={14} /> Indietro</Button>
      <IconButton disabled={loading} tooltip="Aggiorna chiavi" onClick={onRefresh}>{loading ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" size={14} />}</IconButton>
      <Button aria-label="Pagina successiva chiavi" disabled={loading || !hasMore} size="xs" variant="plain" onClick={onNext}>Avanti <ChevronRight aria-hidden="true" size={14} /></Button>
    </footer>
  </aside>
}
