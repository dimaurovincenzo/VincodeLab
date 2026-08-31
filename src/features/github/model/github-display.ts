import type { CacheMetadata } from '@/bridge'

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(new Date(value))
}

export function formatRelativeDate(value: string, now = Date.now()) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''

  const difference = timestamp - now
  const absoluteDifference = Math.abs(difference)
  const formatter = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' })
  if (absoluteDifference < 60_000) return formatter.format(Math.round(difference / 1_000), 'second')
  if (absoluteDifference < 3_600_000) return formatter.format(Math.round(difference / 60_000), 'minute')
  if (absoluteDifference < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), 'hour')
  if (absoluteDifference < 604_800_000) return formatter.format(Math.round(difference / 86_400_000), 'day')
  return formatDate(value)
}

export function formatCacheState(cache: CacheMetadata | null, now = Date.now()) {
  if (!cache) return null
  if (cache.stale) return 'Dati non aggiornati'
  const minutes = Math.max(0, Math.floor((now - cache.fetchedAt) / 60_000))
  return minutes === 0 ? 'Aggiornato ora' : `Aggiornato ${minutes} min fa`
}
