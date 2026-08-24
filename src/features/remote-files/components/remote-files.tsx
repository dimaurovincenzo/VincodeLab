import { HardDrive, Server } from 'lucide-react'
import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { Splitter, Tabs, type SplitterPanelData } from '@/components/ui'
import { remoteStyles } from '@/theme/styles/remote'
import { useRemoteFilesController } from '../hooks/use-remote-files-controller'
import type { RemoteFilesProps } from '../model/remote-files.types'
import { RemoteConnectionsPanel } from './remote-connections-panel'
import { RemoteLocalCopiesPanel } from './remote-local-copies-panel'
import { RemoteRenameDialog } from './remote-rename-dialog'
import { RemoteServerPanel } from './remote-server-panel'

const remoteFilePanels: SplitterPanelData[] = [
  { id: 'remote-connections', minSize: '210px', maxSize: '460px', collapsible: true, collapsedSize: '0px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'remote-files', minSize: '440px' },
]

export function RemoteFiles(props: RemoteFilesProps) {
  const controller = useRemoteFilesController(props)
  const { actions, derived, elements, state } = controller

  return (
    <Splitter.Root asChild defaultFixedSize={260} panels={remoteFilePanels} storageKey={`vincodelab.remote.connection-width:${props.workspace}`}>
      <section className={remoteStyles.workspace} aria-label="Explorer file remoti">
        <RemoteConnectionsPanel actions={actions} derived={derived} state={state} onCreateSshProfile={props.onCreateSshProfile} />
        <Splitter.ResizeTrigger aria-label="Ridimensiona Explorer remoto" className={remoteStyles.connectionResize} id="remote-connections:remote-files" title="Trascina per ridimensionare. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
        <Splitter.Panel id="remote-files"><Tabs.Root className={remoteStyles.filesMain} value={state.view} onValueChange={({ value }) => state.setView(value as typeof state.view)}>
          <div className={remoteStyles.viewHeader}>
            <Splitter.CollapseTrigger collapseLabel="Nascondi profili SSH" expandLabel="Mostra profili SSH" panelId="remote-connections" />
            <Tabs.List className={remoteStyles.viewTabs} aria-label="Viste file remoti"><Tabs.Trigger value="server"><Server aria-hidden="true" size={14} /> Server</Tabs.Trigger><Tabs.Trigger value="local"><HardDrive aria-hidden="true" size={14} /> Copie locali <small className={remoteStyles.viewCount}>{state.trackedFiles.length}</small></Tabs.Trigger><Tabs.Indicator /></Tabs.List>
          </div>
          <RemoteServerPanel actions={actions} derived={derived} state={state} onCreateSshProfile={props.onCreateSshProfile} />
          <RemoteLocalCopiesPanel actions={actions} derived={derived} state={state} onOpenRemoteFile={props.onOpenRemoteFile} />
        </Tabs.Root></Splitter.Panel>
        <RemoteRenameDialog actions={actions} elements={elements} state={state} />
        <ConfirmationDialog request={state.confirmation} onCancel={() => state.setConfirmation(null)} />
      </section>
    </Splitter.Root>
  )
}
