import { useCallback, useRef, useState } from 'react'
import type { WorkspaceSessionState } from '@/bridge'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import type { GitHubTab } from '../model/github-workspace.types'
import { useRequestCoordinator } from './use-request-coordinator'

export function useGitHubWorkspaceState(initialState?: WorkspaceSessionState['github']) {
  const [tab, setTab] = useState<GitHubTab>(() => initialState?.tab ?? 'changes')
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [data, setData] = useState<GitHubData | null>(null)
  const [gitCache, setGitCache] = useState<CacheMetadata | null>(null)
  const [githubCache, setGitHubCache] = useState<CacheMetadata | null>(null)
  const [boardCache, setBoardCache] = useState<CacheMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyCount, setBusyCount] = useState(0)
  const busy = busyCount > 0

  const [commitMessage, setCommitMessage] = useState('')
  const [branchPage, setBranchPage] = useState<GitBranchPage>({ branches: [], hasMore: false, truncated: false })
  const [branchName, setBranchName] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [githubRepositoryName, setGitHubRepositoryName] = useState('')
  const [githubRepositoryVisibility, setGitHubRepositoryVisibility] = useState<'private' | 'public'>('private')
  const [selectedDiff, setSelectedDiff] = useState<{ path: string; content: string } | null>(null)

  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [issueSearch, setIssueSearch] = useState('')
  const [issueStateFilter, setIssueStateFilter] = useState<'all' | 'OPEN' | 'CLOSED'>(() => initialState?.issueStateFilter ?? 'OPEN')
  const [issueComposerOpen, setIssueComposerOpen] = useState(false)
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null)
  const [issueDetailOpen, setIssueDetailOpen] = useState(false)

  const [boardSearch, setBoardSearch] = useState('')
  const [boardStatusFilter, setBoardStatusFilter] = useState('')
  const [boardGroupFieldId, setBoardGroupFieldId] = useState('')
  const [collapsedBoardGroups, setCollapsedBoardGroups] = useState<Set<string>>(new Set())
  const [projectPickerCollapsed, setProjectPickerCollapsed] = useState(false)
  const [selectedBoardItemId, setSelectedBoardItemId] = useState<string | null>(null)
  const [boardItemDialogOpen, setBoardItemDialogOpen] = useState(false)
  const [projectFieldDrafts, setProjectFieldDrafts] = useState<Record<string, string>>({})
  const [projectFieldValues, setProjectFieldValues] = useState<Record<string, string>>({})
  const [loadingProjectFields, setLoadingProjectFields] = useState(false)
  const [loadingBoard, setLoadingBoard] = useState(false)
  const [board, setBoard] = useState<GitHubProjectBoard | null>(null)
  const [selectedProject, setSelectedProject] = useState<number | null>(() => initialState?.selectedProjectNumber ?? null)
  const [projectTitle, setProjectTitle] = useState('')
  const [editingProject, setEditingProject] = useState<GitHubProject | null>(null)
  const [projectEditTitle, setProjectEditTitle] = useState('')
  const [projectEditDescription, setProjectEditDescription] = useState('')

  const issueComposerTrigger = useRef<HTMLButtonElement>(null)
  const issueTitleInput = useRef<HTMLInputElement>(null)
  const issueDetailTrigger = useRef<HTMLButtonElement>(null)
  const boardItemDialogTrigger = useRef<HTMLButtonElement>(null)
  const boardSearchInput = useRef<HTMLInputElement>(null)
  const changesPrimary = useRef<HTMLDivElement>(null)
  const diffRegion = useRef<HTMLElement>(null)
  const diffOpener = useRef<HTMLButtonElement>(null)

  const gitRequests = useRequestCoordinator()
  const githubDataRequests = useRequestCoordinator()
  const boardRequests = useRequestCoordinator()
  const diffRequests = useRequestCoordinator()
  const failedDiffFile = useRef<GitFileStatus | null>(null)
  const projectFieldRequests = useRequestCoordinator()
  const selectedProjectRef = useRef(selectedProject)

  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)

  const beginBusy = useCallback(() => setBusyCount((current) => current + 1), [])
  const endBusy = useCallback(() => setBusyCount((current) => Math.max(0, current - 1)), [])
  const getSelectedProject = useCallback(() => selectedProjectRef.current, [])
  const selectProject = useCallback((projectNumber: number | null) => {
    selectedProjectRef.current = projectNumber
    setSelectedProject(projectNumber)
  }, [])
  const rememberFailedDiff = useCallback((file: GitFileStatus | null) => { failedDiffFile.current = file }, [])
  const getFailedDiff = useCallback(() => failedDiffFile.current, [])
  const setBoardItemDialogTrigger = useCallback((element: HTMLButtonElement | null) => { boardItemDialogTrigger.current = element }, [])
  const focusChangesPrimary = useCallback(() => { changesPrimary.current?.focus() }, [])
  const focusChangesPrimaryAction = useCallback(() => {
    const target = changesPrimary.current?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? changesPrimary.current
    target?.focus()
  }, [])
  const focusDiffRegion = useCallback(() => { diffRegion.current?.focus() }, [])

  return {
    beginBusy,
    board,
    boardCache,
    boardGroupFieldId,
    boardItemDialogOpen,
    boardRequests,
    boardSearch,
    boardStatusFilter,
    branchName,
    branchPage,
    busy,
    collapsedBoardGroups,
    commitMessage,
    confirmation,
    data,
    diffRequests,
    editingProject,
    endBusy,
    elements: {
      boardItemDialogTrigger,
      boardSearchInput,
      changesPrimary,
      diffOpener,
      diffRegion,
      issueComposerTrigger,
      issueDetailTrigger,
      issueTitleInput,
    },
    focusChangesPrimary,
    focusChangesPrimaryAction,
    focusDiffRegion,
    getFailedDiff,
    getSelectedProject,
    gitCache,
    githubCache,
    githubDataRequests,
    githubRepositoryName,
    githubRepositoryVisibility,
    gitRequests,
    issueBody,
    issueComposerOpen,
    issueDetailOpen,
    issueSearch,
    issueStateFilter,
    issueTitle,
    loading,
    loadingBoard,
    loadingProjectFields,
    projectEditDescription,
    projectEditTitle,
    projectFieldDrafts,
    projectFieldRequests,
    projectFieldValues,
    projectPickerCollapsed,
    projectTitle,
    remoteUrl,
    selectedBoardItemId,
    selectedDiff,
    selectedIssue,
    selectedProject,
    rememberFailedDiff,
    selectProject,
    setBoard,
    setBoardCache,
    setBoardGroupFieldId,
    setBoardItemDialogOpen,
    setBoardItemDialogTrigger,
    setBoardSearch,
    setBoardStatusFilter,
    setBranchName,
    setBranchPage,
    setCollapsedBoardGroups,
    setCommitMessage,
    setConfirmation,
    setData,
    setEditingProject,
    setGitCache,
    setGitHubCache,
    setGitHubRepositoryName,
    setGitHubRepositoryVisibility,
    setIssueBody,
    setIssueComposerOpen,
    setIssueDetailOpen,
    setIssueSearch,
    setIssueStateFilter,
    setIssueTitle,
    setLoading,
    setLoadingBoard,
    setLoadingProjectFields,
    setProjectEditDescription,
    setProjectEditTitle,
    setProjectFieldDrafts,
    setProjectFieldValues,
    setProjectPickerCollapsed,
    setProjectTitle,
    setRemoteUrl,
    setSelectedBoardItemId,
    setSelectedDiff,
    setSelectedIssue,
    setStatus,
    setTab,
    status,
    tab,
  }
}

export type GitHubWorkspaceState = ReturnType<typeof useGitHubWorkspaceState>
