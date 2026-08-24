import { X } from 'lucide-react'
import { Button, Dialog, Field, IconButton, SelectField } from '@/components/ui'
import { MarkdownPreview } from '@/components/markdown-preview'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { projectFieldDataType } from '../model/github-projects'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'
import { projectStatusClass } from './github-project-status'

export function GitHubProjectItemDialog({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, derived, errors, recoveries, state } = controller
  const { boardItemDialogTrigger, boardSearchInput } = controller.elements
  const item = derived.selectedBoardItem
  if (!item) return null

  return <Dialog.Root finalFocusEl={() => boardItemDialogTrigger.current?.isConnected ? boardItemDialogTrigger.current : boardSearchInput.current} ids={{ title: 'github-item-modal-title' }} open={state.boardItemDialogOpen} onOpenChange={({ open }) => actions.changeBoardItemDialogOpen(open)} onExitComplete={() => { if (!state.boardItemDialogOpen) state.setSelectedBoardItemId(null) }}>
    <Dialog.Portal><Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content className={cx(gh.modalContent, gh.itemModal)}>
        <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Attività del Project</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-item-modal-title">{item.content?.title ?? item.title ?? 'Attività'}</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio attività"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
        <GitHubErrorNotice error={errors.surfaceErrors['project-fields']} label="Riprova campi" onClick={recoveries.retrySelectedProjectFields} />
        <div className={gh.itemMeta}>{item.content?.number && <span className={gh.metaBadge}>#{item.content.number}</span>}<span className={gh.metaBadge}>{item.type === 'PULL_REQUEST' ? 'Pull request' : 'Issue'}</span>{item.status && <span className={projectStatusClass(item.status)}>{item.status}</span>}{derived.boardPriorityField && item.fieldValues?.[derived.boardPriorityField.id] && <span className={gh.metaBadge}>{item.fieldValues[derived.boardPriorityField.id]}</span>}</div>
        <section className={gh.itemContent}><h4 className={gh.itemContentTitle}>Descrizione</h4>{derived.issueDetail?.body ? <MarkdownPreview source={derived.issueDetail.body} /> : <p className={gh.muted}>Nessuna descrizione disponibile per questa attività.</p>}</section>
        {derived.issueDetail?.bodyTruncated && <LimitNotice>Descrizione abbreviata: apri la issue su GitHub per leggere il contenuto completo.</LimitNotice>}
        {derived.issueDetail?.labelsHasMore && <LimitNotice>Le etichette della issue sono state limitate.</LimitNotice>}
        <section className={gh.itemProperties}>
          <div className={gh.itemProperty}><span>Assegnatari</span><strong className={gh.itemPropertyValue}>{item.assignees?.length ? item.assignees.join(', ') : 'Non assegnata'}</strong></div>
          <div className={gh.itemProperty}><span>Stato</span>{derived.boardStatusField?.options?.length ? <SelectField aria-label="Stato attività" layer="modal" placeholder="Seleziona stato" options={derived.boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={derived.boardStatusField.options.find((option) => option.name === item.status)?.id ?? ''} disabled={state.busy} onValueChange={(value) => { if (value) void actions.updateBoardStatus(item, value) }} /> : <span className={projectStatusClass(item.status)}>{item.status || 'Non impostato'}</span>}</div>
        </section>
        {state.loadingProjectFields ? <p className={gh.muted}>Caricamento campi attività…</p> : derived.editableBoardFields.map((field) => <Field.Root key={field.id}>
          <Field.Label>{field.name}</Field.Label>
          <div className={gh.projectFieldControls}><Field.Input type={projectFieldDataType(field) === 'date' ? 'date' : projectFieldDataType(field) === 'number' ? 'number' : 'text'} value={state.projectFieldDrafts[field.id] ?? ''} disabled={state.busy} onChange={(event) => state.setProjectFieldDrafts((current) => ({ ...current, [field.id]: event.target.value }))} /><Button size="xs" disabled={state.busy || !state.projectFieldDrafts[field.id]?.trim()} onClick={() => actions.saveBoardField(item, field)}>Salva</Button><Button size="xs" variant="outline" disabled={state.busy || !state.projectFieldValues[field.id]?.trim()} onClick={() => actions.clearBoardField(item, field)}>Svuota</Button></div>
        </Field.Root>)}
        <footer className={gh.modalFooter}><Button variant="outline" size="sm" disabled={state.busy} onClick={() => void actions.archiveBoardItem(item)}>Archivia attività</Button></footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
