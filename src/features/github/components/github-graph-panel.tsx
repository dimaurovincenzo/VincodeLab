import { GitFork } from 'lucide-react'
import { Tabs } from '@/components/ui'
import { gitGraphNodeStyles, gitGraphPathStyles, githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { LimitNotice } from './github-feedback'

const GIT_GRAPH_LANE_COUNT = 6
const GIT_GRAPH_ROW_HEIGHT = 40

function gitGraphPathClass(lane: number) {
  return gitGraphPathStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function gitGraphNodeClass(lane: number) {
  return gitGraphNodeStyles[lane % GIT_GRAPH_LANE_COUNT]
}

export function GitHubGraphPanel({ controller }: { controller: GitHubWorkspaceController }) {
  const { derived, state } = controller
  const status = state.status
  if (!status) return null

  return <Tabs.Content value="graph" className={cx(gh.content, gh.graphContent)}><section className={cx(gh.panel, gh.graphPanel)}><h2 className={gh.panelTitle}><GitFork size={15} /> Grafo Git <span className={gh.panelTitleCount}>{status.graph.length}</span></h2><p className={gh.muted}>Cronologia dei branch e dei merge del workspace aperto.</p>{derived.graphLimited && <LimitNotice>Grafo limitato ai primi {status.graph.length} commit disponibili.</LimitNotice>}{derived.graphRows.length ? <div className={gh.graphList}>{derived.graphRows.map((row) => { const width = row.laneCount * 16 + 4; const point = 10 + row.lane * 16; return <div className={gh.graphRow} key={row.commit.sha}><svg aria-hidden="true" className={gh.graphVisual} height={GIT_GRAPH_ROW_HEIGHT} viewBox={`0 0 ${width} ${GIT_GRAPH_ROW_HEIGHT}`} width={width}>{row.links.map((link, index) => <path className={gitGraphPathClass(link.from)} d={`M${10 + link.from * 16} 0 L${10 + link.to * 16} ${GIT_GRAPH_ROW_HEIGHT}`} key={`${link.from}-${link.to}-${index}`} />)}<circle className={gitGraphNodeClass(row.lane)} cx={point} cy="10" r="5" /></svg><div className={gh.graphCommit}><strong className={gh.graphSubject}>{row.commit.subject}</strong><small className={gh.graphMeta}>{row.commit.sha.slice(0, 7)}{row.commit.refs.length ? ` · ${row.commit.refs.join(', ')}` : ''}</small></div></div> })}</div> : <p className={gh.muted}>Nessun commit da visualizzare.</p>}</section></Tabs.Content>
}
