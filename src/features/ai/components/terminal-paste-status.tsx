import { useRef } from 'react'
import { X } from 'lucide-react'
import { Button, Dialog, ErrorNotice, IconButton, Progress, Spinner, type ErrorNoticeAction } from '@/components/ui'
import type { UserError } from '@/lib/user-error'
import type { TerminalPasteProgress } from '../services/terminal-paste-controller.js'
import { terminalStyles } from '@/theme/styles/terminal'

function formatBytes(bytes: number) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, style: 'unit', unit: bytes >= 1024 * 1024 ? 'megabyte' : 'kilobyte', unitDisplay: 'short' }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024))
}

function failureDescription(progress: TerminalPasteProgress) {
  if (progress.reason === 'too-large') return `Il contenuto occupa ${formatBytes(progress.totalBytes)} e supera il limite di ${formatBytes(progress.limit ?? 5 * 1024 * 1024)}.`
  if (progress.reason === 'not-running') return 'La sessione Pi non è disponibile. Riavviala e riprova.'
  if (progress.reason === 'busy') return 'È già in corso un altro incolla nel Terminale AI.'
  return 'Contenuto non incollato. Il trasferimento non è stato completato e la parte non inviata non è stata scritta nel terminale.'
}

export function TerminalPasteStatus({ failure, failureAction, progress, onCancel, onClose }: {
  failure?: UserError | null
  failureAction?: ErrorNoticeAction
  progress: TerminalPasteProgress
  onCancel: () => void
  onClose: () => void
}) {
  const failed = progress.status === 'failed'
  const percentage = progress.totalBytes > 0 ? Math.min(100, Math.round(progress.sentBytes / progress.totalBytes * 100)) : 100
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const primaryAction = useRef<HTMLButtonElement>(null)

  return <Dialog.Root finalFocusEl={() => opener.current} ids={{ title: 'terminal-paste-title' }} initialFocusEl={() => primaryAction.current} open onOpenChange={({ open }) => { if (!open && failed) onClose() }} closeOnEscape={failed} closeOnInteractOutside={false}>
    <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Positioner><Dialog.Content aria-live={failed ? 'assertive' : 'polite'} className={terminalStyles.pasteDialog}>
    <div className={terminalStyles.pasteHeader}>
      <div className={terminalStyles.pasteHeaderCopy}>
        <Dialog.Title id="terminal-paste-title">Incolla nel Terminale AI</Dialog.Title>
        <span className={terminalStyles.pasteDescription}>{failed && !failure ? failureDescription(progress) : !failed ? `${formatBytes(progress.sentBytes)} di ${formatBytes(progress.totalBytes)}` : 'Il contenuto non inviato è rimasto negli appunti.'}</span>
      </div>
      {failed && <Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi contenuto non incollato"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger>}
    </div>
    {!failed && <>
      <Progress.Root max={100} min={0} value={percentage}>
        <Progress.Track aria-label="Avanzamento incolla nel Terminale AI" aria-valuetext={`${percentage}%`}><Progress.Range /></Progress.Track>
      </Progress.Root>
      <div className={terminalStyles.pasteActions}><Spinner size={14} /><span>{progress.status === 'starting' ? 'Preparazione…' : 'Invio controllato…'}</span><Button ref={primaryAction} onClick={onCancel} size="sm" variant="outline">Annulla</Button></div>
    </>}
    {failed && failure && <ErrorNotice action={failureAction} error={failure} />}
    {failed && <div className={`${terminalStyles.pasteActions} ${terminalStyles.pasteActionsEnd}`}><Dialog.CloseTrigger asChild unstyled><Button ref={primaryAction} size="sm">Chiudi</Button></Dialog.CloseTrigger></div>}
    </Dialog.Content></Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
