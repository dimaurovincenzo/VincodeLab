import { AlignLeft, PlugZap, Play, RefreshCw, RotateCcw, Save, X } from 'lucide-react'
import { Button, Spinner } from '@/components/ui'
import type { DatabaseToolbarAction } from '../model/database.types'
import { databaseStyles as db } from '@/theme/styles/database'

type DatabaseToolbarProps = {
  cancelling: boolean
  connectionPrepared: boolean
  connectionReady: boolean
  executing: boolean
  loadingResources: boolean
  onBegin: () => void
  onCancel: () => void
  onConnect: () => void
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
  executing,
  loadingResources,
  onBegin,
  onCancel,
  onConnect,
  onFinishTransaction,
  onFormat,
  onRefreshSchema,
  onRun,
  onSaveQuery,
  selected,
  toolbarAction,
  transactionActive,
}: DatabaseToolbarProps) {
  const status = executing
    ? 'Esecuzione query…'
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
                  ? 'Non connesso'
                  : connectionReady
                    ? 'Connesso'
                    : ''

  return <header className={db.toolbar}>
    <strong className={db.toolbarTitle}>{selected?.name ?? 'Seleziona una connessione'}</strong>
    <div className={db.toolbarActions}>
      <span aria-live="polite" className={db.toolbarStatus}>{status}</span>
      {selected && !connectionReady && <Button size="sm" disabled={!connectionPrepared || loadingResources || toolbarAction !== null} onClick={onConnect}>
        {loadingResources ? <Spinner size={14} /> : <PlugZap size={14} />} {loadingResources ? 'Connessione…' : 'Connetti'}
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
