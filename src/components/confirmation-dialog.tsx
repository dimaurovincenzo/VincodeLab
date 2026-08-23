import { useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { Dialog } from '@/components/ui'
import { confirmationDialogStyles } from '@/theme/styles/dialogs'

export interface ConfirmationRequest {
  title: string
  detail: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

export function ConfirmationDialog({ request, onCancel }: { request: ConfirmationRequest | null; onCancel: () => void }) {
  const [lastRequest, setLastRequest] = useState(request)
  const open = request !== null
  const [focusState, setFocusState] = useState<{ open: boolean; opener: HTMLElement | null }>(() => ({
    open,
    opener: open && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  }))
  const cancelButton = useRef<HTMLButtonElement>(null)
  if (open !== focusState.open) setFocusState({
    open,
    opener: open && document.activeElement instanceof HTMLElement ? document.activeElement : focusState.opener,
  })
  if (request && request !== lastRequest) setLastRequest(request)

  const renderedRequest = request ?? lastRequest

  return <Dialog.Root finalFocusEl={() => focusState.opener} initialFocusEl={() => cancelButton.current} lazyMount open={request !== null} unmountOnExit onExitComplete={() => {
    if (!request) setLastRequest(null)
  }} onOpenChange={({ open }) => { if (!open) onCancel() }}>
    {renderedRequest && <>
    <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Positioner>
    <Dialog.Content className={confirmationDialogStyles.content}>
      <p className={confirmationDialogStyles.eyebrow}>Conferma operazione</p>
      <Dialog.Title>{renderedRequest.title}</Dialog.Title>
      <Dialog.Description>{renderedRequest.detail}</Dialog.Description>
      <div className={confirmationDialogStyles.actions}><Dialog.CloseTrigger asChild unstyled><Button ref={cancelButton} variant="outline">Annulla</Button></Dialog.CloseTrigger><Button tone={renderedRequest.destructive ? 'danger' : 'accent'} variant={renderedRequest.destructive ? 'subtle' : 'solid'} onClick={() => { onCancel(); renderedRequest.onConfirm() }}>{renderedRequest.confirmLabel}</Button></div>
    </Dialog.Content>
    </Dialog.Positioner>
    </Dialog.Portal>
    </>}
  </Dialog.Root>
}
