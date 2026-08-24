import { Clipboard, ClipboardPaste, Minus, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { Button, IconButton } from '@/components/ui'
import { terminalStyles } from '@/theme/styles/terminal'

type TerminalToolbarProps = {
  fontSize: number
  statusLabel: string
  onClear: () => void
  onCopy: () => void
  onPaste: () => void
  onResetZoom: () => void
  onRestart: () => void
  onSearch?: () => void
  onZoom: (delta: number) => void
  restartLabel?: string
}

export function TerminalToolbar({ fontSize, statusLabel, onClear, onCopy, onPaste, onResetZoom, onRestart, onSearch, onZoom, restartLabel = 'Riavvia sessione' }: TerminalToolbarProps) {
  return <div className={terminalStyles.toolbar} aria-label="Controlli terminale">
    <span className={terminalStyles.toolbarStatus} aria-live="polite">{statusLabel}</span>
    <div className={terminalStyles.toolbarActions}>
      {onSearch && <IconButton tooltip="Cerca (⌘F)" aria-label="Cerca nel terminale" onClick={onSearch}><Search aria-hidden="true" size={15} /></IconButton>}
      <IconButton tooltip="Riduci zoom" onClick={() => onZoom(-1)}><Minus aria-hidden="true" size={15} /></IconButton>
      <Button size="sm" variant="plain" className={terminalStyles.zoomReset} aria-label="Reimposta zoom" onClick={onResetZoom} title="Reimposta zoom">{fontSize}px</Button>
      <IconButton tooltip="Aumenta zoom" onClick={() => onZoom(1)}><Plus aria-hidden="true" size={15} /></IconButton>
      <IconButton tooltip="Copia selezione" onClick={onCopy}><Clipboard aria-hidden="true" size={15} /></IconButton>
      <IconButton tooltip="Incolla nel terminale" onClick={onPaste}><ClipboardPaste aria-hidden="true" size={15} /></IconButton>
      <IconButton tooltip="Pulisci vista" aria-label="Pulisci vista terminale" onClick={onClear}><Trash2 aria-hidden="true" size={15} /></IconButton>
      <IconButton tooltip={restartLabel} onClick={onRestart}><RefreshCw aria-hidden="true" size={15} /></IconButton>
    </div>
  </div>
}
