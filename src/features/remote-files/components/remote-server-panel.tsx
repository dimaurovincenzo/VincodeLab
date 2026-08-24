import { Icon } from '@iconify/react'
import defaultFileIcon from '@iconify-icons/vscode-icons/default-file'
import defaultFolderIcon from '@iconify-icons/vscode-icons/default-folder'
import { ArrowLeft, Download, Folder, FolderPlus, PlugZap, Plus, RefreshCw, Upload } from 'lucide-react'
import { Button, ErrorNotice, Field, IconButton, Spinner, Tabs } from '@/components/ui'
import { remoteStyles } from '@/theme/styles/remote'
import type { RemoteFilesController } from '../hooks/use-remote-files-controller'
import { formatRemoteFileSize as formatSize } from '../model/remote-files-format'

type Props = Pick<RemoteFilesController, 'actions' | 'derived' | 'state'> & {
  onCreateSshProfile: () => void
}

export function RemoteServerPanel({ actions, derived, onCreateSshProfile, state }: Props) {
  const reconnectProfile = state.profiles.find((candidate) => candidate.id === derived.selectedConnection?.commandId)

  return (
    <Tabs.Content value="server" className={remoteStyles.tabContent}>
      <header className={remoteStyles.toolbar}>
        <div className={remoteStyles.toolbarLocation}><IconButton tooltip="Cartella precedente" disabled={state.locations.length <= 1} onClick={actions.goBack}><ArrowLeft aria-hidden="true" size={14} /></IconButton><code className={remoteStyles.locationPath} title={derived.currentLocation.path}>{derived.currentLocation.path || derived.selectedConnection?.remoteRoot || 'File remoti'}</code></div>
        <div className={remoteStyles.toolbarActions}><Field.Root className={remoteStyles.search}><Field.Input aria-label="Cerca nella cartella remota" placeholder="Cerca file…" type="search" value={state.search} onChange={(event) => state.setSearch(event.target.value)} /></Field.Root><Button size="sm" variant="outline" disabled={!state.connectionId || derived.selectedConnection?.state !== 'connected'} onClick={() => void actions.uploadFiles()}><Upload aria-hidden="true" size={14} /> Carica</Button><IconButton tooltip="Aggiorna file remoti" disabled={!state.connectionId} onClick={actions.refreshEntries}><RefreshCw aria-hidden="true" size={14} /></IconButton></div>
      </header>
      <Field.Root className={remoteStyles.createFolder}><Field.Input aria-label="Nome nuova cartella remota" placeholder="Nuova cartella" value={state.createName} onChange={(event) => state.setCreateName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void actions.createDirectory() }} /><Button size="sm" variant="outline" disabled={!state.createName.trim() || derived.selectedConnection?.state !== 'connected'} onClick={() => void actions.createDirectory()}><FolderPlus aria-hidden="true" size={14} /> Crea</Button></Field.Root>
      <div className={remoteStyles.fileList} aria-busy={state.loadingEntries}>
        {state.loadingEntries ? <div className={remoteStyles.empty}><Spinner size={18} /><strong>Caricamento file remoti…</strong><span>Lettura della cartella sul server.</span></div> : state.browseError ? <ErrorNotice action={{ label: 'Riprova', onClick: actions.refreshEntries }} error={state.browseError} /> : !state.connectionId ? <div className={remoteStyles.empty}><PlugZap aria-hidden="true" size={20} /><strong>Nessuna connessione SSH attiva</strong><span>Scegli Connetti accanto a un profilo SSH oppure creane uno dalla barra laterale.</span><Button size="sm" variant="outline" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /> Nuovo profilo SSH</Button></div> : derived.selectedConnection?.state === 'connecting' ? <div className={remoteStyles.empty} role="status"><Spinner size={18} /><strong>Connessione SSH in corso…</strong><span>Completa l’autenticazione nel Terminale.</span></div> : derived.selectedConnection?.state !== 'connected' ? <div className={remoteStyles.empty} role="status"><PlugZap aria-hidden="true" size={20} /><strong>Connessione SSH non attiva</strong><span>Riconnetti il profilo per continuare. Le copie locali restano disponibili.</span><Button size="sm" variant="outline" onClick={() => { if (reconnectProfile) void actions.connectSavedProfile(reconnectProfile) }}><PlugZap aria-hidden="true" /> Riconnetti</Button></div> : derived.filteredEntries.length === 0 ? <div className={remoteStyles.empty}><Folder aria-hidden="true" size={20} /><strong>Nessun file nella cartella</strong><span>{state.search ? 'Nessun risultato per la ricerca corrente.' : 'La cartella remota è vuota.'}</span></div> : derived.filteredEntries.map((entry) => <Button variant="plain" key={entry.id} className={remoteStyles.fileRow} data-remote-context-id={entry.id} data-remote-context-kind={entry.kind === 'directory' ? 'remote-directory' : 'remote-file'} onClick={() => void actions.openEntry(entry)}><span className={remoteStyles.fileIcon}><Icon aria-hidden="true" icon={entry.kind === 'directory' ? defaultFolderIcon : defaultFileIcon} width={16} /></span><span className={remoteStyles.fileName}>{entry.name}</span><span className={remoteStyles.fileMeta}>{entry.kind === 'file' ? formatSize(entry.size) : 'Cartella'}</span><span className={remoteStyles.fileAction} aria-hidden="true">{entry.kind === 'directory' ? 'Apri' : <Download size={13} />}</span></Button>)}
      </div>
      <RemoteTransfers actions={actions} state={state} />
    </Tabs.Content>
  )
}

function RemoteTransfers({ actions, state }: Pick<Props, 'actions' | 'state'>) {
  const transfers = Object.values(state.transfers)
  return (
    <section className={remoteStyles.transfers} aria-label="Trasferimenti">
      <header className={remoteStyles.transfersHeader}><strong>Trasferimenti</strong><small>{transfers.filter((transfer) => transfer.state === 'running').length} attivi</small></header>
      {state.transferError && <ErrorNotice action={state.transferError.transferId && actions.canRetryTransfer(state.transferError.transferId) ? { label: 'Riprova trasferimento', onClick: () => actions.retryTransfer(state.transferError!.transferId!) } : undefined} error={state.transferError.error} />}
      {transfers.length === 0 ? <p className={remoteStyles.transfersEmpty}>Nessun trasferimento nella sessione.</p> : <div>{transfers.map((transfer) => <article className={remoteStyles.transferRow} data-context-cancellable={transfer.state === 'running' ? 'true' : undefined} data-context-retryable={transfer.state === 'error' && actions.canRetryTransfer(transfer.id) ? 'true' : undefined} data-remote-context-id={transfer.id} data-remote-context-kind="remote-transfer" key={transfer.id}><span>{transfer.direction === 'upload' ? <Upload aria-hidden="true" size={13} /> : <Download aria-hidden="true" size={13} />}</span><strong className={remoteStyles.transferName}>{transfer.name}</strong><small className={remoteStyles.transferState}>{transfer.state === 'running' ? 'In corso…' : transfer.state === 'completed' ? 'Completato' : transfer.state === 'cancelled' ? 'Annullato' : transfer.state === 'error' ? 'Interrotto' : 'In coda'}</small>{transfer.state === 'running' && <Button size="xs" variant="plain" onClick={() => actions.cancelTransfer(transfer)} aria-label={`Annulla trasferimento ${transfer.name}`}>Annulla</Button>}{transfer.state === 'error' && actions.canRetryTransfer(transfer.id) && <Button size="xs" variant="outline" onClick={() => void actions.retryTransfer(transfer.id)} aria-label={`Riprova trasferimento ${transfer.name}`}>Riprova</Button>}</article>)}</div>}
    </section>
  )
}
