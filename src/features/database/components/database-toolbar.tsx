import { AlignLeft, PlugZap, Play, RefreshCw, RotateCcw, Save, Unplug, X } from 'lucide-react'
import type { DatabaseConnection } from '@/bridge'
import { Button, Spinner } from '@/components/ui'
import type { DatabaseToolbarAction } from '../model/database.types'
import { databaseStyles as db } from '@/theme/styles/database'

type DatabaseToolbarProps = {
  cancelling: boolean
  connectionPrepared: boolean
  connectionReady: boolean
  disconnectAvailable: boolean
  disconnecting: boolean
  executing: boolean
  loadingResources: boolean
  onBegin: () => void
  onCancel: () => void
  onConnect: () => void
  onDisconnect: () => void
  onFinishTransaction: (action: 'commit' | 'rollback') => void
  onFormat: () => void
  onRefreshSchema: () => void
  onRun: () => void
  onSaveQuery: () => void
  selected: DatabaseConnection | null
  toolbarAction: DatabaseToolbarAction
  transactionActive: boolean
}

export function DatabaseToolbar({
  cancelling,
  connectionPrepared,
  connectionReady,
  disconnectAvailable,
  disconnecting,
  executing,
  loadingResources,
  onBegin,
  onCancel,
  onConnect,
  onDisconnect,
  onFinishTransaction,
  onFormat,
  onRefreshSchema,
  onRun,
  onSaveQuery,
  selected,
  toolbarAction,
  transactionActive,
}: DatabaseToolbarProps) {
  const status = disconnecting
    ? 'Disconnessione…'
    : executing
    ? 'Esecuzione query…'
    : connectionReady && loadingResources
      ? 'Caricamento schema…'
    : toolbarAction === 'format'
      ? 'Formattazione SQL…'
      : toolbarAction === 'schema'
        ? 'Aggiornamento schema…'
        : toolbarAction === 'begin'
          ? 'Avvio transazione…'
          : toolbarAction === 'commit'
            ? 'Conferma transazione…'
            : toolbarAction === 'rollback'
              ? 'Annullamento transazione…'
              : transactionActive
                ? 'Transazione attiva'
                : selected && !connectionReady
                  ? disconnectAvailable ? 'Disconnessione da completare' : 'Non connesso'
                  : connectionReady
                    ? 'Connesso'
                    : ''

  return <header className={db.toolbar}>
    <strong className={db.toolbarTitle}>{selected?.name ?? 'Seleziona una connessione'}</strong>
    <div className={db.toolbarActions}>
      <span aria-live="polite" className={db.toolbarStatus}>{status}</span>
      {selected && !disconnectAvailable && <Button size="sm" disabled={!connectionPrepared || loadingResources || toolbarAction !== null} onClick={onConnect}>
        {loadingResources ? <Spinner size={14} /> : <PlugZap size={14} />} {loadingResources ? 'Connessione…' : 'Connetti'}
      </Button>}
      {selected && disconnectAvailable && <Button size="sm" variant="outline" disabled={disconnecting || executing || transactionActive || toolbarAction !== null} onClick={onDisconnect}>
        {disconnecting ? <Spinner size={14} /> : <Unplug size={14} />} {disconnecting ? 'Disconnessione…' : 'Disconnetti'}
      </Button>}
      <Button size="sm" variant="outline" disabled={!selected || !connectionReady || loadingResources || toolbarAction !== null} onClick={onRefreshSchema}>
        {toolbarAction === 'schema' ? <Spinner size={14} /> : <RefreshCw size={14} />} {toolbarAction === 'schema' ? 'Aggiornamento…' : 'Schema'}
      </Button>
      <Button size="sm" variant="outline" disabled={!selected || !connectionReady || transactionActive || loadingResources || toolbarAction !== null} onClick={onBegin}>
        {toolbarAction === 'begin' && <Spinner size={14} />}{toolbarAction === 'begin' ? 'Avvio…' : 'Inizia'}
      </Button>
      <Button size="sm" variant="outline" disabled={!selected || !transactionActive || toolbarAction !== null} onClick={() => onFinishTransaction('commit')}>
        {toolbarAction === 'commit' ? 'Commit…' : 'Commit'}
      </Button>
      <Button size="sm" variant="outline" disabled={!selected || !transactionActive || toolbarAction !== null} onClick={() => onFinishTransaction('rollback')}>
        <RotateCcw size={14} /> {toolbarAction === 'rollback' ? 'Rollback…' : 'Rollback'}
      </Button>
      <Button size="sm" variant="outline" disabled={!selected || toolbarAction !== null} onClick={onSaveQuery}><Save size={14} /> Salva</Button>
      <Button size="sm" variant="outline" disabled={!selected || toolbarAction !== null} onClick={onFormat} title="Formatta SQL (⌥⇧F)">
        {toolbarAction === 'format' ? <Spinner size={14} /> : <AlignLeft size={14} />} {toolbarAction === 'format' ? 'Formattazione…' : 'Formatta'}
      </Button>
      {executing && <Button size="sm" variant="outline" disabled={cancelling} onClick={onCancel}><X size={14} /> {cancelling ? 'Annullamento…' : 'Annulla'}</Button>}
      <Button size="sm" disabled={!selected || !connectionReady || executing || toolbarAction !== null} onClick={onRun}>
        {executing ? <Spinner size={14} /> : <Play size={14} />} {executing ? 'Esecuzione…' : 'Esegui'}
      </Button>
    </div>
  </header>
}
