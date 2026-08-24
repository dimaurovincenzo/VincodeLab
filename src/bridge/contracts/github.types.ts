import type { GitBranchPage, GitStatus } from './git.types'

export interface CacheMetadata {
  fetchedAt: number
  expiresAt: number
  stale: boolean
  refreshError?: boolean
}

export interface CachedResult<Value> {
  data: Value
  cache: CacheMetadata
}

export type CacheReadOptions = { force?: boolean }

export interface GitHubIssue {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  author: { login: string } | null
  createdAt: string
  updatedAt: string
  url: string
  labels: { name: string }[]
  bodyTruncated?: boolean
  labelsHasMore?: boolean
}

export interface GitHubProject {
  id: string
  number: number
  title: string
  shortDescription: string
  closed: boolean
  url: string
}

export interface GitHubProjectBoard {
  project: GitHubProject
  fields: GitHubProjectField[]
  fieldsHasMore: boolean
  fieldsTruncated: boolean
  fieldOptionsTruncated: boolean
  fieldsResultBytes: number
  items: GitHubProjectItem[]
  itemsHasMore: boolean
  itemsTruncated: boolean
  itemValuesTruncated: boolean
  itemsResultBytes: number
  hasMore: boolean
  truncated: boolean
}

export interface GitHubProjectField {
  id: string
  name: string
  dataType: string
  options?: Array<{ id: string; name: string; color?: string }>
  optionsHasMore?: boolean
}

export interface GitHubProjectItem {
  id: string
  type: string
  title?: string
  content?: { title?: string; url?: string; number?: number; repository?: string }
  parent?: { title: string; url: string; number: number; repository?: string }
  assignees?: string[]
  fieldValues?: Record<string, string>
  status?: string
  valuesTruncated?: boolean
  [key: string]: unknown
}

export type GitHubProjectItemUpdate =
  | { type: 'singleSelect'; optionId: string }
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'date'; value: string }
  | { type: 'clear' }

export interface GitHubData {
  repository: { nameWithOwner: string; url: string; owner: string } | null
  issues: GitHubIssue[]
  issuesHasMore: boolean
  issuesTruncated: boolean
  issuesResultBytes?: number
  projects: GitHubProject[]
  projectsHasMore: boolean
  projectsTruncated: boolean
  hasMore: boolean
  truncated: boolean
  githubDiagnostic: string | null
  projectsDiagnostic: string | null
}

export type GitHubApi = {
  gitStatus: (options?: CacheReadOptions) => Promise<CachedResult<GitStatus>>
  initRepository: () => Promise<GitStatus>
  addRemote: (remoteUrl: string) => Promise<GitStatus>
  createRepository: (repositoryName: string, visibility: 'private' | 'public') => Promise<GitStatus>
  stage: (filePaths: string[]) => Promise<GitStatus>
  unstage: (filePaths: string[]) => Promise<GitStatus>
  commit: (message: string) => Promise<GitStatus>
  push: () => Promise<GitStatus>
  fetch: () => Promise<GitStatus>
  pullRebase: () => Promise<GitStatus>
  branches: () => Promise<GitBranchPage>
  switchBranch: (branchName: string) => Promise<GitStatus>
  createBranch: (branchName: string) => Promise<GitStatus>
  fileDiff: (filePath: string) => Promise<string>
  revert: (sha: string) => Promise<GitStatus>
  data: (options?: CacheReadOptions) => Promise<CachedResult<GitHubData>>
  createIssue: (title: string, body: string) => Promise<GitHubData>
  updateIssue: (issueNumber: number, title: string, body: string, state: 'OPEN' | 'CLOSED') => Promise<GitHubData>
  projectBoard: (projectNumber: number, options?: CacheReadOptions) => Promise<CachedResult<GitHubProjectBoard>>
  createProject: (title: string) => Promise<GitHubProject[]>
  editProject: (projectNumber: number, title: string, description: string) => Promise<GitHubProject[]>
  closeProject: (projectNumber: number, undo: boolean) => Promise<GitHubProject[]>
  addIssueToProject: (projectNumber: number, issueUrl: string) => Promise<GitHubProjectBoard>
  updateProjectItem: (projectNumber: number, itemId: string, fieldId: string, update: GitHubProjectItemUpdate) => Promise<GitHubProjectBoard>
  projectItemFields: (projectNumber: number, itemId: string) => Promise<Record<string, string>>
  createProjectDraft: (projectNumber: number, title: string, body: string) => Promise<GitHubProjectBoard>
  archiveProjectItem: (projectNumber: number, itemId: string, undo: boolean) => Promise<GitHubProjectBoard>
}
