import { Paperclip, Send, X } from 'lucide-react'
import { useRef, useState, type MouseEvent } from 'react'
import { Button, ErrorNotice, FileUpload, IconButton, Spinner, toast, type FileUploadFileChangeDetails } from '@/components/ui'
import { aiBridge } from '@/features/ai'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import { terminalStyles } from '@/theme/styles/terminal'

export type TerminalContextAction = {
  id: string
  label: string
  description: string
  disabled?: boolean
  onSelect: () => void
}
type TerminalAttachmentsProps = {
  contextActions?: TerminalContextAction[]
  onInsert: (reference: string) => void | Promise<void>
}
type AttachmentItem = { attachment: TerminalAttachment; file: File; pending: boolean }

const maximumAttachments = Number.MAX_SAFE_INTEGER

function chosenFile(attachment: TerminalAttachment) {
  return new File([], attachment.absolutePath, { type: 'application/x-vincodelab-attachment' })
}

export function TerminalAttachments({ contextActions = [], onInsert }: TerminalAttachmentsProps) {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [inserting, setInserting] = useState(false)
  const [insertionFailure, setInsertionFailure] = useState<ReturnType<typeof normalizeUserError> | null>(null)
  const itemsRef = useRef(items)

  const updateItems = (update: (current: AttachmentItem[]) => AttachmentItem[]) => {
    const next = update(itemsRef.current)
    itemsRef.current = next
    setItems(next)
  }

  const addChosenAttachments = async () => {
    try {
      const chosen = await aiBridge.terminal.chooseAttachments()
      updateItems((current) => {
        const known = new Set(current.filter((item) => !item.pending).map((item) => item.attachment.absolutePath))
        const next = chosen.flatMap((attachment) => {
          if (known.has(attachment.absolutePath)) return []
          known.add(attachment.absolutePath)
          return [{ attachment, file: chosenFile(attachment), pending: false }]
        })
        return [...current, ...next]
      })
    } catch (error) {
      const failure = reportUserError(normalizeUserError(error, {
        category: 'filesystem',
        component: 'terminal-attachments',
        operation: 'choose-terminal-attachment',
        recoverable: true,
        title: 'File non allegato',
        description: 'Il file selezionato non è stato aggiunto alla richiesta. Puoi sceglierlo di nuovo.',
      }))
      toast.error(failure.title, {
        dedupeKey: `${failure.category}:${failure.operation}`,
        description: `${failure.description} Riferimento ${failure.correlationId}.`,
        recoveryAction: { label: 'Scegli file', onClick: () => void addChosenAttachments() },
      })
    }
  }

  const prepareDroppedAttachments = async (files: File[]) => {
    try {
      const prepared = await aiBridge.terminal.prepareDroppedAttachments(files)
      updateItems((current) => {
        const preparedByFile = new Map(files.map((file, index) => [file, prepared[index]]))
        const preparedFiles = new Set(files)
        const known = new Set(current.filter((item) => !item.pending).map((item) => item.attachment.absolutePath))
        return current.flatMap((item) => {
          if (!preparedFiles.has(item.file)) return [item]
          const attachment = preparedByFile.get(item.file)
          if (!attachment) return []
          if (known.has(attachment.absolutePath)) return []
          known.add(attachment.absolutePath)
          return [{ attachment, file: item.file, pending: false }]
        })
      })
    } catch (error) {
      const failed = new Set(files)
      updateItems((current) => current.filter((item) => !failed.has(item.file)))
      const failure = reportUserError(normalizeUserError(error, {
        category: 'filesystem',
        component: 'terminal-attachments',
        operation: 'prepare-dropped-terminal-attachments',
        recoverable: true,
        title: 'File trascinati non allegati',
        description: 'I file trascinati non sono stati aggiunti alla richiesta. Puoi selezionarli di nuovo.',
      }))
      toast.error(failure.title, {
        dedupeKey: `${failure.category}:${failure.operation}`,
        description: `${failure.description} Riferimento ${failure.correlationId}.`,
        recoveryAction: { label: 'Scegli file', onClick: () => void addChosenAttachments() },
      })
    }
  }

  const onFileChange = ({ acceptedFiles }: FileUploadFileChangeDetails) => {
    const current = itemsRef.current
    const accepted = new Set(acceptedFiles)
    const known = new Set(current.map((item) => item.file))
    const dropped = acceptedFiles.filter((file) => !known.has(file))
    updateItems(() => [
      ...current.filter((item) => accepted.has(item.file)),
      ...dropped.map((file) => ({ attachment: { absolutePath: '', name: file.name }, file, pending: true })),
    ])
    if (dropped.length > 0) void prepareDroppedAttachments(dropped)
  }

  async function insert() {
    const readyItems = itemsRef.current.filter((item) => !item.pending)
    if (readyItems.length === 0 || inserting) return
    setInserting(true)
    setInsertionFailure(null)
    try {
      await onInsert(`${readyItems.map((item) => `@${item.attachment.absolutePath}`).join(' ')} `)
      const inserted = new Set(readyItems.map((item) => item.file))
      updateItems((current) => current.filter((item) => !inserted.has(item.file)))
    } catch (error) {
      setInsertionFailure(reportUserError(normalizeUserError(error, {
        category: 'process',
        component: 'terminal-attachments',
        operation: 'insert-terminal-attachments',
        title: 'Allegati non inseriti',
        description: 'I file selezionati sono rimasti pronti. Ripristina la sessione AI oppure prova a inserirli di nuovo.',
      })))
    } finally {
      setInserting(false)
    }
  }

  const openElectronChooser = (event: MouseEvent<HTMLInputElement>) => {
    event.preventDefault()
    void addChosenAttachments()
  }

  const readyCount = items.reduce((count, item) => count + Number(!item.pending), 0)

  return <FileUpload.Root acceptedFiles={items.map((item) => item.file)} aria-busy={items.some((item) => item.pending) || inserting} maxFiles={maximumAttachments} onFileChange={onFileChange} translations={{ deleteFile: (file) => `Rimuovi ${file.name}`, dropzone: 'Allega file a Pi trascinandoli qui o scegliendoli' }}>
    <FileUpload.HiddenInput onClick={openElectronChooser} />
    <FileUpload.Dropzone>
      <FileUpload.Trigger asChild><IconButton tooltip="Allega file a Pi"><Paperclip aria-hidden="true" size={15} /></IconButton></FileUpload.Trigger>
      {contextActions.length > 0 && <div className={terminalStyles.contextActions} aria-label="Contesto disponibile per Pi"><span className={terminalStyles.contextLabel}>Contesto</span>{contextActions.map((action) => <Button key={action.id} size="xs" variant="surface" disabled={action.disabled} title={action.description} onClick={action.onSelect}>{action.label}</Button>)}</div>}
      {items.length > 0 && <FileUpload.ItemGroup aria-label="File pronti per Pi">{items.map(({ attachment, file, pending }) => <FileUpload.Item aria-busy={pending || undefined} data-pending={pending || undefined} file={file} key={`${file.name}:${file.size}:${file.type}`} title={attachment.absolutePath || undefined}>
        <FileUpload.ItemName>{attachment.name}</FileUpload.ItemName>
        <FileUpload.ItemDeleteTrigger asChild><IconButton size="icon-xs" tooltip={`Rimuovi ${attachment.name}`}><X aria-hidden="true" size={12} /></IconButton></FileUpload.ItemDeleteTrigger>
      </FileUpload.Item>)}</FileUpload.ItemGroup>}
      <FileUpload.Action asChild><Button size="sm" variant="subtle" disabled={readyCount === 0 || inserting} onClick={() => void insert()}>{inserting ? <Spinner size={13} /> : <Send aria-hidden="true" size={13} />} {inserting ? 'Inserimento…' : 'Inserisci'}</Button></FileUpload.Action>
    </FileUpload.Dropzone>
    {insertionFailure && <ErrorNotice action={{ label: 'Inserisci di nuovo', onClick: insert }} error={insertionFailure} />}
  </FileUpload.Root>
}
