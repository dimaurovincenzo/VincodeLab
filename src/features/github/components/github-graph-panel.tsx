import { GitFork, UserRound } from 'lucide-react'
import { Tabs } from '@/components/ui'
import {
  gitGraphCardStyles,
  gitGraphNodeStyles,
  gitGraphPathStyles,
  githubStyles as gh,
} from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { formatRelativeDate } from '../model/github-display'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'

const GIT_GRAPH_LANE_COUNT = 6
const GIT_GRAPH_LANE_GAP = 26
const GIT_GRAPH_LANE_OFFSET = 20
const GIT_GRAPH_ROW_HEIGHT = 72
const GIT_GRAPH_ROW_CENTER = GIT_GRAPH_ROW_HEIGHT / 2

function gitGraphPathClass(lane: number) {
  return gitGraphPathStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function gitGraphNodeClass(lane: number) {
  return gitGraphNodeStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function gitGraphCardClass(lane: number) {
  return gitGraphCardStyles[lane % GIT_GRAPH_LANE_COUNT]
}

function lanePoint(lane: number) {
  return GIT_GRAPH_LANE_OFFSET + lane * GIT_GRAPH_LANE_GAP
}

function gitGraphLinkPath(link: { from: number; to: number }, commitLane: number) {
  const from = lanePoint(link.from)
  const to = lanePoint(link.to)
  const start = link.from === commitLane ? GIT_GRAPH_ROW_CENTER : 0
  const curve = Math.min(18, (GIT_GRAPH_ROW_HEIGHT - start) / 2)
  return `M${from} ${start} C${from} ${start + curve}, ${to} ${GIT_GRAPH_ROW_HEIGHT - curve}, ${to} ${GIT_GRAPH_ROW_HEIGHT}`
}

export function GitHubGraphPanel({ controller }: { controller: GitHubWorkspaceController }) {
  const { derived, state } = controller
  const status = state.status
  if (!status) return null

  const graphWidth = Math.max(
    124,
    Math.max(...derived.graphRows.map((row) => row.laneCount), 1) * GIT_GRAPH_LANE_GAP + GIT_GRAPH_LANE_OFFSET * 2,
  )
  const headSha = status.commits[0]?.sha

  return (
    <Tabs.Content value="graph" className={cx(gh.content, gh.graphContent)}>
      <section className={cx(gh.panel, gh.graphPanel)}>
        <header className={gh.graphHeader}>
          <h2 className={cx(gh.panelTitle, gh.graphTitle)}>
            <GitFork aria-hidden="true" size={15} />
            Grafo Git
            <span className={gh.panelTitleCount}>{status.graph.length}</span>
          </h2>
          <p className={gh.muted}>Cronologia dei branch e dei merge del workspace aperto.</p>
        </header>

        {derived.graphRows.length ? (
          <ol className={gh.graphList} aria-label="Cronologia Git">
            {derived.graphRows.map((row) => {
              const point = lanePoint(row.lane)
              const isHead = row.commit.sha === headSha
              const visibleRefs = row.commit.refs.slice(0, 3)

              return (
                <li className={gh.graphRow} key={row.commit.sha}>
                  <svg
                    aria-hidden="true"
                    className={gh.graphVisual}
                    height={GIT_GRAPH_ROW_HEIGHT}
                    viewBox={`0 0 ${graphWidth} ${GIT_GRAPH_ROW_HEIGHT}`}
                    width={graphWidth}
                  >
                    <path
                      className={gitGraphPathClass(row.lane)}
                      d={`M${point} 0 L${point} ${GIT_GRAPH_ROW_CENTER}`}
                    />
                    {row.links.map((link, index) => (
                      <path
                        className={gitGraphPathClass(link.from)}
                        d={gitGraphLinkPath(link, row.lane)}
                        key={`${link.from}-${link.to}-${index}`}
                      />
                    ))}
                    <circle className={gitGraphNodeClass(row.lane)} cx={point} cy={GIT_GRAPH_ROW_CENTER} r="5" />
                  </svg>

                  <article className={cx(gh.graphCommitCard, gitGraphCardClass(row.lane), isHead && gh.graphCommitCurrent)}>
                    <div className={gh.graphCommitTitle}>
                      <strong className={gh.graphSubject}>{row.commit.subject}</strong>
                      <code className={gh.graphSha}>{row.commit.sha.slice(0, 7)}</code>
                    </div>
                    <div className={gh.graphCommitMeta}>
                      <span className={gh.graphAuthor}>
                        <UserRound aria-hidden="true" size={13} />
                        {row.commit.author || 'Autore non disponibile'}
                      </span>
                      {visibleRefs.length > 0 && (
                        <span className={gh.graphRefs}>
                          {visibleRefs.map((ref) => <small className={gh.graphRef} key={ref}>{ref}</small>)}
                          {row.commit.refs.length > visibleRefs.length && <small className={gh.graphRef}>+{row.commit.refs.length - visibleRefs.length}</small>}
                        </span>
                      )}
                      {row.commit.date && <time className={gh.graphDate} dateTime={row.commit.date}>{formatRelativeDate(row.commit.date)}</time>}
                    </div>
                  </article>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className={cx(gh.muted, gh.graphEmpty)}>Nessun commit da visualizzare.</p>
        )}
      </section>
    </Tabs.Content>
  )
}
