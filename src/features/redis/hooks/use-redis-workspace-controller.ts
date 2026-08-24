import { useEffect } from 'react'
import { redisApi } from '../api/redis.bridge'
import type { RedisWorkspaceProps } from '../model/redis-workspace'
import { useRedisBrowserController } from './use-redis-browser-controller'
import { useRedisContextMenu } from './use-redis-context-menu'
import { useRedisMenuCommand } from './use-redis-menu-command'
import { useRedisSessionController } from './use-redis-session-controller'
import { useRedisWorkspaceState } from './use-redis-workspace-state'

export function useRedisWorkspaceController({
  focusRequest = 0,
  initialState,
  onContextChange,
  onSessionChange,
  workspace,
}: RedisWorkspaceProps) {
  const api = redisApi()
  const state = useRedisWorkspaceState(initialState)
  const browser = useRedisBrowserController({ api, state })
  const session = useRedisSessionController({ api, browser, initialState, state, workspace })
  const { setMode, setSearchFocusRequest } = state

  useEffect(() => {
    onContextChange?.({
      connectionId: state.operational ? state.activeConnectionId : null,
      searching: state.searching,
    })
  }, [onContextChange, state.activeConnectionId, state.operational, state.searching])

  useEffect(() => {
    onSessionChange?.({
      selectedConnectionId: state.selectedId,
      databaseIndex: state.selected?.database ?? initialState?.databaseIndex ?? 0,
      view: state.mode,
      typeFilter: state.typeFilter,
      inspectorTab: state.inspectorTab,
    })
  }, [initialState?.databaseIndex, onSessionChange, state.inspectorTab, state.mode, state.selected?.database, state.selectedId, state.typeFilter])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- la richiesta esterna di focus è un comando edge-triggered proveniente dalla shell
  useEffect(() => {
    if (focusRequest > 0) {
      setMode('search')
      setSearchFocusRequest((current) => current + 1)
    }
  }, [focusRequest, setMode, setSearchFocusRequest])

  useRedisMenuCommand('redis.focusSearch', () => {
    setMode('search')
    setSearchFocusRequest((current) => current + 1)
  })
  useRedisMenuCommand('redis.refresh', () => {
    if (state.operational) void browser.scan(state.currentSnapshot?.inputCursor, Boolean(state.currentSnapshot))
  })
  useRedisMenuCommand('redis.cancel', () => window.dispatchEvent(new CustomEvent('vincodelab:redis-cancel-search')))
  useRedisMenuCommand('redis.reconnect', () => {
    if (state.operational) void session.reconnect()
  })
  useRedisMenuCommand('redis.newConnection', session.openNewConnection)

  useRedisContextMenu({
    getVisibleMatches: state.getVisibleMatches,
    inspection: state.inspection,
    inspectorTab: state.inspectorTab,
    mode: state.mode,
    pageKeys: state.page.keys,
    selectKey: browser.selectKey,
    setMode,
    setSearchFocusRequest,
    setSearchKeyRequest: state.setSearchKeyRequest,
  })

  const sessionErrorAction = state.sessionRecovery === 'disconnect' && state.operational
    ? { label: 'Riprova disconnessione', onClick: session.disconnect }
    : state.sessionRecovery === 'reconnect' && state.operational
      ? { label: 'Riprova riconnessione', onClick: session.reconnect }
      : { label: 'Riprova connessione', onClick: session.connectSelected }

  return {
    api,
    ...browser,
    ...session,
    sessionErrorAction,
    state,
  }
}

export type RedisWorkspaceController = ReturnType<typeof useRedisWorkspaceController>
