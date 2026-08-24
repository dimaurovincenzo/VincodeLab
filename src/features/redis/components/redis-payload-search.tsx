import { Search, Square, TextSearch } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, ErrorNotice, Field, Progress, SelectField, Spinner } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { redisApi } from '../api/redis.bridge'
import { redisKeyTypes, redisTypeLabel, type RedisKeyTypeFilter, type RedisPayloadMatch, type RedisPayloadSearchProgress } from '../model/redis-types'
import { redisStyles as rs, redisTypeBadge } from '@/theme/styles/redis'

type Props = {
  connectionId: string
  disabled?: boolean
  focusRequest?: number
  keyRequest?: { keyPattern: string; keyRef: string; nonce: number }
  onOpenKey: (match: RedisPayloadMatch) => void
  onSearchingChange: (searching: boolean) => void
  onVisibleMatchesChange?: (matches: readonly RedisPayloadMatch[]) => void
}

const PROGRESS_UPDATE_INTERVAL_MS = 50
const PROGRESS_ANNOUNCEMENT_INTERVAL_MS = 5_000
const redisTypeOptions = redisKeyTypes.map((value) => ({ value, label: redisTypeLabel(value) }))

function reportSearchError(error: unknown, operation: string, title: string, fallbackDescription: string) {
  return reportUserError(normalizeUserError(error, { category: 'database', component: 'redis-payload-search', operation, title, fallbackDescription }))
}

function mergeMatches(current: readonly RedisPayloadMatch[], incoming: readonly RedisPayloadMatch[]) {
  const merged = new Map(current.map((match) => [`${match.keyRef}\0${match.path ?? ''}`, match]))
  for (const match of incoming) merged.set(`${match.keyRef}\0${match.path ?? ''}`, match)
  return [...merged.values()].slice(0, 100)
}

function analyzedKeyCountLabel(value: number) {
  return `${value.toLocaleString('it-IT')} ${value === 1 ? 'chiave analizzata' : 'chiavi analizzate'}`
}

function matchCountLabel(value: number) {
  return `${value.toLocaleString('it-IT')} ${value === 1 ? 'risultato' : 'risultati'}`
}

export function RedisPayloadSearch({ connectionId, disabled = false, focusRequest = 0, keyRequest, onOpenKey, onSearchingChange, onVisibleMatchesChange }: Props) {
  const api = redisApi()
  const [query, setQuery] = useState('')
  const [keyPattern, setKeyPattern] = useState('*')
  const [exactKeyRef, setExactKeyRef] = useState<string | undefined>()
  const [type, setType] = useState<RedisKeyTypeFilter>('all')
  const [matches, setMatches] = useState<readonly RedisPayloadMatch[]>([])
  const [scanned, setScanned] = useState(0)
  const [estimatedTotal, setEstimatedTotal] = useState<number | undefined>()
  const [searching, setSearching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [error, setError] = useState<UserError | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const activeOperation = useRef<string | null>(null)
  const requestRevision = useRef(0)
  const pendingProgress = useRef<RedisPayloadSearchProgress | null>(null)
  const progressTimer = useRef<number | null>(null)
  const lastProgressAnnouncementAt = useRef(0)

  const clearPendingProgress = useCallback(() => {
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current)
    progressTimer.current = null
    pendingProgress.current = null
  }, [])

  const commitProgress = useCallback((progress: RedisPayloadSearchProgress) => {
    if (progress.operationId !== activeOperation.current) return false
    setScanned(progress.scanned)
    setEstimatedTotal(progress.estimatedTotal)
    setMatches((current) => mergeMatches(current, progress.matches))
    const now = Date.now()
    if (now - lastProgressAnnouncementAt.current >= PROGRESS_ANNOUNCEMENT_INTERVAL_MS) {
      lastProgressAnnouncementAt.current = now
      setAnnouncement(`Ricerca Redis in corso: ${analyzedKeyCountLabel(progress.scanned)}, ${matchCountLabel(progress.matches.length)}.`)
    }
    return true
  }, [])

  const flushPendingProgress = useCallback((operationId: string) => {
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current)
    progressTimer.current = null
    const progress = pendingProgress.current
    pendingProgress.current = null
    return progress?.operationId === operationId && commitProgress(progress) ? progress : null
  }, [commitProgress])

  useEffect(() => { if (focusRequest > 0) inputRef.current?.focus() }, [focusRequest])
  useEffect(() => {
    if (!keyRequest) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- il menu contestuale trasferisce esplicitamente la chiave bersaglio nel filtro della ricerca
    setKeyPattern(keyRequest.keyPattern)
    setExactKeyRef(keyRequest.keyRef)
    inputRef.current?.focus()
  }, [keyRequest])
  useEffect(() => onSearchingChange(searching), [onSearchingChange, searching])
  useLayoutEffect(() => onVisibleMatchesChange?.(matches), [matches, onVisibleMatchesChange])

  useEffect(() => {
    if (!disabled) return
    requestRevision.current += 1
    clearPendingProgress()
    const operationId = activeOperation.current
    activeOperation.current = null
    if (operationId) void api.cancel(operationId).catch((cause) => {
      reportSearchError(cause, 'cancel-search-on-disconnect', 'Ricerca Redis non annullata', 'La disconnessione principale confina comunque la sessione.')
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- il confine di sessione annulla immediatamente lo stato operativo locale
    setSearching(false)
    setCancelling(false)
  }, [api, clearPendingProgress, disabled])

  useEffect(() => {
    const unsubscribe = api.onSearchProgress((progress) => {
      if (progress.operationId !== activeOperation.current) return
      pendingProgress.current = progress
      if (progressTimer.current !== null) return
      progressTimer.current = window.setTimeout(() => {
        progressTimer.current = null
        const next = pendingProgress.current
        pendingProgress.current = null
        if (next) commitProgress(next)
      }, PROGRESS_UPDATE_INTERVAL_MS)
    })
    return () => {
      unsubscribe()
      clearPendingProgress()
    }
  }, [api, clearPendingProgress, commitProgress])

  useEffect(() => () => {
    const operationId = activeOperation.current
    if (operationId) void api.cancel(operationId).catch((cause) => {
      reportSearchError(cause, 'cancel-search-on-unmount', 'Ricerca Redis non annullata', 'La ricerca potrebbe terminare in background.')
    })
  }, [api])

  useEffect(() => {
    requestRevision.current += 1
    clearPendingProgress()
    const operationId = activeOperation.current
    activeOperation.current = null
    if (operationId) void api.cancel(operationId).catch((cause) => {
      reportSearchError(cause, 'cancel-search-on-connection-change', 'Ricerca Redis precedente non annullata', 'La sessione viene comunque confinata dal processo principale.')
    })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- una connessione diversa non può riusare stato o risultati appartenenti alla precedente
    setSearching(false)
    setCancelling(false)
    setMatches([])
    setScanned(0)
    setExactKeyRef(undefined)
    setError(null)
    setAnnouncement('')
    lastProgressAnnouncementAt.current = 0
  }, [api, clearPendingProgress, connectionId])

  const runSearch = useCallback(async () => {
    const normalizedQuery = query.trim()
    if (disabled || !normalizedQuery || searching || activeOperation.current) return
    const revision = ++requestRevision.current
    const operationId = crypto.randomUUID()
    clearPendingProgress()
    activeOperation.current = operationId
    lastProgressAnnouncementAt.current = Date.now()
    setSearching(true)
    setCancelling(false)
    setCancelled(false)
    setTruncated(false)
    setError(null)
    setMatches([])
    setScanned(0)
    setEstimatedTotal(undefined)
    setAnnouncement('Ricerca Redis avviata.')
    try {
      const result = await api.searchPayloads(connectionId, {
        operationId,
        query: normalizedQuery,
        ...(exactKeyRef !== undefined ? { keyRef: exactKeyRef } : {}),
        keyPattern: keyPattern.trim() || '*',
        type: type === 'all' ? undefined : type,
        count: 100,
        limit: 100,
      })
      if (revision !== requestRevision.current) return
      setMatches((current) => mergeMatches(current, result.matches))
      setScanned(result.scanned)
      if (!result.cancelled) setEstimatedTotal(result.scanned)
      setTruncated(result.truncated)
      setCancelled(result.cancelled)
      setAnnouncement(result.cancelled
        ? `Ricerca Redis annullata: ${analyzedKeyCountLabel(result.scanned)}, ${matchCountLabel(result.matches.length)} parziali.`
        : `Ricerca Redis completata: ${analyzedKeyCountLabel(result.scanned)}, ${matchCountLabel(result.matches.length)}.`)
    } catch (cause) {
      if (revision !== requestRevision.current) return
      flushPendingProgress(operationId)
      setError(reportSearchError(cause, 'search-payloads', 'Ricerca nei payload non completata', 'I risultati parziali restano disponibili. Puoi riprovare la stessa ricerca.'))
    } finally {
      if (revision === requestRevision.current) {
        clearPendingProgress()
        activeOperation.current = null
        setSearching(false)
        setCancelling(false)
      }
    }
  }, [api, clearPendingProgress, connectionId, disabled, exactKeyRef, flushPendingProgress, keyPattern, query, searching, type])

  const cancelSearch = useCallback(async () => {
    const operationId = activeOperation.current
    if (!operationId || cancelling) return
    setCancelling(true)
    try {
      await api.cancel(operationId)
    } catch (cause) {
      setError(reportSearchError(cause, 'cancel-payload-search', 'Ricerca non annullata', 'La ricerca è ancora attiva. Prova di nuovo ad annullarla.'))
      setCancelling(false)
    }
  }, [api, cancelling])

  useEffect(() => {
    const listener = () => { void cancelSearch() }
    window.addEventListener('vincodelab:redis-cancel-search', listener)
    return () => window.removeEventListener('vincodelab:redis-cancel-search', listener)
  }, [cancelSearch])

  const progressValue = useMemo(() => estimatedTotal && estimatedTotal > 0 ? Math.min(100, scanned / estimatedTotal * 100) : null, [estimatedTotal, scanned])

  return <section aria-disabled={disabled || undefined} aria-label="Ricerca nei payload Redis" className={rs.search}>
    <span aria-atomic="true" className={rs.srOnly} role="status">{announcement}</span>
    <form className={rs.searchForm} onSubmit={(event) => { event.preventDefault(); void runSearch() }}>
      <Field.Root disabled={disabled}><Field.Input aria-label="Testo da cercare nei payload" placeholder="Testo nel valore, campo o membro…" ref={inputRef} required value={query} onChange={(event) => setQuery(event.target.value)} /></Field.Root>
      <Field.Root disabled={disabled}><Field.Input aria-label="Pattern chiavi per ricerca payload" placeholder="Chiavi: *" value={keyPattern} onChange={(event) => { setKeyPattern(event.target.value); setExactKeyRef(undefined) }} /></Field.Root>
      <SelectField aria-label="Tipo payload Redis" disabled={disabled} options={redisTypeOptions} value={type} onValueChange={(value) => setType(value as RedisKeyTypeFilter)} />
      {searching ? <Button disabled={disabled || cancelling} type="button" variant="outline" onClick={() => void cancelSearch()}><Square aria-hidden="true" size={13} /> {cancelling ? 'Annullamento…' : 'Annulla'}</Button> : <Button disabled={disabled || !query.trim()} type="submit"><Search aria-hidden="true" size={14} /> Cerca</Button>}
    </form>
    <div>
      {error && <ErrorNotice action={{ label: searching ? 'Annulla di nuovo' : 'Riprova ricerca', onClick: searching ? cancelSearch : runSearch }} className={rs.notice} error={error} />}
      {(searching || scanned > 0) && <div className={rs.progressPanel}>
        <div className={rs.progressHeading}><span>{searching ? 'Ricerca in corso' : cancelled ? 'Ricerca annullata · risultati parziali' : 'Ricerca completata'} · {analyzedKeyCountLabel(scanned)}</span><span>{matchCountLabel(matches.length)}{truncated ? ' · limite raggiunto' : ''}</span></div>
        <Progress.Root value={progressValue}><Progress.Track aria-label="Avanzamento ricerca nei payload Redis"><Progress.Range /></Progress.Track></Progress.Root>
      </div>}
    </div>
    {matches.length ? <ul aria-label="Risultati ricerca payload Redis" className={rs.searchResults}>{matches.map((match, index) => <li className={rs.resultItem} data-context-has-visible-value="true" data-context-menu-id={match.keyRef} data-context-menu-kind="redis-key" key={`${match.keyRef}:${match.path ?? ''}:${index}`}>
      <Button className={rs.resultButton} variant="plain" onClick={() => onOpenKey(match)}>
        <span className={redisTypeBadge({ type: match.type })}>{redisTypeLabel(match.type)}</span>
        <span><strong className={rs.resultKey}>{match.key}{match.binary ? ' · binaria' : ''}</strong>{match.path && <span className={rs.resultPath}>{match.path}</span>}<p className={rs.excerpt}>{match.excerpt}</p></span>
      </Button>
    </li>)}</ul> : searching ? <div className={rs.centerState} role="status"><Spinner size={20} /><span>Analisi dei payload…</span></div> : <EmptyState description="Cerca testo nei valori di stringhe, hash, liste, set, stream e documenti JSON. La scansione può essere annullata senza perdere i risultati già trovati." eyebrow="Ricerca incrementale" icon={<TextSearch size={24} />} title={scanned ? 'Nessuna corrispondenza' : 'Cerca nei payload'} />}
  </section>
}
