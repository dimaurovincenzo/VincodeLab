import { bridgeNamespace } from '@/bridge'

export const redisKeyTypes = ['all', 'string', 'hash', 'list', 'set', 'zset', 'stream', 'json'] as const

export type RedisKeyType = Exclude<(typeof redisKeyTypes)[number], 'all'>
export type RedisKeyTypeFilter = (typeof redisKeyTypes)[number]

export type RedisConnection = Readonly<{
  id: string
  name: string
  mode: 'standalone' | 'sentinel'
  host: string
  port: number
  database: number
  sentinelMasterName?: string
  tls?: boolean
  username?: string
  hasPassword?: boolean
  sentinelUsername?: string
  hasSentinelPassword?: boolean
}>

export type RedisConnectionInput = Readonly<{
  name: string
  mode: 'standalone' | 'sentinel'
  host: string
  port: number
  database: number
  sentinelMasterName?: string
  username?: string
  password?: string
  clearPassword?: boolean
  sentinelUsername?: string
  sentinelPassword?: string
  clearSentinelPassword?: boolean
  tls?: boolean
}>

export type RedisConnectionTestResult = Readonly<{
  ok: boolean
  latencyMs: number
  serverVersion?: string
}>

export type RedisKeySummary = Readonly<{
  key: string
  keyRef: string
  binary?: boolean
  type: RedisKeyType
  ttlMs: number | null
  ttlState?: 'expires' | 'persistent' | 'missing' | 'unavailable'
  sizeBytes?: number
}>

export type RedisScanInput = Readonly<{
  cursor?: string
  match?: string
  type?: RedisKeyType
  count?: number
}>

export type RedisScanPage = Readonly<{
  cursor: string
  keys: RedisKeySummary[]
  scanned: number
  hasMore: boolean
}>

type RedisInspectionBase = Readonly<{
  key: string
  keyRef: string
  binary?: boolean
  ttlMs: number | null
  ttlState?: 'expires' | 'persistent' | 'missing' | 'unavailable'
  sizeBytes?: number
  encoding?: string
  viewTruncated?: boolean
}>

export type RedisStringInspection = RedisInspectionBase & Readonly<{
  type: 'string'
  value: string
  previewBytes: number
  totalBytes: number
  truncated: boolean
}>

export type RedisHashInspection = RedisInspectionBase & Readonly<{
  type: 'hash'
  entries: ReadonlyArray<Readonly<{ field: string; value: string }>>
  cursor: string
  hasMore: boolean
}>

export type RedisListInspection = RedisInspectionBase & Readonly<{
  type: 'list'
  items: ReadonlyArray<Readonly<{ index: number; value: string }>>
  nextOffset: number
  total: number
  hasMore: boolean
}>

export type RedisSetInspection = RedisInspectionBase & Readonly<{
  type: 'set'
  members: readonly string[]
  cursor: string
  hasMore: boolean
}>

export type RedisZSetInspection = RedisInspectionBase & Readonly<{
  type: 'zset'
  members: ReadonlyArray<Readonly<{ value: string; score: number }>>
  cursor: string
  hasMore: boolean
}>

export type RedisStreamInspection = RedisInspectionBase & Readonly<{
  type: 'stream'
  entries: ReadonlyArray<Readonly<{ id: string; fields: ReadonlyArray<Readonly<{ field: string; value: string }>> }>>
  cursor: string
  hasMore: boolean
}>

export type RedisJsonInspection = RedisInspectionBase & Readonly<{
  type: 'json'
  value: unknown
}>

export type RedisInspection =
  | RedisStringInspection
  | RedisHashInspection
  | RedisListInspection
  | RedisSetInspection
  | RedisZSetInspection
  | RedisStreamInspection
  | RedisJsonInspection

export type RedisInspectInput = Readonly<{
  cursor?: string
  offset?: number
  count?: number
}>

export type RedisPayloadMatch = Readonly<{
  key: string
  keyRef: string
  binary?: boolean
  type: RedisKeyType
  excerpt: string
  path?: string
}>

export type RedisPayloadSearchInput = Readonly<{
  operationId: string
  query: string
  keyRef?: string
  keyPattern?: string
  type?: RedisKeyType
  count?: number
  limit?: number
}>

export type RedisPayloadSearchProgress = Readonly<{
  operationId: string
  scanned: number
  estimatedTotal?: number
  matches: readonly RedisPayloadMatch[]
}>

export type RedisPayloadSearchResult = Readonly<{
  operationId: string
  scanned: number
  matches: readonly RedisPayloadMatch[]
  truncated: boolean
  cancelled: boolean
}>

export type RedisApi = Readonly<{
  listConnections: () => Promise<readonly RedisConnection[]>
  createConnection: (input: RedisConnectionInput) => Promise<RedisConnection>
  updateConnection: (id: string, input: RedisConnectionInput) => Promise<RedisConnection>
  deleteConnection: (id: string) => Promise<{ deleted: true }>
  testConnection: (input: RedisConnectionInput, connectionId?: string) => Promise<RedisConnectionTestResult>
  scanKeys: (connectionId: string, input: RedisScanInput) => Promise<RedisScanPage>
  readKey: (connectionId: string, keyRef: string, input?: RedisInspectInput) => Promise<RedisInspection>
  reconnect: (connectionId: string) => Promise<{ reconnected: true }>
  searchPayloads: (connectionId: string, input: RedisPayloadSearchInput) => Promise<RedisPayloadSearchResult>
  cancel: (operationId: string) => Promise<{ cancelled: boolean }>
  onSearchProgress: (listener: (progress: RedisPayloadSearchProgress) => void) => () => void
}>

export type RedisWorkspaceSession = Readonly<{
  selectedConnectionId: string | null
  databaseIndex: number
  view: 'keys' | 'search'
  typeFilter: RedisKeyTypeFilter
  inspectorTab: 'value' | 'metadata'
}>

export type RedisWorkbenchContext = Readonly<{
  connectionId: string | null
  searching: boolean
}>

export function redisApi(): RedisApi {
  return bridgeNamespace('redis')
}

export function redisTypeLabel(type: RedisKeyType | RedisKeyTypeFilter) {
  const labels: Record<RedisKeyType | RedisKeyTypeFilter, string> = {
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
