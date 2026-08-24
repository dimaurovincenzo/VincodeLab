import { Icon } from '@iconify/react'
import defaultFileIcon from '@iconify-icons/vscode-icons/default-file'
import { FolderOpen, HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import { Button, ErrorNotice, IconButton, SelectField, Spinner, Tabs } from '@/components/ui'
import { remoteStyles } from '@/theme/styles/remote'
import type { RemoteFilesController } from '../hooks/use-remote-files-controller'
import { formatRemoteFileSize as formatSize, remoteLocalStateLabel as localStateLabel } from '../model/remote-files-format'

type Props = Pick<RemoteFilesController, 'actions' | 'derived' | 'state'> & {
  onOpenRemoteFile: (fileId: string) => void
}

export function RemoteLocalCopiesPanel({ actions, derived, onOpenRemoteFile, state }: Props) {
  return (
    <Tabs.Content value="local" className={remoteStyles.localCopies} aria-label="Copie locali dei file remoti">
      <header className={remoteStyles.localHeader}><div className={remoteStyles.localHeaderCopy}><strong>Copie locali</strong><span>{state.trackedFiles.length} file · {formatSize(derived.trackedSize)}</span></div><div className={remoteStyles.localHeaderActions}><SelectField aria-label="Filtra copie locali per stato" options={[{ value: 'all', label: 'Tutti gli stati' }, { value: 'synced', label: 'Sincronizzati' }, { value: 'modified', label: 'Modificati' }, { value: 'conflict', label: 'Conflitti' }, { value: 'offline', label: 'Offline' }]} value={state.localFilter} onValueChange={(value) => state.setLocalFilter(value as typeof state.localFilter)} /><Button size="sm" variant="outline" disabled={state.loadingTracked} onClick={() => void actions.loadTracked()}><RefreshCw aria-hidden="true" /> Aggiorna</Button><Button size="sm" variant="outline" disabled={!state.trackedFiles.some((file) => file.localState === 'synced')} onClick={actions.requestCleanup}><Trash2 aria-hidden="true" /> Pulisci sincronizzati</Button></div></header>
      <div className={remoteStyles.localList} aria-busy={state.loadingTracked}>{state.loadingTracked ? <div className={remoteStyles.empty}><Spinner /><strong>Caricamento copie locali…</strong></div> : state.trackedError ? <ErrorNotice action={{ label: 'Riprova', onClick: actions.loadTracked }} error={state.trackedError} /> : derived.filteredTracked.length === 0 ? <div className={remoteStyles.empty}><HardDrive aria-hidden="true" size={20} /><strong>Nessuna copia locale</strong><span>{state.localFilter === 'all' ? 'Scarica un file dal server per modificarlo nell’Editor.' : 'Nessun file corrisponde al filtro selezionato.'}</span></div> : derived.filteredTracked.map((file) => <article key={file.id} className={remoteStyles.localRow} data-remote-context-id={file.id} data-remote-context-kind="remote-local-file"><Icon aria-hidden="true" icon={defaultFileIcon} width={16} /><div className={remoteStyles.localCopy}><strong>{file.name}</strong><small title={file.remotePath}>{file.remotePath}</small></div><span className={`${remoteStyles.localState} ${file.localState === 'synced' ? remoteStyles.localStateSynced : file.localState === 'modified' ? remoteStyles.localStateModified : file.localState === 'conflict' ? remoteStyles.localStateConflict : remoteStyles.localStateOffline}`}>{localStateLabel(file.localState)}</span><span className={remoteStyles.localSize}>{formatSize(file.cacheSize)}</span><div className={remoteStyles.localActions}><Button size="sm" variant="outline" onClick={() => onOpenRemoteFile(file.id)}>Apri</Button><IconButton tooltip={`Mostra ${file.name} nel Finder`} onClick={() => actions.revealLocal(file)}><FolderOpen aria-hidden="true" size={14} /></IconButton><IconButton tooltip={`Scarta copia locale ${file.name}`} onClick={() => actions.requestDiscard(file)}><Trash2 aria-hidden="true" size={14} /></IconButton></div></article>)}</div>
    </Tabs.Content>
  )
}
