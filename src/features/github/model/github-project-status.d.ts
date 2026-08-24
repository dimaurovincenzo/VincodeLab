export type GitHubProjectStatusTone = 'success' | 'info' | 'planned' | 'warning' | 'ready' | 'error' | 'inactive'

export function githubProjectStatusTone(status: unknown): GitHubProjectStatusTone
