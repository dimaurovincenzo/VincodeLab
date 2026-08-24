import { Splitter, Tabs, type SplitterPanelData } from '@/components/ui'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubDataState, GitHubErrorNotice } from './github-feedback'
import { GitHubProjectBoard } from './github-project-board'
import { GitHubProjectPicker } from './github-project-picker'

const githubProjectPanels: SplitterPanelData[] = [
  { id: 'github-project-picker', minSize: '280px', maxSize: '720px', collapsible: true, collapsedSize: '240px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'github-project-board', minSize: '560px' },
]

export function GitHubProjectsPanel({ controller, workspace }: { controller: GitHubWorkspaceController; workspace: string }) {
  const { errors, recoveries, state } = controller

  return <Tabs.Content value="projects" className={gh.projectTabContent}>
    {state.data && <GitHubErrorNotice error={errors.surfaceErrors['github-data']} label="Aggiorna dati GitHub" onClick={() => recoveries.refreshGitHubAfterFailure('github-data')} />}
    {!state.data ? <GitHubDataState busy={state.busy} error={errors.surfaceErrors['github-data']} onRefresh={() => void controller.dataController.refreshGitHub(true)} /> : <Splitter.Root className={cx(gh.content, gh.projectContent)} defaultFixedSize={controller.projectSelectorWidth} onCollapse={({ panelId }) => { if (panelId === 'github-project-picker') state.setProjectPickerCollapsed(true) }} onExpand={({ panelId }) => { if (panelId === 'github-project-picker') state.setProjectPickerCollapsed(false) }} panels={githubProjectPanels} storageKey={`vincodelab.github.project-picker-width:${workspace}`}>
      <GitHubProjectPicker controller={controller} />
      {!state.projectPickerCollapsed && <Splitter.ResizeTrigger aria-label="Ridimensiona selettore Project GitHub" className={gh.projectResize} id="github-project-picker:github-project-board" title="Trascina per ridimensionare il selettore Project. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>}
      <GitHubProjectBoard controller={controller} />
    </Splitter.Root>}
  </Tabs.Content>
}
