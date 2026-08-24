import { ChevronRight, FolderKanban, GitBranch, Search } from 'lucide-react'
import { Button, Collapsible, Field, SelectField, Spinner, Splitter } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { orderProjectItemsByHierarchy, projectFieldDataType } from '../model/github-projects'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'
import { GitHubProjectItemDialog } from './github-project-item-dialog'
import { projectStatusClass } from './github-project-status'

export function GitHubProjectBoard({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, derived, errors, recoveries, state } = controller
  const { boardSearchInput } = controller.elements
  const boardTitle = state.board?.project.title ?? 'Board del Project'

  return <Splitter.Panel asChild id="github-project-board"><section aria-busy={state.loadingBoard} className={cx(gh.panel, gh.board)}>
    {state.loadingBoard && <div aria-live="polite" className={gh.boardLoading} role="status"><Spinner className={gh.boardLoadingIcon} /><strong className={gh.boardLoadingTitle}>Caricamento Project…</strong><span className={gh.boardLoadingDescription}>Sto recuperando le attività e i relativi campi da GitHub.</span></div>}
    <GitHubErrorNotice error={errors.surfaceErrors.board} label="Ricarica board" onClick={recoveries.retrySelectedBoard} />
    {!state.board && <h2 className={gh.panelTitle}>{boardTitle}</h2>}
    {state.board ? <>
      <header className={gh.boardHeader}>
        <div className={gh.boardIdentity}><span className={gh.boardEyebrow}>Project attivo</span><h2 className={gh.boardTitle}>{boardTitle}</h2></div>
        <div className={gh.boardSummary}><strong className={gh.boardTotal}>{state.board.items.length}</strong><span className={gh.boardSummaryLabel}>{derived.boardResultLimited ? 'attività visibili' : 'attività caricate'}</span><div className={gh.boardStatuses}>{[...derived.boardStatusCounts.entries()].map(([statusName, count]) => <small className={projectStatusClass(statusName)} key={statusName}>{statusName}: {count}</small>)}</div></div>
      </header>
      {derived.boardLimitMessages.length > 0 && <LimitNotice className={gh.boardLimitNotice}>{derived.boardLimitMessages.join(' ')}</LimitNotice>}
      <div aria-label="Filtri della board" className={gh.boardToolbar} role="group">
        <div className={gh.searchField}><Search aria-hidden="true" className={gh.searchIcon} size={14} /><Field.Root className={gh.searchFieldRoot}><Field.Input ref={boardSearchInput} className={gh.searchInput} aria-label="Cerca attività per numero, titolo o campo" value={state.boardSearch} placeholder="Cerca per numero, titolo o campo" onChange={(event) => state.setBoardSearch(event.target.value)} /></Field.Root></div>
        <div className={gh.toolbarSelect}><SelectField aria-label="Raggruppa per" options={[{ label: 'Nessun raggruppamento', value: '__none__' }, ...(state.board.fields.filter((field) => projectFieldDataType(field) !== 'title').map((field) => ({ label: `Raggruppa per ${field.name}`, value: field.id })) ?? [])]} value={state.boardGroupFieldId || derived.activeBoardGroupFieldId} onValueChange={state.setBoardGroupFieldId} /></div>
        <div className={gh.toolbarSelect}><SelectField aria-label="Filtra attività per stato" options={[{ label: 'Tutti gli stati', value: '__all__' }, ...(derived.boardStatusField?.options?.map((option) => ({ label: option.name, value: option.name })) ?? [])]} value={state.boardStatusFilter || '__all__'} onValueChange={(value) => state.setBoardStatusFilter(value === '__all__' ? '' : value)} /></div>
        <span className={gh.boardResult}>{derived.boardHasFilters ? `${derived.boardItems.length} risultati` : `${derived.boardItems.length} visibili`}</span>
      </div>
      <div className={gh.projectTable} role="table" aria-colcount={derived.boardPriorityField ? 4 : 3} aria-label="Attività del Project">
        <div role="rowgroup"><div className={cx(gh.projectTableHead, !derived.boardPriorityField && gh.projectTableHeadThree)} role="row"><span className={gh.tableHeaderCell} role="columnheader">Titolo</span><span className={gh.tableHeaderCell} role="columnheader">Assegnatari</span><span className={gh.tableHeaderCell} role="columnheader">Stato</span>{derived.boardPriorityField && <span className={gh.tableHeaderCell} role="columnheader">Priorità</span>}</div></div>
        {derived.boardItems.length ? [...derived.boardGroups.entries()].map(([group, items]) => {
          const collapsed = state.collapsedBoardGroups.has(group)
          return <Collapsible.Root asChild key={group} open={!collapsed} onOpenChange={({ open }) => state.setCollapsedBoardGroups((current) => { const next = new Set(current); if (open) next.delete(group); else next.add(group); return next })}>
            <section className={gh.projectGroup} role="rowgroup">
              <div className={gh.projectGroupHeadingRow} role="row"><div aria-colspan={derived.boardPriorityField ? 4 : 3} className={gh.projectGroupHeadingCell} role="cell"><h3 className={gh.projectGroupHeading}><Collapsible.Trigger className={gh.projectGroupTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={15} /></Collapsible.Indicator><span className={gh.projectGroupLabel}>{derived.activeBoardGroupField?.name || 'Gruppo'}:</span> <strong className={gh.projectGroupTitle}>{group}</strong> <small className={gh.projectGroupCount}>{items.length} attività</small></Collapsible.Trigger></h3></div></div>
              <Collapsible.Content role="presentation">{orderProjectItemsByHierarchy(items).map(({ item, depth }) => <div className={gh.projectTableRow({ columns: derived.boardPriorityField ? 'four' : 'three', selected: derived.selectedBoardItem?.id === item.id, subissue: depth > 0 })} key={item.id} role="row">
                <span className={gh.projectTitleCell} role="cell"><Button variant="plain" className={gh.projectTitle({ subissue: depth > 0 })} onClick={(event) => void actions.selectBoardItem(item, event.currentTarget)} title={item.content?.title ?? item.title ?? 'Elemento senza titolo'}><strong className={gh.projectTitleText}>{depth > 0 && <GitBranch aria-hidden="true" className={gh.projectTitleIcon} size={14} />}{item.content?.title ?? item.title ?? 'Elemento senza titolo'}</strong>{item.parent && <small className={gh.projectTitleMeta}>Sub-issue di #{item.parent.number}</small>}{item.content?.number && <small className={gh.projectTitleMeta}>#{item.content.number}</small>}</Button></span>
                <span className={cx(gh.projectCell, gh.projectAssignees)} role="cell" title={item.assignees?.join(', ') ?? ''}>{item.assignees?.length ? <>{item.assignees.slice(0, 2).map((assignee) => <span className={gh.projectAssignee} key={assignee}>{assignee.slice(0, 2).toUpperCase()}</span>)}{item.assignees.length > 2 && <small className={gh.projectAssigneeOverflow}>+{item.assignees.length - 2}</small>}</> : '—'}</span>
                <span className={cx(gh.projectCell, gh.projectStatusCell)} role="cell">{derived.boardStatusField?.options?.length ? <SelectField aria-label={`Stato ${item.content?.title ?? item.title ?? 'attività'}`} placeholder="Non impostato" options={derived.boardStatusField.options.map((option) => ({ label: option.name, value: option.id }))} value={derived.boardStatusField.options.find((option) => option.name === item.status)?.id ?? ''} disabled={state.busy} onValueChange={(value) => { if (value) void actions.updateBoardStatus(item, value) }} /> : <span className={projectStatusClass(item.status)}>{item.status || '—'}</span>}</span>
                {derived.boardPriorityField && <span className={gh.projectCell} role="cell">{item.fieldValues?.[derived.boardPriorityField.id] ?? '—'}</span>}
              </div>)}</Collapsible.Content>
            </section>
          </Collapsible.Root>
        }) : <div role="rowgroup"><div role="row"><div aria-colspan={derived.boardPriorityField ? 4 : 3} className={gh.boardEmpty} role="cell"><EmptyState className={gh.boardEmptyState} description={derived.boardHasFilters ? 'Modifica la ricerca o il filtro per vedere altre attività.' : 'Il Project non contiene ancora attività.'} eyebrow="Board" icon={<FolderKanban size={26} />} title={derived.boardHasFilters ? 'Nessun risultato' : 'Nessuna attività'} /></div></div></div>}
      </div>
      <GitHubProjectItemDialog controller={controller} />
    </> : <EmptyState className={gh.boardPlaceholder} description="Scegli un Project collegato per gestirne la board." eyebrow="Board" icon={<FolderKanban size={26} />} title="Seleziona un Project" />}
  </section></Splitter.Panel>
}
