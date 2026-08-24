export function formatDate(value: string) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(value))
}

export function formatCacheState(cache: CacheMetadata | null, now = Date.now()) {
  if (!cache) return null
  if (cache.stale) return 'Dati non aggiornati'
  const minutes = Math.max(0, Math.floor((now - cache.fetchedAt) / 60_000))
  return minutes === 0 ? 'Aggiornato ora' : `Aggiornato ${minutes} min fa`
}
