import { useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { Dialog } from '@/components/ui'
import { confirmationDialogStyles } from '@/theme/styles/dialogs'

type Props = {
  intent?: 'workspace' | 'window' | 'quit'
  open: boolean
  saving: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}

const dialogContent = {
  workspace: {
    title: 'Vuoi cambiare workspace?',
    description: 'Editor, Skill o Istruzioni contengono modifiche non salvate. Salvale prima del cambio oppure scartale esplicitamente.',
    discardLabel: 'Scarta e cambia',
    saveLabel: 'Salva e cambia',
  },
  window: {
    title: 'Vuoi chiudere la finestra?',
    description: 'Editor, Skill o Istruzioni contengono modifiche non salvate. Salvale prima della chiusura oppure scartale esplicitamente.',
    discardLabel: 'Scarta e chiudi',
    saveLabel: 'Salva e chiudi',
  },
  quit: {
    title: 'Vuoi uscire da VincodeLab?',
    description: 'Editor, Skill o Istruzioni contengono modifiche non salvate. Salvale prima di uscire oppure scartale esplicitamente.',
    discardLabel: 'Scarta ed esci',
    saveLabel: 'Salva ed esci',
  },
} as const

export function WorkspaceChangeDialog({ intent = 'workspace', open, saving, onCancel, onDiscard, onSave }: Props) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const content = dialogContent[intent]
  const [focusState, setFocusState] = useState<{ open: boolean; opener: HTMLElement | null }>(() => ({
    open,
    opener: open && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }))
  if (open !== focusState.open) setFocusState({
    open,
    opener: open && document.activeElement instanceof HTMLElement ? document.activeElement : focusState.opener,
  })

  return <Dialog.Root closeOnEscape={!saving} closeOnInteractOutside={!saving} finalFocusEl={() => focusState.opener} initialFocusEl={() => cancelButton.current} lazyMount open={open} unmountOnExit onOpenChange={({ open: nextOpen }) => { if (!nextOpen && !saving) onCancel() }}>
    <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Positioner>
    <Dialog.Content className={confirmationDialogStyles.content}>
      <p className={confirmationDialogStyles.eyebrow}>File non salvati</p>
      <Dialog.Title>{content.title}</Dialog.Title>
      <Dialog.Description>{content.description}</Dialog.Description>
      <div className={confirmationDialogStyles.actions}>
        <Dialog.CloseTrigger asChild unstyled><Button ref={cancelButton} disabled={saving} variant="outline">Annulla</Button></Dialog.CloseTrigger>
        <Button disabled={saving} tone="danger" variant="subtle" onClick={onDiscard}>{content.discardLabel}</Button>
        <Button aria-busy={saving} disabled={saving} onClick={onSave}>{saving ? 'Salvataggio…' : content.saveLabel}</Button>
      </div>
    </Dialog.Content>
    </Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
