import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { MergeView } from '@codemirror/merge'
import { EditorView, lineNumbers } from '@codemirror/view'
import { AlertTriangle, FileDiff, X } from 'lucide-react'
import { Button, Dialog, IconButton } from '@/components/ui'
import { graphiteCodeMirrorTheme } from '@/lib/codemirror-theme'
import { remoteDiffDialogStyles } from '@/theme/styles/dialogs'

type RemoteDiffDialogProps = {
  file: RemoteTrackedFile
  comparison: RemoteCompareResult
  busy: boolean
  onClose: () => void
  onUpload: () => void
  onForceUpload: () => void
}

export function RemoteDiffDialog({ file, comparison, busy, onClose, onUpload, onForceUpload }: RemoteDiffDialogProps) {
  const mergeHost = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useEffect(() => {
    if (!mergeHost.current || comparison.binary) return
    const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers(), graphiteCodeMirrorTheme]
    const merge = new MergeView({
      a: { doc: comparison.remoteContent ?? '', extensions: readOnly },
      b: { doc: comparison.localContent ?? '', extensions: readOnly },
      parent: mergeHost.current,
      orientation: 'a-b',
      highlightChanges: true,
    })
    return () => merge.destroy()
  }, [comparison])

  return <Dialog.Root finalFocusEl={() => opener.current} ids={{ title: 'remote-diff-title' }} initialFocusEl={() => closeButton.current} open onOpenChange={({ open }) => { if (!open) onClose() }}>
    <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Positioner><Dialog.Content className={remoteDiffDialogStyles.content}>
      <header className={remoteDiffDialogStyles.header}>
        <div className={remoteDiffDialogStyles.headerCopy}><p className={remoteDiffDialogStyles.eyebrow}>File remoto</p><Dialog.Title className={remoteDiffDialogStyles.title} id="remote-diff-title"><FileDiff aria-hidden="true" size={18} /> Confronta {file.name}</Dialog.Title><small className={remoteDiffDialogStyles.path} title={file.remotePath}>{file.remotePath}</small></div>
        <Dialog.CloseTrigger asChild><IconButton ref={closeButton} tooltip="Chiudi confronto remoto"><X aria-hidden="true" size={16} /></IconButton></Dialog.CloseTrigger>
      </header>
      {comparison.baselineChanged && <div className={remoteDiffDialogStyles.conflict} role="alert"><AlertTriangle aria-hidden="true" size={16} /><span>Il file sul server è cambiato dopo il download. Controlla le differenze prima di sostituirlo.</span></div>}
      <div className={remoteDiffDialogStyles.labels}><strong className={remoteDiffDialogStyles.label}>Versione sul server</strong><strong className={remoteDiffDialogStyles.label}>Copia locale</strong></div>
      {comparison.binary
        ? <div className={remoteDiffDialogStyles.binary}><p className={remoteDiffDialogStyles.binaryDescription}>Il file è binario: il contenuto non può essere confrontato come testo.</p><dl className={remoteDiffDialogStyles.hashes}><div className={remoteDiffDialogStyles.hash}><dt className={remoteDiffDialogStyles.hashTerm}>Hash server</dt><dd className={remoteDiffDialogStyles.hashValue}>{comparison.remoteHash}</dd></div><div className={remoteDiffDialogStyles.hash}><dt className={remoteDiffDialogStyles.hashTerm}>Hash locale</dt><dd className={remoteDiffDialogStyles.hashValue}>{comparison.localHash}</dd></div></dl></div>
        : <div aria-label="Confronto tra server e copia locale" className={remoteDiffDialogStyles.merge} data-codemirror-merge ref={mergeHost} />}
      <footer className={remoteDiffDialogStyles.footer}>
        <Dialog.CloseTrigger asChild unstyled><Button variant="outline" disabled={busy}>Chiudi</Button></Dialog.CloseTrigger>
        {comparison.baselineChanged
          ? <Button tone="danger" variant="subtle" onClick={onForceUpload} disabled={busy}><AlertTriangle aria-hidden="true" /> {busy ? 'Caricamento…' : 'Forza sostituzione'}</Button>
          : <Button onClick={onUpload} disabled={busy}><FileDiff aria-hidden="true" /> {busy ? 'Caricamento…' : 'Carica sul server'}</Button>}
      </footer>
    </Dialog.Content></Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
