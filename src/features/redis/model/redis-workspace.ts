import type {
  RedisInspection,
  RedisScanPage,
  RedisWorkbenchContext,
  RedisWorkspaceSession,
} from './redis-types'

export type RedisWorkspaceProps = {
  workspace: string
  focusRequest?: number
  initialState?: RedisWorkspaceSession
  onContextChange?: (context: RedisWorkbenchContext) => void
  onSessionChange?: (state: RedisWorkspaceSession) => void
}

export type RedisScanSnapshot = Readonly<{
  inputCursor?: string
  page: RedisScanPage
}>

export type RedisSessionPhase = 'passive' | 'connecting' | 'connected' | 'disconnecting'
export type RedisSessionRecovery = 'connect' | 'disconnect' | 'reconnect'

export const emptyRedisScanPage: RedisScanPage = {
  cursor: '0',
  keys: [],
  scanned: 0,
  hasMore: false,
}

export const MAX_REDIS_SCAN_HISTORY_PAGES = 20
const MAX_REDIS_INSPECTION_ITEMS = 2_000

export function mergeRedisInspection(current: RedisInspection, incoming: RedisInspection): RedisInspection {
  if (current.type !== incoming.type || current.keyRef !== incoming.keyRef) return incoming
  if (current.type === 'hash' && incoming.type === 'hash') {
    const entries = [...current.entries, ...incoming.entries]
    return {
      ...incoming,
      entries: entries.slice(0, MAX_REDIS_INSPECTION_ITEMS),
      hasMore: entries.length < MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore,
      viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || entries.length > MAX_REDIS_INSPECTION_ITEMS || (entries.length === MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore)),
    }
  }
  if (current.type === 'list' && incoming.type === 'list') {
    const items = [...current.items, ...incoming.items]
    return {
      ...incoming,
      items: items.slice(0, MAX_REDIS_INSPECTION_ITEMS),
      hasMore: items.length < MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore,
      viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || items.length > MAX_REDIS_INSPECTION_ITEMS || (items.length === MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore)),
    }
  }
  if (current.type === 'set' && incoming.type === 'set') {
    const members = [...current.members, ...incoming.members]
    return {
      ...incoming,
      members: members.slice(0, MAX_REDIS_INSPECTION_ITEMS),
      hasMore: members.length < MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore,
      viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || members.length > MAX_REDIS_INSPECTION_ITEMS || (members.length === MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore)),
    }
  }
  if (current.type === 'zset' && incoming.type === 'zset') {
    const members = [...current.members, ...incoming.members]
    return {
      ...incoming,
      members: members.slice(0, MAX_REDIS_INSPECTION_ITEMS),
      hasMore: members.length < MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore,
      viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || members.length > MAX_REDIS_INSPECTION_ITEMS || (members.length === MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore)),
    }
  }
  if (current.type === 'stream' && incoming.type === 'stream') {
    const entries = [...current.entries, ...incoming.entries]
    return {
      ...incoming,
      entries: entries.slice(0, MAX_REDIS_INSPECTION_ITEMS),
      hasMore: entries.length < MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore,
      viewTruncated: Boolean(current.viewTruncated || incoming.viewTruncated || entries.length > MAX_REDIS_INSPECTION_ITEMS || (entries.length === MAX_REDIS_INSPECTION_ITEMS && incoming.hasMore)),
    }
  }
  return incoming
}

export function visibleRedisInspectionValue(inspection: RedisInspection) {
  if (inspection.type === 'string') return inspection.value
  if (inspection.type === 'json') return JSON.stringify(inspection.value, null, 2)
  if (inspection.type === 'hash') return inspection.entries.map(({ field, value }) => `${field}\t${value}`).join('\n')
  if (inspection.type === 'list') return inspection.items.map(({ index, value }) => `${index}\t${value}`).join('\n')
  if (inspection.type === 'set') return inspection.members.join('\n')
  if (inspection.type === 'zset') return inspection.members.map(({ score, value }) => `${score}\t${value}`).join('\n')
  return inspection.entries.map((entry) => `${entry.id}\t${entry.fields.map(({ field, value }) => `${field}: ${value}`).join('\t')}`).join('\n')
}
