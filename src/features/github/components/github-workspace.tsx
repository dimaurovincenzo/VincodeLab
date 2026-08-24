import { GitFork } from 'lucide-react'
import { Button, ErrorNotice, Spinner, Tabs } from '@/components/ui'
import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { githubStyles as gh } from '@/theme/styles/github'
import { useGitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import type { GitHubTab, GitHubWorkspaceProps } from '../model/github-workspace.types'
import { GitHubChangesPanel } from './github-changes-panel'
import { GitHubErrorNotice } from './github-feedback'
import { GitHubGraphPanel } from './github-graph-panel'
import { GitHubHeader } from './github-header'
import { GitHubIssuesPanel } from './github-issues-panel'
import { GitHubProjectsPanel } from './github-projects-panel'

export function GitHubWorkspace(props: GitHubWorkspaceProps) {
  const controller = useGitHubWorkspaceController(props)
  const { errors, recoveries, state } = controller

  if (state.loading && !state.status) return <div className={gh.loading} role="status"><Spinner /> Caricamento repository…</div>
  if (errors.gitStatusError && !state.status?.isRepository) return <div className={gh.empty}><ErrorNotice action={{ label: 'Riprova', pendingLabel: 'Verifica stato Git…', onClick: controller.dataController.retryGitStatus }} error={errors.gitStatusError} /><ConfirmationDialog request={state.confirmation} onCancel={() => state.setConfirmation(null)} /></div>
  if (!state.status?.isRepository) return <div className={gh.empty}><GitFork size={30} /><h2 className={gh.emptyTitle}>Nessun repository Git</h2><p className={gh.emptyDescription}>Questo workspace non è ancora sotto controllo versione. Inizializzalo qui per usare commit, branch e GitHub.</p><Button disabled={state.busy} onClick={controller.actions.initializeRepository}><GitFork /> Inizializza repository</Button><GitHubErrorNotice error={errors.surfaceErrors['git-changes']} label="Verifica stato Git" onClick={() => recoveries.refreshGitAfterFailure('git-changes')} /><ConfirmationDialog request={state.confirmation} onCancel={() => state.setConfirmation(null)} /></div>

  return <Tabs.Root asChild value={state.tab} onValueChange={({ value }) => state.setTab(value as GitHubTab)}><div className={gh.workspace}>
    <GitHubHeader controller={controller} />
    <Tabs.List className={gh.tabsList} aria-label="Sezioni GitHub">
      <Tabs.Trigger value="changes">Modifiche <span className={gh.tabCount}>{state.status.files.length}</span></Tabs.Trigger>
      <Tabs.Trigger value="graph">Grafo <span className={gh.tabCount}>{state.status.graph.length}</span></Tabs.Trigger>
      <Tabs.Trigger value="issues">Issue</Tabs.Trigger>
      <Tabs.Trigger value="projects">Progetti</Tabs.Trigger>
      <Tabs.Indicator />
    </Tabs.List>
    {errors.gitStatusError && <ErrorNotice action={{ label: 'Riprova', pendingLabel: 'Verifica stato Git…', onClick: controller.dataController.retryGitStatus }} error={errors.gitStatusError} />}
    <GitHubChangesPanel controller={controller} />
    <GitHubGraphPanel controller={controller} />
    <GitHubIssuesPanel controller={controller} />
    <GitHubProjectsPanel controller={controller} workspace={props.workspace} />
    <ConfirmationDialog request={state.confirmation} onCancel={() => state.setConfirmation(null)} />
  </div></Tabs.Root>
}
