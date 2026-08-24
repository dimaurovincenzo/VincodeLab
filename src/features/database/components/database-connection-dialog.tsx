import type { RefObject } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, Field, IconButton, SelectField } from '@/components/ui'
import type { UserError } from '@/lib/user-error'
import { defaultDatabasePort as defaultPort } from '../model/database-connections'
import type { DatabaseConnectionDraft as ConnectionDraft, DatabaseDriver as Driver } from '../model/database.types'
import { databaseStyles as db } from '@/theme/styles/database'

type DatabaseConnectionDialogProps = {
  draft: ConnectionDraft
  editingConnectionId: string | null
  error: UserError | null
  nameInputRef: RefObject<HTMLInputElement | null>
  onClose: () => void
  onDraftChange: (next: ConnectionDraft | ((current: ConnectionDraft) => ConnectionDraft)) => void
  onSave: () => Promise<void>
  open: boolean
  openerRef: RefObject<HTMLElement | null>
}

export function DatabaseConnectionDialog({
  draft,
  editingConnectionId,
  error,
  nameInputRef,
  onClose,
  onDraftChange,
  onSave,
  open,
  openerRef,
}: DatabaseConnectionDialogProps) {
  const setDriver = (driver: Driver) => onDraftChange((current) => ({ ...current, driver, port: driver === 'sqlite' ? undefined : defaultPort[driver] }))

  return <Dialog.Root
    finalFocusEl={() => openerRef.current}
    initialFocusEl={() => nameInputRef.current}
    lazyMount
    open={open}
    unmountOnExit
    onOpenChange={({ open: nextOpen }) => { if (!nextOpen) onClose() }}
  >
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content className={db.dialogContent}>
          <header className={db.dialogHeader}>
            <div className={db.dialogHeading}>
              <p className={db.dialogEyebrow}>Database del workspace</p>
              <Dialog.Title className={db.dialogTitle}>{editingConnectionId ? 'Modifica connessione' : 'Nuova connessione'}</Dialog.Title>
            </div>
            <Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi connessione"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger>
          </header>
          <form className={db.connectionForm} onSubmit={(event) => { event.preventDefault(); void onSave() }}>
            <Field.Root>
              <Field.Label>Nome connessione</Field.Label>
              <Field.Input ref={nameInputRef} placeholder="Nome connessione" value={draft.name} onChange={(event) => onDraftChange((current) => ({ ...current, name: event.target.value }))} />
            </Field.Root>
            <SelectField
              label="Driver database"
              layer="modal"
              options={[
                { value: 'sqlite', label: 'SQLite' },
                { value: 'postgres', label: 'PostgreSQL' },
                { value: 'mysql', label: 'MySQL' },
                { value: 'mssql', label: 'SQL Server' },
              ]}
              value={draft.driver}
              onValueChange={(value) => setDriver(value as Driver)}
            />
            {draft.driver === 'sqlite'
              ? <Field.Root>
                  <Field.Label>Percorso SQLite</Field.Label>
                  <Field.Input placeholder="/percorso/database.sqlite" value={draft.sqlitePath ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, sqlitePath: event.target.value }))} />
                </Field.Root>
              : <div className={db.remoteFields}>
                  <Field.Root><Field.Label>Host</Field.Label><Field.Input placeholder="Host" value={draft.host ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, host: event.target.value }))} /></Field.Root>
                  <Field.Root><Field.Label>Porta</Field.Label><Field.Input min="1" max="65535" placeholder="Porta" type="number" value={draft.port ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, port: Number(event.target.value) }))} /></Field.Root>
                  <Field.Root><Field.Label>Database</Field.Label><Field.Input placeholder="Database" value={draft.database ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, database: event.target.value }))} /></Field.Root>
                  <Field.Root><Field.Label>Utente</Field.Label><Field.Input placeholder="Utente" value={draft.user ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, user: event.target.value }))} /></Field.Root>
                  <Field.Root><Field.Label>Password</Field.Label><Field.Input placeholder={draft.hasPassword ? 'Lascia vuoto per mantenere la password' : 'Password'} required={!draft.hasPassword} type="password" value={draft.password ?? ''} onChange={(event) => onDraftChange((current) => ({ ...current, password: event.target.value }))} /></Field.Root>
                </div>}
            {error && <ErrorNotice action={{ label: 'Riprova salvataggio', onClick: onSave }} error={error} />}
            <div className={db.formActions}>
              <Dialog.CloseTrigger asChild unstyled><Button size="sm" type="button" variant="outline">Annulla</Button></Dialog.CloseTrigger>
              <Button size="sm" type="submit"><Plus size={14} /> {editingConnectionId ? 'Salva modifiche' : 'Aggiungi connessione'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
