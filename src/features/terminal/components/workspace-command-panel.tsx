import { ChevronRight, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { Button, Collapsible, Dialog, ErrorNotice, Field, IconButton, SegmentGroup, SelectField, Spinner, Splitter, type SplitterPanelData } from '@/components/ui'
import type { RefObject } from 'react'
import type { TerminalSessionUiStatus } from '../model/terminal-session'
import type { WorkspaceCommandLibraryController } from '../hooks/use-workspace-command-library'
import { terminalStyles } from '@/theme/styles/terminal'

const workspaceCommandPanels: SplitterPanelData[] = [
  { id: 'terminal-space', minSize: '420px' },
  { id: 'workspace-commands', minSize: '300px', maxSize: '720px', resizeBehavior: 'preserve-pixel-size' },
]

type WorkspaceCommandPanelProps = {
  commandSearchInput: RefObject<HTMLInputElement | null>
  commandsWidth: number
  controller: WorkspaceCommandLibraryController
  status: TerminalSessionUiStatus
  workspace: string
}

export function WorkspaceCommandPanel({ commandSearchInput, commandsWidth, controller, status, workspace }: WorkspaceCommandPanelProps) {
  const { actions, setters, state } = controller

  return <Splitter.Root
    aria-label="Comandi del workspace"
    className={terminalStyles.commandSplitter}
    defaultFixedSize={commandsWidth}
    fixedPanel="end"
    hidden={!state.commandsOpen}
    panels={workspaceCommandPanels}
    storageKey={`vincodelab.terminal.commands-width:${workspace}`}
  >
    <Splitter.Panel aria-hidden="true" className={terminalStyles.commandSpace} id="terminal-space" />
    <Splitter.ResizeTrigger aria-label="Ridimensiona comandi workspace" className={terminalStyles.commandResize} id="terminal-space:workspace-commands" title="Trascina per ridimensionare i comandi. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
    <Splitter.Panel id="workspace-commands"><Dialog.Content asChild unstyled><aside className={terminalStyles.commandSidebar} aria-label="Comandi del workspace">
      <header className={terminalStyles.commandHeader}><strong>Comandi workspace</strong><div className={terminalStyles.commandHeaderActions}><Button size="sm" onClick={() => actions.openNewCommand('shell')}><Plus size={14} /> Nuovo comando</Button><IconButton tooltip="Chiudi comandi workspace" onClick={actions.closeCommands}><X size={15} /></IconButton></div></header>
      <Field.Root><Field.Input ref={commandSearchInput} aria-label="Cerca comandi" placeholder="Cerca comandi" value={state.commandSearch} onChange={(event) => setters.setCommandSearch(event.target.value)} /></Field.Root>
      <Collapsible.Root className={terminalStyles.commandCreate}><Collapsible.Trigger><Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator>Nuova categoria</Collapsible.Trigger><Collapsible.Content><Field.Root className={terminalStyles.categoryCreateField}><Field.Input aria-label="Nome categoria" placeholder="Nome categoria" value={state.categoryName} onChange={(event) => setters.setCategoryName(event.target.value)} /><Button size="sm" variant="outline" disabled={state.commandsBusy || !state.categoryName.trim()} onClick={() => void actions.createCategory()}><Plus size={14} /> Crea</Button></Field.Root></Collapsible.Content></Collapsible.Root>
      {state.commandFormOpen && <div className={terminalStyles.commandForm}>
        <div className={terminalStyles.commandFormTop}><SelectField aria-label="Categoria comando" options={state.categories.map((category) => ({ value: category.id, label: category.name }))} value={state.commandCategoryId} placeholder="Scegli categoria" onValueChange={setters.setCommandCategoryId} /><Field.Root><Field.Input aria-label="Titolo comando" placeholder="Titolo comando" value={state.commandTitle} onChange={(event) => setters.setCommandTitle(event.target.value)} /></Field.Root></div>
        <SegmentGroup.Root className={terminalStyles.commandKind} aria-label="Tipo comando" orientation="horizontal" value={state.commandKind} onValueChange={({ value }) => { if (value) setters.setCommandKind(value as WorkspaceCommandKind) }}><SegmentGroup.Indicator />{([{ value: 'shell', label: 'Comando libero' }, { value: 'ssh', label: 'Connessione SSH' }] as const).map((item) => <SegmentGroup.Item key={item.value} value={item.value}><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText></SegmentGroup.Item>)}</SegmentGroup.Root>
        {state.commandKind === 'shell' ? <Field.Root><Field.Textarea aria-label="Testo comando" placeholder="npm run build" value={state.commandText} onChange={(event) => setters.setCommandText(event.target.value)} /></Field.Root> : <div className={terminalStyles.sshFields}>
          <Field.Root><Field.Input aria-label="Destinazione SSH" autoCapitalize="none" autoCorrect="off" placeholder="alias in ~/.ssh/config oppure utente@server" spellCheck={false} value={state.sshDestination} onChange={(event) => setters.setSshDestination(event.target.value)} /></Field.Root>
          <Field.Root><Field.Input aria-label="Cartella remota iniziale" autoCapitalize="none" autoCorrect="off" placeholder="/srv/app oppure ~/progetto" spellCheck={false} value={state.remoteRoot} onChange={(event) => setters.setRemoteRoot(event.target.value)} /></Field.Root>
          <code className={terminalStyles.sshPreview} aria-label="Comando SSH generato">ssh {state.sshDestination || 'destinazione'} · {state.remoteRoot || 'cartella remota'}</code>
        </div>}
        <Field.Root><Field.Input aria-label="Nota comando" placeholder="Nota opzionale" value={state.commandNote} onChange={(event) => setters.setCommandNote(event.target.value)} /></Field.Root>
        <div className={terminalStyles.commandFormActions}><Button size="sm" disabled={state.commandsBusy || !state.commandFormValid} onClick={() => void actions.saveCommand()}>{state.editingCommandId ? 'Aggiorna comando' : 'Salva comando'}</Button><Button size="sm" type="button" variant="outline" onClick={actions.resetCommandForm}>Annulla</Button></div>
      </div>}
      {state.sshLaunchState && <div className={`${terminalStyles.sshState} ${state.sshLaunchState.state === 'connected' ? terminalStyles.sshStateConnected : state.sshLaunchState.state === 'error' ? terminalStyles.sshStateError : ''}`} role="status"><span>{state.sshLaunchState.state === 'connecting' ? 'Connessione SSH in corso…' : state.sshLaunchState.state === 'connected' ? 'Connessione SSH attiva' : state.sshLaunchState.state === 'error' ? 'Connessione SSH non disponibile' : 'Connessione SSH terminata'}</span><small>{state.sshLaunchState.title}</small></div>}
      {state.sshFailure && <ErrorNotice action={{ label: 'Riconnetti', onClick: actions.retrySshConnection }} error={state.sshFailure} />}
      {state.commandsLoading && <div className={terminalStyles.commandFeedback} role="status"><Spinner size={14} /> Caricamento categorie…</div>}
      {state.commandsLoadError && <ErrorNotice
        action={{ label: 'Riprova', onClick: async () => { try { await actions.loadCommands() } catch { /* Lo stesso callout viene aggiornato dal nuovo incidente. */ } } }}
        error={state.commandsLoadError}
      />}
      {!state.commandsLoading && !state.commandsLoadError && state.commandLibraryView.categories.length === 0 && <div className={terminalStyles.commandFeedback} role="status">{state.commandSearch.trim() ? 'Nessun comando corrisponde alla ricerca.' : 'Nessuna categoria in questo workspace.'}</div>}
      <div className={terminalStyles.commandList}>{state.commandLibraryView.categories.map((category) => {
        const commands = category.commands
        const categoryExpanded = state.expandedCategoryIds.has(category.id) || state.autoExpandedCategoryIds.has(category.id)
        return <Collapsible.Root asChild key={category.id} open={categoryExpanded} onOpenChange={({ open }) => actions.setCategoryExpanded(category.id, open)}><section className={terminalStyles.commandCategory}>
          <h3 className={terminalStyles.commandCategoryHeader}>{state.editingCategory?.id === category.id ? <Field.Root className={terminalStyles.categoryEdit}><Field.Input aria-label={`Rinomina ${category.name}`} value={state.editingCategory.name} onChange={(event) => setters.setEditingCategory({ ...state.editingCategory!, name: event.target.value })} /><Button size="xs" variant="subtle" aria-label={`Salva ${category.name}`} onClick={() => void actions.saveCategory()}>Salva</Button></Field.Root> : <Collapsible.Trigger className={terminalStyles.categoryToggle}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={14} /></Collapsible.Indicator><span className={terminalStyles.categoryLabel}>{category.name}</span><small className={terminalStyles.categoryCount}>{commands.length}</small></Collapsible.Trigger>}<span className={terminalStyles.categoryActions}><IconButton size="icon-xs" tooltip={`Rinomina ${category.name}`} onClick={() => { actions.expandCategory(category.id); setters.setEditingCategory({ id: category.id, name: category.name }) }}><Pencil size={12} /></IconButton><IconButton size="icon-xs" tooltip={`Elimina ${category.name}`} onClick={() => actions.deleteCategory(category)}><Trash2 size={12} /></IconButton></span></h3>
          <Collapsible.Content>{commands.map((command) => <article className={terminalStyles.commandArticle} key={command.id}><div className={terminalStyles.commandCopy}><strong>{command.title}</strong><code>{command.kind === 'ssh' ? `ssh ${command.sshDestination} · ${command.remoteRoot}` : command.command}</code>{command.note && <small>{command.note}</small>}<SelectField aria-label={`Sposta ${command.title}`} options={state.categories.map((candidate) => ({ value: candidate.id, label: `Sposta in: ${candidate.name}` }))} value={command.categoryId} disabled={state.commandsBusy} onValueChange={(value) => void actions.moveCommand(command, value)} /></div><div className={terminalStyles.commandActions}><Button size="sm" disabled={state.commandsBusy || status !== 'ready'} onClick={() => actions.requestRun(command)}><Play size={13} /> {command.kind === 'ssh' ? 'Connetti' : 'Esegui'}</Button><IconButton tooltip={`Modifica ${command.title}`} onClick={() => actions.startEditCommand(command)}><Pencil size={13} /></IconButton><IconButton tooltip={`Elimina ${command.title}`} onClick={() => actions.deleteCommand(command)}><Trash2 size={13} /></IconButton></div></article>)}</Collapsible.Content>
        </section></Collapsible.Root>
      })}</div>
    </aside></Dialog.Content></Splitter.Panel>
  </Splitter.Root>
}
