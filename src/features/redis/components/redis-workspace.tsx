import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { Spinner, Splitter, Tabs, type SplitterPanelData } from '@/components/ui'
import { redisStyles as rs } from '@/theme/styles/redis'
import { useRedisWorkspaceController } from '../hooks/use-redis-workspace-controller'
import type { RedisWorkspaceProps } from '../model/redis-workspace'
import { RedisConnectionDialog } from './redis-connection-dialog'
import { RedisKeyBrowser } from './redis-key-browser'
import { RedisWorkspaceContent } from './redis-workspace-content'
import { RedisWorkspaceToolbar } from './redis-workspace-toolbar'

const panels: SplitterPanelData[] = [
  { id: 'redis-browser', minSize: '260px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'redis-content', minSize: '460px' },
]

export function RedisWorkspace(props: RedisWorkspaceProps) {
  const controller = useRedisWorkspaceController(props)
  const { state } = controller

  return <Splitter.Root asChild defaultFixedSize={330} panels={panels} storageKey={`vincodelab.redis.browser-width:${props.workspace}`}>
    <section aria-busy={state.loadingConnections || state.sessionBusy} aria-label="Workspace Redis" className={rs.workspace}>
      <Splitter.Panel id="redis-browser">
        <RedisKeyBrowser
          cursorDepth={state.pageIndex}
          disabled={!state.operational}
          error={state.scanError}
          filter={state.filter}
          hasMore={state.page.hasMore}
          keys={state.page.keys}
          loading={state.scanLoading}
          selectedKey={state.selectedKeyRef}
          typeFilter={state.typeFilter}
          onFilter={controller.applyFilters}
          onNext={controller.showNextPage}
          onPrevious={controller.showPreviousPage}
          onRefresh={controller.refreshPage}
          onSelect={controller.handleKeySelect}
        />
      </Splitter.Panel>
      <Splitter.ResizeTrigger aria-label="Ridimensiona browser Redis" id="redis-browser:redis-content"><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
      <Splitter.Panel id="redis-content">
        <Tabs.Root asChild value={state.mode} onValueChange={({ value }) => state.setMode(value as 'keys' | 'search')}>
          <main className={rs.main}>
            <RedisWorkspaceToolbar controller={controller} />
            <RedisWorkspaceContent controller={controller} />
          </main>
        </Tabs.Root>
      </Splitter.Panel>
      {state.loadingConnections && <div className={rs.loadingOverlay} role="status">
        <Spinner size={22} />
        <strong>Caricamento connessioni Redis</strong>
        <span className={rs.meta}>Recupero delle configurazioni del workspace…</span>
      </div>}
      <RedisConnectionDialog
        connection={state.editingConnection}
        open={state.dialogOpen}
        onClose={() => state.setDialogOpen(false)}
        onSave={controller.saveConnection}
        onTest={(input) => controller.api.testConnection(input, state.editingConnection?.id)}
      />
      <ConfirmationDialog request={state.confirmation} onCancel={() => state.setConfirmation(null)} />
    </section>
  </Splitter.Root>
}

export type { RedisWorkbenchContext, RedisWorkspaceSession } from '../model/redis-types'
