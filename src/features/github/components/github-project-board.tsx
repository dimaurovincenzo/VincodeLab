import { ChevronRight, FilterX, FolderKanban, Search } from 'lucide-react'
import { Button, Collapsible, Field, SelectField, Spinner, Splitter } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { orderProjectItemsByHierarchy, projectFieldDataType } from '../model/github-projects'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'
import { GitHubProjectItemComposer } from './github-project-item-composer'
import { GitHubProjectItemDialog } from './github-project-item-dialog'
import { GitHubProjectItemCard } from './github-project-item-card'
import { projectStatusClass } from './github-project-status'

export function GitHubProjectBoard({ controller }: { controller: GitHubWorkspaceController }) {
  const { derived, errors, recoveries, state } = controller
  const { boardSearchInput } = controller.elements
  const boardTitle = state.board?.project.title ?? 'Board del Project'

  return <Splitter.Panel asChild id="github-project-board"><section aria-busy={state.loadingBoard} className={cx(gh.panel, gh.board)}>
    {state.loadingBoard && <div aria-live="polite" className={gh.boardLoading} role="status"><Spinner className={gh.boardLoadingIcon} /><strong className={gh.boardLoadingTitle}>Caricamento Project…</strong><span className={gh.boardLoadingDescription}>Sto recuperando le attività e i relativi campi da GitHub.</span></div>}
    <GitHubErrorNotice error={errors.surfaceErrors.board} label="Ricarica board" onClick={recoveries.retrySelectedBoard} />
    {!state.board && <h2 className={gh.panelTitle}>{boardTitle}</h2>}
    {state.board ? <>
      <header className={gh.boardHeader}>
        <div className={gh.boardIdentity}><span className={gh.boardEyebrow}>Project attivo</span><h2 className={gh.boardTitle}>{boardTitle}</h2></div>
        <div className={gh.boardHeaderAside}>
          <div className={gh.boardSummary}><strong className={gh.boardTotal}>{state.board.items.length}</strong><span className={gh.boardSummaryLabel}>{derived.boardResultLimited ? 'attività visibili' : 'attività caricate'}</span><div className={gh.boardStatuses}>{[...derived.boardStatusCounts.entries()].map(([statusName, count]) => <Button aria-pressed={state.boardStatusFilter === statusName} aria-label={`Filtra per ${statusName}: ${count}`} className={gh.boardStatusFilter} key={statusName} size="xs" variant="plain" onClick={() => state.setBoardStatusFilter((current) => current === statusName ? '' : statusName)}><span className={projectStatusClass(statusName)}>{statusName}: {count}</span></Button>)}</div></div>
          <GitHubProjectItemComposer controller={controller} />
        </div>
      </header>
      {derived.boardLimitMessages.length > 0 && <LimitNotice className={gh.boardLimitNotice}>{derived.boardLimitMessages.join(' ')}</LimitNotice>}
      <div aria-label="Filtri della board" className={gh.boardToolbar} role="group">
        <div className={gh.searchField}><Search aria-hidden="true" className={gh.searchIcon} size={14} /><Field.Root className={gh.searchFieldRoot}><Field.Input ref={boardSearchInput} className={gh.searchInput} aria-label="Cerca attività per numero, titolo o campo" value={state.boardSearch} placeholder="Cerca per numero, titolo o campo" onChange={(event) => state.setBoardSearch(event.target.value)} /></Field.Root></div>
        <div className={gh.toolbarSelect}><SelectField aria-label="Raggruppa per" options={[{ label: 'Nessun raggruppamento', value: '__none__' }, ...(state.board.fields.filter((field) => projectFieldDataType(field) !== 'title').map((field) => ({ label: `Raggruppa per ${field.name}`, value: field.id })) ?? [])]} value={state.boardGroupFieldId || derived.activeBoardGroupFieldId} onValueChange={state.setBoardGroupFieldId} /></div>
        <div className={gh.toolbarSelect}><SelectField aria-label="Filtra attività per stato" options={[{ label: 'Tutti gli stati', value: '__all__' }, ...(derived.boardStatusField?.options?.map((option) => ({ label: option.name, value: option.name })) ?? [])]} value={state.boardStatusFilter || '__all__'} onValueChange={(value) => state.setBoardStatusFilter(value === '__all__' ? '' : value)} /></div>
        <span className={gh.boardResult}>{derived.boardHasFilters ? `${derived.boardItems.length} risultati` : `${derived.boardItems.length} visibili`}</span>
        {derived.boardHasFilters && <Button className={gh.boardFilterClear} size="xs" variant="plain" onClick={() => { state.setBoardSearch(''); state.setBoardStatusFilter(''); boardSearchInput.current?.focus() }}><FilterX aria-hidden="true" size={14} /> Azzera filtri</Button>}
      </div>
      <div className={gh.projectTable} role="list" aria-label="Attività del Project">
        {derived.boardItems.length ? [...derived.boardGroups.entries()].map(([group, items]) => {
          const collapsed = state.collapsedBoardGroups.has(group)
          return <Collapsible.Root asChild key={group} open={!collapsed} onOpenChange={({ open }) => state.setCollapsedBoardGroups((current) => { const next = new Set(current); if (open) next.delete(group); else next.add(group); return next })}>
            <section className={gh.projectGroup} role="listitem">
              <h3 className={gh.projectGroupHeading}><Collapsible.Trigger className={gh.projectGroupTrigger}><Collapsible.Indicator><ChevronRight aria-hidden="true" size={16} /></Collapsible.Indicator><FolderKanban aria-hidden="true" className={gh.projectGroupIcon} size={17} /><span className={gh.projectGroupIdentity}><span className={gh.projectGroupLabel}>Raggruppato per {derived.activeBoardGroupField?.name || 'gruppo'}</span><strong className={gh.projectGroupTitle}>{group}</strong></span><small className={gh.projectGroupCount}>{items.length === 1 ? '1 attività' : `${items.length} attività`}</small></Collapsible.Trigger></h3>
              <Collapsible.Content className={gh.projectGroupItems} role="list">{orderProjectItemsByHierarchy(items).map(({ item, depth }) => <GitHubProjectItemCard controller={controller} depth={depth} item={item} key={item.id} />)}</Collapsible.Content>
            </section>
          </Collapsible.Root>
        }) : <div className={gh.boardEmpty}><EmptyState action={derived.boardHasFilters ? <Button size="sm" variant="outline" onClick={() => { state.setBoardSearch(''); state.setBoardStatusFilter(''); boardSearchInput.current?.focus() }}>Azzera filtri</Button> : undefined} className={gh.boardEmptyState} description={derived.boardHasFilters ? 'Modifica la ricerca o il filtro per vedere altre attività.' : 'Il Project non contiene ancora attività. Aggiungi una issue o crea una bozza dal comando in alto.'} eyebrow="Board" icon={<FolderKanban size={26} />} title={derived.boardHasFilters ? 'Nessun risultato' : 'Nessuna attività'} /></div>}
      </div>
      <GitHubProjectItemDialog controller={controller} />
    </> : <EmptyState className={gh.boardPlaceholder} description="Scegli un Project collegato per gestirne la board." eyebrow="Board" icon={<FolderKanban size={26} />} title="Seleziona un Project" />}
  </section></Splitter.Panel>
}
