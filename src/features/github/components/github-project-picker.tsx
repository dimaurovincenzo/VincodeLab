import { Check, ChevronRight, FolderKanban, Plus, Settings2 } from 'lucide-react'
import { Button, Collapsible, Field, Listbox, Splitter } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'

export function GitHubProjectPicker({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, derived, errors, recoveries, state } = controller

  return <Splitter.Panel asChild id="github-project-picker"><section className={cx(gh.panel, gh.projectListPanel)}>
    <div className={gh.projectListHeading}><h2 className={cx(gh.panelTitle, gh.projectListTitle)} id="github-project-list-label"><FolderKanban size={15} /> Progetti GitHub del workspace {state.data && <span className={gh.panelTitleCount}>{state.data.projects.length}</span>}</h2>{derived.selectedProjectDetails && <Splitter.CollapseTrigger collapseLabel="Comprimi elenco Project" expandLabel="Cambia Project" panelId="github-project-picker" variant="outline" />}</div>
    {state.projectPickerCollapsed && derived.selectedProjectDetails && <div className={gh.projectActive}><span className={gh.projectActiveLabel}>Project attivo</span><strong className={gh.projectActiveTitle}>{derived.selectedProjectDetails.title}</strong></div>}
    <div className={gh.projectPickerContent({ hidden: state.projectPickerCollapsed })}>
    {state.data?.githubDiagnostic ? <GitHubErrorNotice error={errors.surfaceErrors['github-diagnostic']} label="Aggiorna dati GitHub" onClick={() => recoveries.refreshGitHubAfterFailure('github-diagnostic')} /> : !state.data?.repository ? <p className={gh.muted}>GitHub non è configurato per questo workspace.</p> : <>
      <p className={gh.projectScope}>Solo progetti collegati a <strong>{state.data.repository.nameWithOwner}</strong>.</p>
      {derived.projectsLimited && <LimitNotice>Elenco Project limitato ai primi {state.data.projects.length} risultati collegati.</LimitNotice>}
      {state.data.projectsDiagnostic && <GitHubErrorNotice error={errors.surfaceErrors['projects-diagnostic']} label="Aggiorna autorizzazioni e dati" onClick={() => recoveries.refreshGitHubAfterFailure('projects-diagnostic')} />}
      <GitHubErrorNotice error={errors.surfaceErrors.projects} label="Aggiorna Projects" onClick={() => recoveries.refreshGitHubAfterFailure('projects')} />
      <Collapsible.Root className={gh.projectUtility}>
        <Collapsible.Trigger className={gh.projectUtilityTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={14} /></Collapsible.Indicator><Plus aria-hidden="true" size={14} /> Nuovo Project</Collapsible.Trigger>
        <Collapsible.Content><div className={gh.projectCreate}><Field.Root className={gh.growField}><Field.Input aria-label="Titolo del nuovo Project" value={state.projectTitle} maxLength={256} placeholder="Titolo del nuovo Project" onChange={(event) => state.setProjectTitle(event.target.value)} /></Field.Root><Button size="sm" disabled={state.busy || !state.projectTitle.trim()} onClick={actions.requestCreateProject}>Crea</Button></div></Collapsible.Content>
      </Collapsible.Root>
      {state.data.projects.length ? <Listbox.Root className={gh.projectListboxRoot} collection={derived.projectCollection} deselectable={false} ids={{ label: 'github-project-list-label' }} loopFocus selectionMode="single" value={state.selectedProject ? [String(state.selectedProject)] : []} onValueChange={({ items }) => { const project = items[0]; if (!project) return; state.setBoardItemDialogOpen(false); state.setSelectedBoardItemId(null); void actions.loadBoard(project.number) }}><Listbox.Content className={gh.projectListbox}>{state.data.projects.map((project) => <Listbox.Item className={gh.projectItem} highlightOnHover item={project} key={project.number}><Listbox.ItemText asChild><span className={gh.projectItemContent}><span className={gh.projectItemHeader}><strong className={gh.projectItemTitle}>{project.title}</strong><span className={gh.projectItemState}>{project.closed ? 'Chiuso' : 'Aperto'}</span></span><small className={gh.projectItemDescription}>{project.shortDescription || 'Nessuna descrizione'}</small></span></Listbox.ItemText><Listbox.ItemIndicator><Check aria-hidden="true" size={14} /></Listbox.ItemIndicator></Listbox.Item>)}</Listbox.Content></Listbox.Root> : <EmptyState className={gh.projectListEmpty} description="Crea il primo Project per organizzare le attività del repository." eyebrow="Projects" icon={<FolderKanban size={26} />} title="Nessun Project collegato" />}
      {derived.selectedProjectDetails && <Collapsible.Root className={gh.projectManagement}>
        <Collapsible.Trigger className={gh.projectManagementTitle}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={14} /></Collapsible.Indicator><Settings2 aria-hidden="true" size={14} /> Gestisci Project</Collapsible.Trigger>
        <Collapsible.Content className={gh.projectManagementContent}>
        {state.editingProject?.number === derived.selectedProjectDetails.number ? <><Field.Root><Field.Input aria-label="Titolo Project" value={state.projectEditTitle} maxLength={256} onChange={(event) => state.setProjectEditTitle(event.target.value)} /></Field.Root><Field.Root><Field.Textarea aria-label="Descrizione Project" value={state.projectEditDescription} maxLength={1_024} onChange={(event) => state.setProjectEditDescription(event.target.value)} /></Field.Root><div className={gh.projectManagementActions}><Button size="sm" disabled={state.busy || !state.projectEditTitle.trim()} onClick={actions.requestProjectEdit}>Salva</Button><Button size="sm" variant="outline" disabled={state.busy} onClick={() => state.setEditingProject(null)}>Annulla</Button></div></> : <div className={gh.projectManagementActions}><Button size="sm" variant="outline" disabled={state.busy} onClick={() => actions.startProjectEdit(derived.selectedProjectDetails!)}>Modifica informazioni</Button><Button size="sm" tone={derived.selectedProjectDetails.closed ? 'accent' : 'danger'} variant="outline" disabled={state.busy} onClick={() => actions.requestProjectClose(derived.selectedProjectDetails!)}>{derived.selectedProjectDetails.closed ? 'Riapri Project' : 'Chiudi Project'}</Button></div>}
        </Collapsible.Content>
      </Collapsible.Root>}
    </>}
    </div>
  </section></Splitter.Panel>
}
