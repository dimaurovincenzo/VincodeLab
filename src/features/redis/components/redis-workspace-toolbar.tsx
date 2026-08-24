import { Database, FilePenLine, Plug, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, IconButton, SelectField, Spinner } from '@/components/ui'
import { redisStyles as rs } from '@/theme/styles/redis'
import type { RedisWorkspaceController } from '../hooks/use-redis-workspace-controller'

type Props = {
  controller: RedisWorkspaceController
  sidebarToggle?: ReactNode
}

export function RedisWorkspaceToolbar({ controller, sidebarToggle }: Props) {
  const {
    connectionOptions,
    connections,
    operational,
    selected,
    selectedId,
    sessionBusy,
    sessionCanDisconnect,
    sessionPhase,
  } = controller.state

  return <header className={rs.toolbar}>
    <div className={rs.connectionBlock}>
      {sidebarToggle}
      {selected
        ? <>
            <Database aria-hidden="true" size={16} />
            <strong className={rs.connectionName}>{selected.name}</strong>
            <span className={rs.meta}>DB {selected.database} · {selected.mode === 'sentinel' ? `Sentinel ${selected.sentinelMasterName} · ` : ''}{selected.host}:{selected.port}</span>
          </>
        : <strong className={rs.connectionName}>Redis</strong>}
    </div>
    <div className={rs.connectionBlock}>
      {connections.length > 0 && <div className={rs.connectionSelect}>
        <SelectField
          aria-label="Configurazione Redis selezionata"
          disabled={sessionBusy}
          options={connectionOptions}
          value={selectedId ?? ''}
          onValueChange={(value) => controller.selectConnection(value || null)}
        />
      </div>}
      {selected && <>
        {sessionPhase === 'disconnecting'
          ? <Button disabled size="sm" variant="outline"><Spinner size={14} /> Disconnessione…</Button>
          : sessionCanDisconnect
          ? <>
              {operational
                ? <IconButton tooltip="Riconnetti e aggiorna" onClick={() => void controller.reconnect()}><RefreshCw aria-hidden="true" size={14} /></IconButton>
                : sessionPhase === 'disconnect-failed'
                  ? <span className={rs.meta} role="status">Disconnessione non confermata</span>
                  : <span className={rs.meta} role="status"><Spinner size={14} /> {sessionPhase === 'reconnecting' ? 'Riconnessione…' : 'Connessione…'}</span>}
              <Button size="sm" variant="outline" onClick={() => void controller.disconnect()}><Unplug aria-hidden="true" size={14} /> Disconnetti</Button>
            </>
          : <Button disabled={sessionBusy} size="sm" onClick={() => void controller.connectSelected()}>
              {sessionBusy ? <Spinner size={14} /> : <Plug aria-hidden="true" size={14} />}
              {sessionBusy ? 'Connessione…' : 'Connetti'}
            </Button>}
        <IconButton disabled={sessionBusy} tooltip={`Modifica ${selected.name}`} onClick={() => controller.editConnection(selected)}><FilePenLine aria-hidden="true" size={14} /></IconButton>
        <IconButton disabled={sessionBusy} tone="danger" tooltip={`Elimina ${selected.name}`} onClick={() => controller.deleteConnection(selected)}><Trash2 aria-hidden="true" size={14} /></IconButton>
      </>}
      <Button disabled={sessionBusy} size="sm" variant="outline" onClick={controller.openNewConnection}><Plus aria-hidden="true" size={14} /> Connessione</Button>
    </div>
  </header>
}
