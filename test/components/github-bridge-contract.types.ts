import type { GitHubApi, VincodeLabBridge } from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

interface ExpectedGitFileStatus {
  path: string
  previousPath?: string
  index: string
  workingTree: string
  sensitive?: boolean
}
interface ExpectedGitCommit {
  sha: string
  subject: string
  author: string
  date: string
}
interface ExpectedGitGraphCommit {
  sha: string
  parents: string[]
  refs: string[]
  subject: string
  author?: string
  date?: string
}
interface ExpectedGitBranch {
  name: string
  current: boolean
}
interface ExpectedGitBranchPage {
  branches: ExpectedGitBranch[]
  hasMore: boolean
  truncated: boolean
}
interface ExpectedGitStatus {
  isRepository: boolean
  branch?: string
  remote?: string | null
  upstream?: string | null
  ahead?: number
  behind?: number
  files: ExpectedGitFileStatus[]
  commits: ExpectedGitCommit[]
  graph: ExpectedGitGraphCommit[]
  filesHasMore: boolean
  filesTruncated: boolean
  graphHasMore: boolean
  graphTruncated: boolean
  hasMore: boolean
  truncated: boolean
}

interface ExpectedCacheMetadata {
  fetchedAt: number
  expiresAt: number
  stale: boolean
  refreshError?: boolean
}
interface ExpectedCachedResult<Value> {
  data: Value
  cache: ExpectedCacheMetadata
}
type ExpectedCacheReadOptions = { force?: boolean }

interface ExpectedGitHubIssue {
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
interface ExpectedGitHubProject {
  id: string
  number: number
  title: string
  shortDescription: string
  closed: boolean
  url: string
}
interface ExpectedGitHubProjectBoard {
  project: ExpectedGitHubProject
  fields: ExpectedGitHubProjectField[]
  fieldsHasMore: boolean
  fieldsTruncated: boolean
  fieldOptionsTruncated: boolean
  fieldsResultBytes: number
  items: ExpectedGitHubProjectItem[]
  itemsHasMore: boolean
  itemsTruncated: boolean
  itemValuesTruncated: boolean
  itemsResultBytes: number
  hasMore: boolean
  truncated: boolean
}
interface ExpectedGitHubProjectField {
  id: string
  name: string
  dataType: string
  options?: Array<{ id: string; name: string; color?: string; startDate?: string; duration?: number }>
  optionsHasMore?: boolean
}
interface ExpectedGitHubProjectItem {
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
type ExpectedGitHubProjectItemUpdate =
  | { type: 'singleSelect'; optionId: string }
  | { type: 'iteration'; iterationId: string }
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'date'; value: string }
  | { type: 'clear' }
interface ExpectedGitHubData {
  repository: { nameWithOwner: string; url: string; owner: string } | null
  issues: ExpectedGitHubIssue[]
  issuesHasMore: boolean
  issuesTruncated: boolean
  issuesResultBytes?: number
  projects: ExpectedGitHubProject[]
  projectsHasMore: boolean
  projectsTruncated: boolean
  hasMore: boolean
  truncated: boolean
  githubDiagnostic: string | null
  projectsDiagnostic: string | null
}

type ExpectedGitHubApi = {
  gitStatus: (options?: ExpectedCacheReadOptions) => Promise<ExpectedCachedResult<ExpectedGitStatus>>
  initRepository: () => Promise<ExpectedGitStatus>
  addRemote: (remoteUrl: string) => Promise<ExpectedGitStatus>
  createRepository: (repositoryName: string, visibility: 'private' | 'public') => Promise<ExpectedGitStatus>
  stage: (filePaths: string[]) => Promise<ExpectedGitStatus>
  unstage: (filePaths: string[]) => Promise<ExpectedGitStatus>
  commit: (message: string) => Promise<ExpectedGitStatus>
  push: () => Promise<ExpectedGitStatus>
  fetch: () => Promise<ExpectedGitStatus>
  pullRebase: () => Promise<ExpectedGitStatus>
  branches: () => Promise<ExpectedGitBranchPage>
  switchBranch: (branchName: string) => Promise<ExpectedGitStatus>
  createBranch: (branchName: string) => Promise<ExpectedGitStatus>
  fileDiff: (filePath: string) => Promise<string>
  revert: (sha: string) => Promise<ExpectedGitStatus>
  data: (options?: ExpectedCacheReadOptions) => Promise<ExpectedCachedResult<ExpectedGitHubData>>
  createIssue: (title: string, body: string) => Promise<ExpectedGitHubData>
  updateIssue: (issueNumber: number, title: string, body: string, state: 'OPEN' | 'CLOSED') => Promise<ExpectedGitHubData>
  projectBoard: (projectNumber: number, options?: ExpectedCacheReadOptions) => Promise<ExpectedCachedResult<ExpectedGitHubProjectBoard>>
  createProject: (title: string) => Promise<ExpectedGitHubProject[]>
  editProject: (projectNumber: number, title: string, description: string) => Promise<ExpectedGitHubProject[]>
  closeProject: (projectNumber: number, undo: boolean) => Promise<ExpectedGitHubProject[]>
  addIssueToProject: (projectNumber: number, issueUrl: string) => Promise<ExpectedGitHubProjectBoard>
  updateProjectItem: (projectNumber: number, itemId: string, fieldId: string, update: ExpectedGitHubProjectItemUpdate) => Promise<ExpectedGitHubProjectBoard>
  projectItemFields: (projectNumber: number, itemId: string) => Promise<Record<string, string>>
  createProjectDraft: (projectNumber: number, title: string, body: string) => Promise<ExpectedGitHubProjectBoard>
  archiveProjectItem: (projectNumber: number, itemId: string, undo: boolean) => Promise<ExpectedGitHubProjectBoard>
}

export type GitHubBridgeContractAssertions = [
  Expect<Equal<GitHubApi, ExpectedGitHubApi>>,
  Expect<Equal<VincodeLabBridge['github'], GitHubApi>>,
  Expect<Equal<keyof GitHubApi,
    | 'gitStatus'
    | 'initRepository'
    | 'addRemote'
    | 'createRepository'
    | 'stage'
    | 'unstage'
    | 'commit'
    | 'push'
    | 'fetch'
    | 'pullRebase'
    | 'branches'
    | 'switchBranch'
    | 'createBranch'
    | 'fileDiff'
    | 'revert'
    | 'data'
    | 'createIssue'
    | 'updateIssue'
    | 'projectBoard'
    | 'createProject'
    | 'editProject'
    | 'closeProject'
    | 'addIssueToProject'
    | 'updateProjectItem'
    | 'projectItemFields'
    | 'createProjectDraft'
    | 'archiveProjectItem'
  >>,
]

// @ts-expect-error Il file Git deve essere importato dal bridge, non dichiarato globalmente.
export type GitFileStatusContractMustNotBeGlobal = GitFileStatus
// @ts-expect-error Il commit Git deve essere importato dal bridge, non dichiarato globalmente.
export type GitCommitContractMustNotBeGlobal = GitCommit
// @ts-expect-error Il commit del grafo deve essere importato dal bridge, non dichiarato globalmente.
export type GitGraphCommitContractMustNotBeGlobal = GitGraphCommit
// @ts-expect-error Il branch Git deve essere importato dal bridge, non dichiarato globalmente.
export type GitBranchContractMustNotBeGlobal = GitBranch
// @ts-expect-error La pagina branch deve essere importata dal bridge, non dichiarata globalmente.
export type GitBranchPageContractMustNotBeGlobal = GitBranchPage
// @ts-expect-error Lo stato Git deve essere importato dal bridge, non dichiarato globalmente.
export type GitStatusContractMustNotBeGlobal = GitStatus
// @ts-expect-error I metadati cache devono essere importati dal bridge, non dichiarati globalmente.
export type CacheMetadataContractMustNotBeGlobal = CacheMetadata
// @ts-expect-error Il risultato cache deve essere importato dal bridge, non dichiarato globalmente.
export type CachedResultContractMustNotBeGlobal = CachedResult<unknown>
// @ts-expect-error Le opzioni cache devono essere importate dal bridge, non dichiarate globalmente.
export type CacheReadOptionsContractMustNotBeGlobal = CacheReadOptions
// @ts-expect-error L’issue GitHub deve essere importata dal bridge, non dichiarata globalmente.
export type GitHubIssueContractMustNotBeGlobal = GitHubIssue
// @ts-expect-error Il Project GitHub deve essere importato dal bridge, non dichiarato globalmente.
export type GitHubProjectContractMustNotBeGlobal = GitHubProject
// @ts-expect-error La board GitHub deve essere importata dal bridge, non dichiarata globalmente.
export type GitHubProjectBoardContractMustNotBeGlobal = GitHubProjectBoard
// @ts-expect-error Il campo Project deve essere importato dal bridge, non dichiarato globalmente.
export type GitHubProjectFieldContractMustNotBeGlobal = GitHubProjectField
// @ts-expect-error L’elemento Project deve essere importato dal bridge, non dichiarato globalmente.
export type GitHubProjectItemContractMustNotBeGlobal = GitHubProjectItem
// @ts-expect-error L’aggiornamento Project deve essere importato dal bridge, non dichiarato globalmente.
export type GitHubProjectItemUpdateContractMustNotBeGlobal = GitHubProjectItemUpdate
// @ts-expect-error I dati GitHub devono essere importati dal bridge, non dichiarati globalmente.
export type GitHubDataContractMustNotBeGlobal = GitHubData
