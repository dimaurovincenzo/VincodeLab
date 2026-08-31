import { X } from 'lucide-react'
import { Button, Dialog, Field, IconButton, SelectField } from '@/components/ui'
import { MarkdownPreview } from '@/components/markdown-preview'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { projectFieldDataType, projectItemTypeLabel } from '../model/github-projects'
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
        <div className={gh.itemMeta}>{item.content?.number && <span className={gh.metaBadge}>#{item.content.number}</span>}<span className={gh.metaBadge}>{projectItemTypeLabel(item)}</span>{item.status && <span className={projectStatusClass(item.status)}>{item.status}</span>}{derived.boardPriorityField && item.fieldValues?.[derived.boardPriorityField.id] && <span className={gh.metaBadge}>{item.fieldValues[derived.boardPriorityField.id]}</span>}</div>
        <section className={gh.itemContent}><h4 className={gh.itemContentTitle}>Descrizione</h4>{derived.issueDetail?.body ? <MarkdownPreview source={derived.issueDetail.body} /> : <p className={gh.muted}>Nessuna descrizione disponibile per questa attività.</p>}</section>
        {derived.issueDetail?.bodyTruncated && <LimitNotice>Descrizione abbreviata: apri la issue su GitHub per leggere il contenuto completo.</LimitNotice>}
        {derived.issueDetail?.labelsHasMore && <LimitNotice>Le etichette della issue sono state limitate.</LimitNotice>}
        <section className={gh.itemProperties}>
          <div className={gh.itemProperty}><span>Assegnatari</span><strong className={gh.itemPropertyValue}>{item.assignees?.length ? item.assignees.join(', ') : 'Non assegnata'}</strong></div>
          <div className={gh.itemProperty}><span>Stato</span>{derived.boardStatusField?.options?.length ? <SelectField aria-label="Stato attività" layer="modal" placeholder="Seleziona stato" options={derived.boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={derived.boardStatusField.options.find((option) => option.name === item.status)?.id ?? ''} disabled={state.busy} onValueChange={(value) => { if (value) void actions.updateBoardStatus(item, value) }} /> : <span className={projectStatusClass(item.status)}>{item.status || 'Non impostato'}</span>}</div>
        </section>
        <section className={gh.projectDialogFields} aria-labelledby="github-project-fields-title">
        <h4 className={gh.itemContentTitle} id="github-project-fields-title">Campi del Project</h4>
        {state.loadingProjectFields ? <p className={gh.muted}>Caricamento campi attività…</p> : derived.editableBoardFields.length ? derived.editableBoardFields.map((field) => {
          const dataType = projectFieldDataType(field)
          const optionField = dataType === 'single_select' || dataType === 'iteration'
          return <Field.Root key={field.id}>
            <Field.Label>{field.name}</Field.Label>
            {optionField ? <div className={gh.projectFieldControls}><SelectField aria-label={field.name} layer="modal" placeholder="Non impostato" options={(field.options ?? []).map((option) => ({ label: option.name, value: option.id }))} value={field.options?.find((option) => option.name === state.projectFieldValues[field.id])?.id ?? ''} disabled={state.busy} onValueChange={(value) => actions.saveBoardOption(item, field, value)} /><span /><Button size="xs" variant="outline" disabled={state.busy || !state.projectFieldValues[field.id]?.trim()} onClick={() => actions.clearBoardField(item, field)}>Svuota</Button></div> : <div className={gh.projectFieldControls}><Field.Input type={dataType === 'date' ? 'date' : dataType === 'number' ? 'number' : 'text'} value={state.projectFieldDrafts[field.id] ?? ''} disabled={state.busy} onChange={(event) => state.setProjectFieldDrafts((current) => ({ ...current, [field.id]: event.target.value }))} /><Button size="xs" disabled={state.busy || !state.projectFieldDrafts[field.id]?.trim()} onClick={() => actions.saveBoardField(item, field)}>Salva</Button><Button size="xs" variant="outline" disabled={state.busy || !state.projectFieldValues[field.id]?.trim()} onClick={() => actions.clearBoardField(item, field)}>Svuota</Button></div>}
          </Field.Root>
        }) : <p className={gh.muted}>Questo Project non espone altri campi modificabili.</p>}
        </section>
        <footer className={gh.modalFooter}><Button tone="danger" variant="outline" size="sm" disabled={state.busy} onClick={() => void actions.archiveBoardItem(item)}>Archivia attività</Button></footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Portal>
  </Dialog.Root>
}
