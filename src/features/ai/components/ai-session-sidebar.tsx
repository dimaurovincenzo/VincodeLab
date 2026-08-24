import { useRef, useState } from 'react'
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { PiSession } from '@/bridge'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { Button, Dialog, Field, IconButton, Spinner } from '@/components/ui'
import type { AiSessionsController } from '../hooks/use-ai-sessions'
import { aiStyles } from '@/theme/styles/ai'
import { confirmationDialogStyles } from '@/theme/styles/dialogs'

const activityLabels = {
  ready: 'Pronto',
  working: 'In lavorazione',
  completed: 'Task completato',
  unknown: 'Stato non disponibile',
} as const

function visibleActivity(session: PiSession) {
  if (session.status === 'starting') return 'Avvio…'
  if (session.status === 'error') return 'Errore'
  if (session.status === 'exited') return 'Terminato'
  return activityLabels[session.activity]
}

export function AiSessionSidebar({ controller }: { controller: AiSessionsController & { retryAiOutput: () => Promise<void> } }) {
  const [renameTarget, setRenameTarget] = useState<PiSession | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const renameInput = useRef<HTMLInputElement>(null)

  const beginRename = (session: PiSession) => {
    setRenameValue(session.title)
    setRenameTarget(session)
  }

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    const renamed = await controller.renameSession(renameTarget.sessionId, renameValue)
    if (renamed) setRenameTarget(null)
  }

  const requestClose = (session: PiSession) => setConfirmation({
    title: `Chiudi ${session.title}`,
    detail: 'Il processo Pi e lo storico visuale di questa sessione verranno chiusi. Gli altri agenti non saranno interrotti.',
    confirmLabel: 'Chiudi agente',
    destructive: true,
    onConfirm: () => { void controller.closeSession(session.sessionId) },
  })

  return <>
    <aside className={aiStyles.sessionSidebar} aria-label="Agenti Pi del workspace">
      <header className={aiStyles.sessionSidebarHeader}>
        <div><strong>Agenti Pi</strong><span>{controller.sessions.length}/4 sessioni</span></div>
        <IconButton disabled={controller.pending || controller.sessions.length >= 4} size="icon-sm" tooltip="Avvia un nuovo agente Pi" onClick={() => void controller.createSession()}>
          {controller.pending ? <Spinner size={14} /> : <Plus aria-hidden="true" size={15} />}
        </IconButton>
      </header>
      {controller.workingCount > 1 && <p className={aiStyles.sessionConcurrencyNotice} role="status">{controller.workingCount} agenti stanno modificando lo stesso workspace. Coordina i task per evitare conflitti.</p>}
      <div className={aiStyles.sessionList} role="list" aria-label="Sessioni Pi">
        {controller.sessions.map((session) => <div className={`${aiStyles.sessionItem} ${session.active ? aiStyles.sessionItemActive : ''}`} key={session.sessionId} role="listitem">
          <Button className={aiStyles.sessionSelect} disabled={controller.pending} type="button" variant="plain" aria-current={session.active ? 'true' : undefined} onClick={() => void controller.focusSession(session.sessionId)}>
            <span className={`${aiStyles.sessionActivityDot} ${session.status === 'error' || session.status === 'exited' ? aiStyles.sessionActivityError : session.activity === 'working' ? aiStyles.sessionActivityWorking : session.activity === 'completed' ? aiStyles.sessionActivityCompleted : ''}`} aria-hidden="true" />
            <span className={aiStyles.sessionCopy}><strong>{session.title}</strong><small>{visibleActivity(session)}</small></span>
          </Button>
          <div className={aiStyles.sessionActions} aria-label={`Azioni ${session.title}`}>
            <IconButton size="icon-xs" tooltip={`Rinomina ${session.title}`} onClick={() => beginRename(session)}><Pencil aria-hidden="true" size={12} /></IconButton>
            <IconButton size="icon-xs" tooltip={`Riavvia ${session.title}`} onClick={() => void controller.restartSession(session.sessionId).then((result) => { if (result && session.active) void controller.retryAiOutput() })}><RotateCcw aria-hidden="true" size={12} /></IconButton>
            <IconButton size="icon-xs" tooltip={`Chiudi ${session.title}`} onClick={() => requestClose(session)}><Trash2 aria-hidden="true" size={12} /></IconButton>
          </div>
        </div>)}
        {controller.sessions.length === 0 && <div className={aiStyles.sessionEmpty}><p>Nessun agente aperto.</p><Button disabled={controller.pending} size="sm" onClick={() => void controller.createSession()}><Plus aria-hidden="true" size={14} /> Avvia Pi</Button></div>}
      </div>
    </aside>

    <Dialog.Root initialFocusEl={() => renameInput.current} lazyMount open={renameTarget !== null} unmountOnExit onOpenChange={({ open }) => { if (!open) setRenameTarget(null) }}>
      <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={confirmationDialogStyles.content}>
        <header className={aiStyles.renameHeader}><div><p className={confirmationDialogStyles.eyebrow}>Sessione Pi</p><Dialog.Title>Rinomina agente</Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi rinomina"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
        <Dialog.Description>Usa un nome breve che descriva il task assegnato.</Dialog.Description>
        <Field.Root><Field.Label>Nome sessione</Field.Label><Field.Input ref={renameInput} maxLength={64} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitRename() } }} /></Field.Root>
        <div className={confirmationDialogStyles.actions}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={!renameValue.trim() || controller.pending} onClick={() => void submitRename()}>Rinomina</Button></div>
      </Dialog.Content></Dialog.Positioner></Dialog.Portal>
    </Dialog.Root>
    <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
  </>
}
