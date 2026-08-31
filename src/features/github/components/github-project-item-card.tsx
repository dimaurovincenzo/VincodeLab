import { ChevronRight, GitBranch } from 'lucide-react'
import { Button, Collapsible, SelectField } from '@/components/ui'
import type { GitHubProjectField, GitHubProjectItem } from '@/bridge'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { projectFieldName, projectItemTypeLabel } from '../model/github-projects'
import { projectStatusClass } from './github-project-status'

function projectItemFieldValue(item: GitHubProjectItem, field: GitHubProjectField) {
  const name = projectFieldName(field)
  if (name === 'title' || name === 'titolo') return item.content?.title ?? item.title ?? ''
  if (name === 'assignees' || name === 'assegnatari') return item.assignees?.join(', ') ?? ''
  if (name === 'status' || name === 'stato') return item.status ?? ''
  return item.fieldValues?.[field.id] ?? ''
}

export function GitHubProjectItemCard({ controller, depth, item }: { controller: GitHubWorkspaceController; depth: number; item: GitHubProjectItem }) {
  const { actions, derived, state } = controller
  const title = item.content?.title ?? item.title ?? 'Elemento senza titolo'
  const fields = state.board?.fields ?? []
  const detailFields = fields.filter((field) => !['title', 'titolo'].includes(projectFieldName(field)))
  const highlights = detailFields.filter((field) => {
    const name = projectFieldName(field)
    return !['assignees', 'assegnatari', 'status', 'stato'].includes(name) && projectItemFieldValue(item, field)
  }).slice(0, 3)

  return <Collapsible.Root className={gh.projectCard} data-subissue={depth > 0 ? 'true' : undefined} role="listitem">
    <div className={gh.projectCardMain}>
      <Button variant="plain" className={gh.projectCardTitle} onClick={(event) => void actions.selectBoardItem(item, event.currentTarget)} title={title}>
        <span className={gh.projectCardNumber}>{item.content?.number ? `#${item.content.number}` : projectItemTypeLabel(item)}</span>
        <strong className={gh.projectCardTitleText}>{depth > 0 && <GitBranch aria-hidden="true" size={14} />}{title}</strong>
        {item.parent && <small className={gh.projectCardParent}>Sub-issue di #{item.parent.number}</small>}
      </Button>
      <div className={gh.projectCardStatusArea}>
        {derived.boardStatusField?.options?.length ? <div className={gh.projectCardStatus}><SelectField aria-label={`Stato ${title}`} placeholder="Senza stato" options={derived.boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={derived.boardStatusField.options.find((option) => option.name === item.status)?.id ?? ''} disabled={state.busy} onValueChange={(value) => { if (value) void actions.updateBoardStatus(item, value) }} /></div> : <span className={projectStatusClass(item.status)}>{item.status || 'Senza stato'}</span>}
      </div>
      <div className={gh.projectCardSummary}>
        <span className={gh.projectAssigneeGroup}><small>Assegnatari</small><span className={gh.projectAssignees} title={item.assignees?.join(', ') ?? 'Non assegnata'}>{item.assignees?.length ? <>{item.assignees.slice(0, 3).map((assignee) => <span className={gh.projectAssignee} key={assignee}>{assignee.slice(0, 2).toUpperCase()}</span>)}{item.assignees.length > 3 && <small className={gh.projectAssigneeOverflow}>+{item.assignees.length - 3}</small>}</> : <span className={gh.projectCardMuted}>Non assegnata</span>}</span></span>
        {highlights.map((field) => <span className={gh.projectCardHighlight} key={field.id}><small>{field.name}</small><strong>{projectItemFieldValue(item, field)}</strong></span>)}
      </div>
      <Collapsible.Trigger className={gh.projectCardToggle} aria-label={`Mostra o nascondi tutti i campi di ${title}`}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={16} /></Collapsible.Indicator></Collapsible.Trigger>
    </div>
    <Collapsible.Content className={gh.projectCardDetails}>
      <div className={gh.projectFieldGrid}>
        {detailFields.map((field) => <div className={gh.projectField} key={field.id}><span>{field.name}</span><strong className={cx(!projectItemFieldValue(item, field) && gh.projectFieldEmpty)}>{projectItemFieldValue(item, field) || 'Non impostato'}</strong></div>)}
      </div>
      <Button size="xs" variant="outline" className={gh.projectCardDetailsAction} onClick={(event) => void actions.selectBoardItem(item, event.currentTarget)}>Apri e modifica dettagli</Button>
    </Collapsible.Content>
  </Collapsible.Root>
}
