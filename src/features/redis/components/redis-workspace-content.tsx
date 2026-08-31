import { Search } from 'lucide-react'
import { ErrorNotice, Spinner, Tabs } from '@/components/ui'
import { redisStyles as rs } from '@/theme/styles/redis'
import type { RedisWorkspaceController } from '../hooks/use-redis-workspace-controller'
import { RedisConnectionGate } from './redis-connection-gate'
import { RedisInspectorEmpty, RedisKeyInspector } from './redis-key-inspector'
import { RedisPayloadSearch } from './redis-payload-search'

type Props = {
  controller: RedisWorkspaceController
}

export function RedisWorkspaceContent({ controller }: Props) {
  const {
    activeConnectionId,
    connectionError,
    inspection,
    inspectionError,
    inspectionLoading,
    inspectorTab,
    loadingConnections,
    operational,
    searchFocusRequest,
    searchKeyRequest,
    selected,
    selectedId,
    selectedKey,
    sessionBusy,
    sessionError,
    sessionPhase,
  } = controller.state

  return <section className={rs.content}>
    {connectionError && <ErrorNotice action={{ label: 'Riprova caricamento', onClick: controller.loadConnections }} className={rs.notice} error={connectionError} />}
    {activeConnectionId && sessionError && <ErrorNotice action={controller.sessionErrorAction} className={rs.notice} error={sessionError} />}
    {activeConnectionId && <Tabs.List aria-label="Viste Redis" className={rs.viewTabs}>
      <Tabs.Trigger value="keys">Inspector</Tabs.Trigger>
      <Tabs.Trigger value="search"><Search aria-hidden="true" size={13} /> Cerca nei payload</Tabs.Trigger>
      <Tabs.Indicator />
    </Tabs.List>}
    {activeConnectionId && sessionBusy && <div className={rs.centerState} role="status"><Spinner size={16} /><span>{sessionPhase === 'connecting' ? 'Connessione a Redis…' : sessionPhase === 'reconnecting' ? 'Riconnessione a Redis…' : 'Disconnessione da Redis…'}</span></div>}
    <div className={rs.viewPanel}>
      {selectedId && <div hidden={!activeConnectionId}>
            <Tabs.Content className={rs.viewPanel} value="keys">
              <RedisKeyInspector
                disabled={!operational}
                error={inspectionError}
                inspection={inspection}
                loading={inspectionLoading}
                selectedKey={selectedKey}
                tab={inspectorTab}
                onLoadMore={controller.loadMoreInspection}
                onRefresh={controller.refreshInspection}
                onTabChange={controller.state.setInspectorTab}
              />
            </Tabs.Content>
            <Tabs.Content className={rs.viewPanel} value="search">
              <RedisPayloadSearch
                connectionId={selectedId}
                disabled={!operational}
                focusRequest={searchFocusRequest}
                keyRequest={searchKeyRequest}
                onOpenKey={controller.handlePayloadMatchOpen}
                onSearchingChange={controller.state.setSearching}
                onVisibleMatchesChange={controller.handleVisibleMatchesChange}
              />
            </Tabs.Content>
          </div>}
      {!activeConnectionId && (selected
        ? <RedisConnectionGate connecting={sessionPhase === 'connecting'} connection={selected} error={sessionError} onConnect={() => void controller.connectSelected()} />
        : !loadingConnections && !connectionError ? <RedisInspectorEmpty onCreateConnection={controller.openNewConnection} /> : null)}
    </div>
  </section>
}
