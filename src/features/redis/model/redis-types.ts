import type { RedisKeyType } from '@/bridge'

export type RedisKeyTypeFilter = 'all' | RedisKeyType

export const redisKeyTypes = [
  'all',
  'string',
  'hash',
  'list',
  'set',
  'zset',
  'stream',
  'json',
] as const satisfies readonly RedisKeyTypeFilter[]

export type RedisWorkspaceSession = Readonly<{
  selectedConnectionId: string | null
  databaseIndex: number
  view: 'keys' | 'search'
  typeFilter: RedisKeyTypeFilter
  inspectorTab: 'value' | 'metadata'
}>

export type RedisWorkbenchContext = Readonly<{
  connectionId: string | null
  canDisconnect: boolean
  searching: boolean
}>

export function redisTypeLabel(type: RedisKeyTypeFilter) {
  const labels: Record<RedisKeyTypeFilter, string> = {
    all: 'Tutti i tipi',
    string: 'String',
    hash: 'Hash',
    list: 'List',
    set: 'Set',
    zset: 'Sorted set',
    stream: 'Stream',
    json: 'JSON',
  }
  return labels[type]
}
