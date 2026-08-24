import { Check, ChevronRight, CircleDot, Search } from 'lucide-react'
import { Button, Field, SelectField, Tabs } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { formatDate } from '../model/github-display'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubDataState, GitHubErrorNotice, LimitNotice } from './github-feedback'
import { GitHubIssueDialogs } from './github-issue-dialogs'

export function GitHubIssuesPanel({ controller }: { controller: GitHubWorkspaceController }) {
  const { derived, errors, recoveries, state } = controller
  const { issueComposerTrigger, issueDetailTrigger } = controller.elements

  return <Tabs.Content value="issues" className={cx(gh.content, gh.issuesContent)}>
    {state.data && <GitHubErrorNotice error={errors.surfaceErrors['github-data']} label="Aggiorna dati GitHub" onClick={() => recoveries.refreshGitHubAfterFailure('github-data')} />}
    {!state.data ? <GitHubDataState busy={state.busy} error={errors.surfaceErrors['github-data']} onRefresh={() => void controller.dataController.refreshGitHub(true)} /> : state.data.githubDiagnostic ? <section className={gh.panel}><GitHubErrorNotice error={errors.surfaceErrors['github-diagnostic']} label="Aggiorna dati GitHub" onClick={() => recoveries.refreshGitHubAfterFailure('github-diagnostic')} /></section> : <>
      <section className={gh.issueListPanel}>
        <header className={gh.issueListHeader}><div><h2 className={cx(gh.panelTitle, gh.issueListTitle)}>Issue <span className={gh.panelTitleCount}>{state.data.issues.length}</span></h2><p className={gh.muted}>Attività collegate al repository del workspace.</p></div><Button ref={issueComposerTrigger} onClick={() => state.setIssueComposerOpen(true)}>Nuova issue</Button></header>
        {derived.issuesLimited && <LimitNotice className={gh.limitNoticeSection}>Elenco issue limitato alle prime {state.data.issues.length} attività disponibili.</LimitNotice>}
        <div className={gh.issueToolbar}>
          <div className={gh.searchField}><Search aria-hidden="true" className={gh.searchIcon} size={14} /><Field.Root className={gh.searchFieldRoot}><Field.Input className={gh.searchInput} aria-label="Cerca issue per numero, titolo o etichetta" value={state.issueSearch} onChange={(event) => state.setIssueSearch(event.target.value)} placeholder="Cerca per numero, titolo o etichetta" type="search" /></Field.Root></div>
          <div className={gh.toolbarSelect}><SelectField aria-label="Filtra issue per stato" options={[{ label: `Aperte (${derived.issueCounts.OPEN ?? 0})`, value: 'OPEN' }, { label: `Chiuse (${derived.issueCounts.CLOSED ?? 0})`, value: 'CLOSED' }, { label: `Tutte (${state.data.issues.length})`, value: 'all' }]} value={state.issueStateFilter} onValueChange={(value) => state.setIssueStateFilter(value as 'all' | 'OPEN' | 'CLOSED')} /></div>
          <span className={gh.toolbarResult}>{derived.visibleIssues.length} risultati</span>
        </div>
        <div className={gh.issueList}>{derived.visibleIssues.length ? derived.visibleIssues.map((issue) => <article className={gh.issue} key={issue.number}><Button variant="plain" aria-haspopup="dialog" className={gh.issueSummary} onClick={(event) => { issueDetailTrigger.current = event.currentTarget; state.setSelectedIssue(issue); state.setIssueDetailOpen(true) }}><ChevronRight className={gh.issueChevron} /><span className={gh.issueState({ state: issue.state.toLowerCase() as 'open' | 'closed' })}><Check size={12} /></span><span className={gh.issueNumber}>#{issue.number}</span><span className={gh.issueTitle}><strong className={gh.issueTitleText}>{issue.title}</strong>{issue.labels.length > 0 && <span className={gh.issueLabels}>{issue.labels.slice(0, 3).map((label) => <small className={gh.issueLabel} key={label.name}>{label.name}</small>)}{issue.labelsHasMore && <small className={gh.issueLabelOverflow}>altre etichette…</small>}</span>}</span><small className={gh.issueMeta}>{issue.author?.login ?? 'autore sconosciuto'} · {formatDate(issue.updatedAt)}</small></Button></article>) : <EmptyState className={gh.issueEmpty} description={state.data.issues.length > 0 ? 'Modifica la ricerca o il filtro per vedere altre issue.' : 'Crea la prima issue per tenere traccia del lavoro del repository.'} eyebrow="Issue" icon={<CircleDot size={26} />} title={state.data.issues.length > 0 ? 'Nessun risultato' : 'Nessuna issue'} />}</div>
      </section>
      <GitHubIssueDialogs controller={controller} />
    </>}
  </Tabs.Content>
}
