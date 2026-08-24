import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { RedisInspection, RedisKeySummary, RedisPayloadMatch } from '@/bridge'
import { toast } from '@/components/ui'
import { redisBridge } from '../api/redis.bridge'
import { visibleRedisInspectionValue } from '../model/redis-workspace'
import { reportRedisFailure } from '../services/redis-error'

type RedisContextMenuOptions = {
  inspection: RedisInspection | null
  inspectorTab: 'value' | 'metadata'
  mode: 'keys' | 'search'
  pageKeys: readonly RedisKeySummary[]
  selectKey: (key: string, keyRef: string) => void
  setMode: Dispatch<SetStateAction<'keys' | 'search'>>
  setSearchFocusRequest: Dispatch<SetStateAction<number>>
  setSearchKeyRequest: Dispatch<SetStateAction<{ keyPattern: string; keyRef: string; nonce: number } | undefined>>
  getVisibleMatches: () => readonly RedisPayloadMatch[]
}

export function useRedisContextMenu({
  inspection,
  inspectorTab,
  mode,
  pageKeys,
  selectKey,
  setMode,
  setSearchFocusRequest,
  setSearchKeyRequest,
  getVisibleMatches,
}: RedisContextMenuOptions) {
  const actionHandlerRef = useRef<(action: ContextMenuAction) => void>(() => undefined)

  const contextKey = useCallback((keyRef: string) => {
    const summary = pageKeys.find((item) => item.keyRef === keyRef)
    if (summary) return { key: summary.key, keyRef: summary.keyRef, binary: summary.binary }
    if (inspection?.keyRef === keyRef) return { key: inspection.key, keyRef: inspection.keyRef, binary: inspection.binary }
    const match = getVisibleMatches().find((item) => item.keyRef === keyRef)
    return match ? { key: match.key, keyRef: match.keyRef, binary: match.binary } : null
  }, [getVisibleMatches, inspection, pageKeys])

  const copyContextText = useCallback((text: string, successTitle: string) => {
    const write = () => navigator.clipboard.writeText(text).then(() => {
      toast.success(successTitle)
    }).catch((cause) => {
      const incident = reportRedisFailure(cause, 'copy-redis-context', 'Contenuto Redis non copiato', 'Gli appunti non sono accessibili. I dati visibili non sono stati modificati.')
      toast.error(incident.title, {
        description: `${incident.description} Riferimento ${incident.correlationId}.`,
        dedupeKey: incident.operation,
        recoveryAction: { label: 'Riprova', onClick: () => { void write() } },
      })
    })
    void write()
  }, [])

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.contextKind !== 'redis-key' || !action.contextId) return
    const target = contextKey(action.contextId)
    if (!target) return
    if (action.command === 'redisKey.open' || action.command === 'redisKey.refresh') {
      selectKey(target.key, target.keyRef)
      return
    }
    if (action.command === 'redisKey.searchPayload') {
      setMode('search')
      setSearchKeyRequest({ keyPattern: target.key, keyRef: target.keyRef, nonce: Date.now() })
      setSearchFocusRequest((current) => current + 1)
      return
    }
    if (action.command === 'redisKey.copyName') {
      copyContextText(target.key, 'Nome chiave Redis copiato.')
      return
    }
    if (action.command !== 'redisKey.copyVisibleValue') return
    const visibleValue = mode === 'keys'
      ? inspectorTab === 'value' && inspection?.keyRef === target.keyRef ? visibleRedisInspectionValue(inspection) : undefined
      : getVisibleMatches().find((match) => match.keyRef === target.keyRef)?.excerpt
    if (visibleValue === undefined) {
      toast.warning('Valore Redis non visibile', { description: 'Apri la chiave nell’inspector prima di copiarne il valore.' })
      return
    }
    copyContextText(visibleValue, 'Valore Redis visibile copiato.')
  }, [contextKey, copyContextText, getVisibleMatches, inspection, inspectorTab, mode, selectKey, setMode, setSearchFocusRequest, setSearchKeyRequest])

  useEffect(() => {
    actionHandlerRef.current = handleContextAction
  }, [handleContextAction])

  useEffect(() => redisBridge.contextMenu.onAction((action) => actionHandlerRef.current(action)), [])
}
