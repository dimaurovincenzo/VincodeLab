export interface GitFileStatus {
  path: string
  previousPath?: string
  index: string
  workingTree: string
  sensitive?: boolean
}

export interface GitCommit {
  sha: string
  subject: string
  author: string
  date: string
}

export interface GitGraphCommit {
  sha: string
  parents: string[]
  refs: string[]
  subject: string
  author?: string
  date?: string
}

export interface GitBranch {
  name: string
  current: boolean
}

export interface GitBranchPage {
  branches: GitBranch[]
  hasMore: boolean
  truncated: boolean
}

export interface GitStatus {
  isRepository: boolean
  branch?: string
  remote?: string | null
  upstream?: string | null
  ahead?: number
  behind?: number
  files: GitFileStatus[]
  commits: GitCommit[]
  graph: GitGraphCommit[]
  filesHasMore: boolean
  filesTruncated: boolean
  graphHasMore: boolean
  graphTruncated: boolean
  hasMore: boolean
  truncated: boolean
}
