import type { GitGraphCommit } from '@/bridge'

export interface GitGraphLink { from: number; to: number }

export interface GitGraphLayoutRow {
  commit: GitGraphCommit
  lane: number
  laneCount: number
  links: GitGraphLink[]
}

export function layoutGitGraph(commits: GitGraphCommit[]): GitGraphLayoutRow[]
