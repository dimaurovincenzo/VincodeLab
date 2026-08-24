export type GitHubIssueStateFilter = 'all' | GitHubIssue['state']

export function matchesIssueSearch(issue: GitHubIssue, query: string) {
  const normalized = query.trim().toLocaleLowerCase('it-IT')
  const numeric = normalized.match(/^#?(\d+)$/)?.[1]
  if (numeric) return issue.number === Number(numeric)
  return !normalized || [issue.title, issue.body ?? '', ...issue.labels.map((label) => label.name)]
    .some((value) => value.toLocaleLowerCase('it-IT').includes(normalized))
}

export function issueStateCounts(issues: GitHubIssue[]) {
  return issues.reduce((counts, issue) => ({
    ...counts,
    [issue.state]: (counts[issue.state] ?? 0) + 1,
  }), {} as Record<GitHubIssue['state'], number>)
}

export function visibleGitHubIssues(issues: GitHubIssue[], query: string, stateFilter: GitHubIssueStateFilter) {
  return issues.filter((issue) => matchesIssueSearch(issue, query)
    && (stateFilter === 'all' || issue.state === stateFilter))
}
