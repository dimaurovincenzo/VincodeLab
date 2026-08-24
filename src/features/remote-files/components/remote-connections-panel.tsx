import { PlugZap, Plus, RefreshCw, Server } from 'lucide-react'
import { Button, ErrorNotice, IconButton, Listbox, Spinner, Splitter } from '@/components/ui'
import { remoteStyles } from '@/theme/styles/remote'
import { terminalStyles } from '@/theme/styles/terminal'
import type { RemoteFilesController } from '../hooks/use-remote-files-controller'

type Props = Pick<RemoteFilesController, 'actions' | 'derived' | 'state'> & {
  onCreateSshProfile: () => void
}

export function RemoteConnectionsPanel({ actions, derived, onCreateSshProfile, state }: Props) {
  return (
    <Splitter.Panel asChild id="remote-connections"><aside className={remoteStyles.connections}>
      <header className={remoteStyles.connectionsHeader}><span className={remoteStyles.connectionsHeaderTitle} id="remote-connections-list-label"><Server aria-hidden="true" size={15} /> Profili SSH</span><div className={remoteStyles.connectionsHeaderActions}><IconButton tooltip="Nuovo profilo SSH" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /></IconButton><IconButton tooltip="Aggiorna profili e connessioni SSH" onClick={() => void actions.loadConnections()}><RefreshCw aria-hidden="true" size={14} /></IconButton></div></header>
      {state.connectionError && <ErrorNotice action={{ label: 'Riprova', onClick: actions.loadConnections }} error={state.connectionError} />}
      {state.loadingConnections && state.profiles.length === 0 ? <div className={remoteStyles.inlineState}><Spinner size={15} /> Caricamento profili SSH…</div> : state.profiles.length === 0 ? <div className={remoteStyles.profileEmpty}><strong>Nessun profilo SSH</strong><span>I comandi SSH digitati liberamente nel Terminale non possono essere esplorati. Crea un profilo con destinazione e cartella iniziale.</span><Button size="sm" variant="outline" onClick={onCreateSshProfile}><Plus aria-hidden="true" size={14} /> Nuovo profilo SSH</Button></div> : <Listbox.Root collection={derived.profileCollection} deselectable={false} ids={{ label: 'remote-connections-list-label' }} loopFocus selectionMode="single" value={derived.selectedConnection?.commandId ? [derived.selectedConnection.commandId] : []} onValueChange={({ items }) => { const profile = items[0]; if (profile) void actions.connectSavedProfile(profile) }}><Listbox.Content className={remoteStyles.connectionList} aria-busy={state.connectingProfileId !== null}>{state.profiles.map((profile) => {
        const connection = state.connections.find((candidate) => candidate.commandId === profile.id && candidate.state !== 'disconnected') ?? null
        const connectionState = connection?.state ?? 'disconnected'
        return <Listbox.Item className={remoteStyles.profileSummary} highlightOnHover item={profile} key={profile.id}><span className={`${terminalStyles.statusDot} ${connectionState === 'connecting' ? terminalStyles.statusLaunching : connectionState === 'error' ? terminalStyles.statusError : connectionState !== 'connected' ? terminalStyles.statusInactive : ''}`} /><Listbox.ItemText asChild><span className={remoteStyles.profileCopy}><strong>{profile.title}</strong><small>{profile.sshDestination}</small></span></Listbox.ItemText><span className={remoteStyles.profileAction}>{state.connectingProfileId === profile.id || connectionState === 'connecting' ? <Spinner size={13} /> : <PlugZap aria-hidden="true" size={13} />}{connectionState === 'connected' ? 'Apri' : 'Connetti'}</span></Listbox.Item>
      })}</Listbox.Content></Listbox.Root>}
    </aside></Splitter.Panel>
  )
}
