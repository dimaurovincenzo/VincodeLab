import { useMemo } from 'react'
import { createListCollection } from '@/components/ui'
import { effectivePreference, useAppPreferences } from '@/lib/app-preferences'
import { layoutGitGraph } from '../model/git-graph.js'
import { formatCacheState } from '../model/github-display'
import { issueStateCounts, visibleGitHubIssues } from '../model/github-issues'
import {
  groupProjectItems,
  matchesGitHubProjectSearch,
  matchesProjectItemSearch,
  projectBoardLimitMessages,
  projectFieldDataType,
  projectFieldName,
  projectStatusCounts,
} from '../model/github-projects'
import type { GitHubErrorSurface, GitHubWorkspaceProps } from '../model/github-workspace.types'
import { useGitHubData } from './use-github-data'
import { useGitHubErrors } from './use-github-errors'
import { useGitHubGitActions } from './use-github-git-actions'
import { useGitHubIssueActions } from './use-github-issue-actions'
import { useGitHubProjectActions } from './use-github-project-actions'
import { useGitHubWorkspaceLifecycle } from './use-github-workspace-lifecycle'
import { useGitHubWorkspaceState } from './use-github-workspace-state'

export function useGitHubWorkspaceController({
  active,
  initialState,
  onContextChange,
  onOpenFile,
  onSessionChange,
  workbenchRequest = null,
}: GitHubWorkspaceProps) {
  const { preferences } = useAppPreferences()
  const autoRefreshSeconds = effectivePreference(preferences, 'git.autoRefreshSeconds', 60)
  const historyLimit = effectivePreference(preferences, 'git.historyLimit', 100)
  const projectSelectorWidth = effectivePreference(preferences, 'git.projectSelectorWidth', 360)
  const confirmRemoteActions = effectivePreference(preferences, 'git.confirmRemoteActions', true)
  const state = useGitHubWorkspaceState(initialState)
  const errors = useGitHubErrors()
  const dataController = useGitHubData({ active, autoRefreshSeconds, errors, state })
  const gitActions = useGitHubGitActions({ confirmRemoteActions, errors, state })
  const issueActions = useGitHubIssueActions(state, errors)
  const projectActions = useGitHubProjectActions(state, errors)

  useGitHubWorkspaceLifecycle({
    dataController,
    gitActions,
    initialState,
    onContextChange,
    onOpenFile,
    onSessionChange,
    state,
    workbenchRequest,
  })

  const visibleProjects = useMemo(() => (state.data?.projects ?? []).filter((project) => matchesGitHubProjectSearch(project, state.projectSearch)), [state.data?.projects, state.projectSearch])
  const projectCollection = useMemo(() => createListCollection({
    items: visibleProjects,
    isItemDisabled: () => state.busy,
    itemToString: (project) => project.title,
    itemToValue: (project) => String(project.number),
  }), [state.busy, visibleProjects])

  const boardStatusField = state.board?.fields.find((field) => ['status', 'stato'].includes(projectFieldName(field)))
  const boardPriorityField = state.board?.fields.find((field) => ['priorità', 'priority'].includes(projectFieldName(field)))
  const preferredBoardGroupField = state.board?.fields.find((field) => ['prodotto', 'area', 'team', 'categoria'].includes(projectFieldName(field)))
  const activeBoardGroupFieldId = state.boardGroupFieldId === '__none__' ? '' : state.boardGroupFieldId || preferredBoardGroupField?.id || boardStatusField?.id || ''
  const activeBoardGroupField = state.board?.fields.find((field) => field.id === activeBoardGroupFieldId)
  const selectedBoardItem = state.board?.items.find((item) => item.id === state.selectedBoardItemId) ?? null
  const issueDetail = selectedBoardItem?.content?.number ? state.data?.issues.find((issue) => issue.number === selectedBoardItem.content?.number) ?? null : null
  const selectedProjectDetails = state.data?.projects.find((project) => project.number === state.selectedProject) ?? null
  const editableBoardFields = state.board?.fields.filter((field) => field.id !== boardStatusField?.id && ['text', 'number', 'date', 'single_select', 'iteration'].includes(projectFieldDataType(field))) ?? []
  const boardItems = state.board?.items.filter((item) => {
    return matchesProjectItemSearch(item, state.boardSearch)
      && (!state.boardStatusFilter || item.status === state.boardStatusFilter)
  }) ?? []
  const boardGroups = groupProjectItems(boardItems, activeBoardGroupFieldId, activeBoardGroupField, boardStatusField)
  const boardStatusCounts = projectStatusCounts(state.board?.items ?? [])
  const boardHasFilters = Boolean(state.boardSearch.trim() || state.boardStatusFilter)
  const graphRows = layoutGitGraph((state.status?.graph ?? []).slice(0, historyLimit))
  const issueCounts = issueStateCounts(state.data?.issues ?? [])
  const visibleIssues = visibleGitHubIssues(state.data?.issues ?? [], state.issueSearch, state.issueStateFilter)
  const branches = state.branchPage.branches
  const branchesLimited = state.branchPage.hasMore || state.branchPage.truncated
  const filesLimited = state.status?.filesHasMore === true || state.status?.filesTruncated === true
  const graphLimited = state.status?.graphHasMore === true || state.status?.graphTruncated === true
  const gitResultLimited = state.status?.hasMore === true || state.status?.truncated === true
  const issuesLimited = state.data?.issuesHasMore === true || state.data?.issuesTruncated === true
  const projectsLimited = state.data?.projectsHasMore === true || state.data?.projectsTruncated === true
  const githubResultLimited = state.data?.hasMore === true || state.data?.truncated === true
  const boardResultLimited = state.board?.hasMore === true || state.board?.truncated === true
  const boardLimitMessages = projectBoardLimitMessages(state.board)
  const activeLimitMessage = state.tab === 'changes'
    ? (filesLimited || branchesLimited || gitResultLimited)
      ? 'Elenco limitato: il repository contiene altre modifiche o branch oltre quelli mostrati.'
      : null
    : state.tab === 'graph'
      ? (graphLimited || gitResultLimited)
        ? 'Cronologia limitata: il repository contiene altri commit oltre quelli mostrati.'
        : null
      : state.tab === 'issues'
        ? (issuesLimited || githubResultLimited)
          ? 'Issue limitate: GitHub contiene altre issue oltre quelle caricate.'
          : null
        : (projectsLimited || boardResultLimited || githubResultLimited)
          ? 'Progetti limitati: GitHub contiene altri progetti, elementi o campi oltre quelli caricati.'
          : null
  const staged = state.status?.files.filter((file) => file.index !== ' ' && file.index !== '?') ?? []
  const unstaged = state.status?.files.filter((file) => file.workingTree !== ' ' || file.index === '?') ?? []
  const stageable = unstaged.filter((file) => !file.sensitive)
  const activeCache = state.tab === 'changes' || state.tab === 'graph'
    ? state.gitCache
    : state.tab === 'projects' && state.boardCache
      ? state.boardCache
      : state.githubCache
  const cacheState = formatCacheState(activeCache)

  const refreshGitAfterFailure = async (surface: GitHubErrorSurface) => {
    errors.clearSurfaceError(surface)
    await dataController.refreshGit(true)
  }
  const refreshGitHubAfterFailure = async (surface: GitHubErrorSurface) => {
    errors.clearSurfaceError(surface)
    await dataController.refreshGitHub(true, false)
  }
  const retryFailedDiff = async () => {
    const file = state.getFailedDiff()
    if (!file) return
    errors.clearSurfaceError('diff')
    await gitActions.loadDiff(file)
  }
  const retrySelectedBoard = async () => {
    if (!state.selectedProject) return
    errors.clearSurfaceError('board')
    await projectActions.loadBoard(state.selectedProject)
  }
  const retrySelectedProjectFields = async () => {
    if (!selectedBoardItem || !state.board) return
    errors.clearSurfaceError('project-fields')
    await projectActions.loadProjectItemFields(selectedBoardItem, state.board.project.number)
  }
  const retryProjectItemCreate = async () => {
    errors.clearSurfaceError('project-item-create')
    await retrySelectedBoard()
  }

  return {
    actions: { ...gitActions, ...issueActions, ...projectActions },
    dataController,
    derived: {
      activeBoardGroupField,
      activeBoardGroupFieldId,
      activeCache,
      activeLimitMessage,
      boardGroups,
      boardHasFilters,
      boardItems,
      boardLimitMessages,
      boardPriorityField,
      boardResultLimited,
      boardStatusCounts,
      boardStatusField,
      branches,
      branchesLimited,
      cacheState,
      editableBoardFields,
      filesLimited,
      githubResultLimited,
      graphLimited,
      graphRows,
      issueCounts,
      issueDetail,
      issuesLimited,
      projectCollection,
      projectsLimited,
      selectedBoardItem,
      selectedProjectDetails,
      stageable,
      staged,
      unstaged,
      visibleProjects,
      visibleIssues,
    },
    errors,
    elements: state.elements,
    projectSelectorWidth,
    recoveries: {
      refreshGitAfterFailure,
      refreshGitHubAfterFailure,
      retryFailedDiff,
      retryProjectItemCreate,
      retrySelectedBoard,
      retrySelectedProjectFields,
    },
    state,
  }
}

export type GitHubWorkspaceController = ReturnType<typeof useGitHubWorkspaceController>
