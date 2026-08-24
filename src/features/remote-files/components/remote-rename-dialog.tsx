import { X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, Field, IconButton } from '@/components/ui'
import { remoteStyles } from '@/theme/styles/remote'
import type { RemoteFilesController } from '../hooks/use-remote-files-controller'

type Props = Pick<RemoteFilesController, 'actions' | 'elements' | 'state'>

export function RemoteRenameDialog({ actions, elements, state }: Props) {
  const { renameDialogOpener, renameInput } = elements
  return (
    <Dialog.Root
      finalFocusEl={() => renameDialogOpener.current}
      ids={{ title: 'remote-rename-title' }}
      initialFocusEl={() => renameInput.current}
      lazyMount
      open={state.renaming !== null}
      unmountOnExit
      onOpenChange={({ open }) => { if (!open) actions.closeRename() }}
    >
      <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={remoteStyles.dialog}>
        <header className={remoteStyles.dialogHeader}><Dialog.Title id="remote-rename-title">Rinomina elemento remoto</Dialog.Title><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi rinomina"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
        <Field.Root><Field.Label>Nuovo nome</Field.Label><Field.Input ref={renameInput} value={state.renameValue} onChange={(event) => state.setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void actions.renameEntry() }} /></Field.Root>
        {state.renameError && <ErrorNotice action={{ label: 'Riprova', onClick: actions.renameEntry }} error={state.renameError} />}
        <footer className={remoteStyles.dialogFooter}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={!state.renameValue.trim()} onClick={() => void actions.renameEntry()}>Rinomina</Button></footer>
      </Dialog.Content></Dialog.Positioner></Dialog.Portal>
    </Dialog.Root>
  )
}
