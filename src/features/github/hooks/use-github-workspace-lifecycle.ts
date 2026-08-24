import { useEffect, useRef } from 'react'
import { toast } from '@/components/ui'
import { gitBridge } from '@/features/git'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import type { GitHubWorkspaceProps } from '../model/github-workspace.types'
import type { GitHubDataController } from './use-github-data'
import type { GitHubGitActions } from './use-github-git-actions'
import type { GitHubWorkspaceState } from './use-github-workspace-state'

type Options = Pick<GitHubWorkspaceProps, 'initialState' | 'onContextChange' | 'onOpenFile' | 'onSessionChange' | 'workbenchRequest'> & {
  dataController: GitHubDataController
  gitActions: GitHubGitActions
  state: GitHubWorkspaceState
}

export function useGitHubWorkspaceLifecycle({
  dataController,
  gitActions,
  initialState,
  onContextChange,
  onOpenFile,
  onSessionChange,
  state,
  workbenchRequest,
}: Options) {
  const {
    boardRequests,
    busy,
    focusChangesPrimary,
    focusChangesPrimaryAction,
    loading,
    projectFieldRequests,
    selectedDiff,
    selectedProject,
    selectProject,
    setIssueStateFilter,
    setLoadingBoard,
    setLoadingProjectFields,
    setTab,
    status,
    tab,
  } = state
  const { refreshGit, refreshGitHub } = dataController
  const { clearSelectedDiff, fetchRemote, loadDiff, stage, unstage } = gitActions
  const restoredSession = useRef<WorkspaceSessionState['github'] | null>(null)
  const restoredDiffPath = useRef<string | null>(null)
  const handledWorkbenchRequest = useRef<number | null>(null)

  useEffect(() => {
    if (!initialState) return
    const sessionChanged = restoredSession.current !== initialState
    if (sessionChanged) {
      restoredSession.current = initialState
      restoredDiffPath.current = null
      selectProject(initialState.selectedProjectNumber)
      boardRequests.invalidate()
      projectFieldRequests.invalidate()
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      // Lo snapshot Electron può arrivare dopo il mount della vista persistente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(initialState.tab)
      setIssueStateFilter(initialState.issueStateFilter)
    }
    if (!initialState.selectedDiffPath) {
      // La rimozione del diff è parte dello stesso restore esterno.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (sessionChanged) clearSelectedDiff()
      return
    }
    if (!status || restoredDiffPath.current === initialState.selectedDiffPath) return
    restoredDiffPath.current = initialState.selectedDiffPath
    const file = status.files.find((entry) => entry.path === initialState.selectedDiffPath || entry.previousPath === initialState.selectedDiffPath)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (file) void loadDiff(file)
    else clearSelectedDiff()
  }, [boardRequests, clearSelectedDiff, initialState, loadDiff, projectFieldRequests, selectProject, setIssueStateFilter, setLoadingBoard, setLoadingProjectFields, setTab, status])

  useEffect(() => {
    onSessionChange?.({
      tab,
      selectedDiffPath: selectedDiff?.path ?? null,
      selectedProjectNumber: selectedProject,
      issueStateFilter: state.issueStateFilter,
    })
  }, [onSessionChange, selectedDiff?.path, selectedProject, state.issueStateFilter, tab])

  useEffect(() => {
    onContextChange?.({
      tab,
      branch: status?.branch ?? null,
      changedFiles: status?.files.map((file) => file.path) ?? [],
      selectedDiffPath: selectedDiff?.path ?? null,
    })
  }, [onContextChange, selectedDiff?.path, status?.branch, status?.files, tab])

  useEffect(() => {
    if (!workbenchRequest || loading || handledWorkbenchRequest.current === workbenchRequest.nonce) return
    if (workbenchRequest.kind === 'open-file-diff' && !status) return
    handledWorkbenchRequest.current = workbenchRequest.nonce
    // La richiesta keyboard/menu seleziona la regione Git operativa prima del focus.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab('changes')

    if (workbenchRequest.kind === 'open-file-diff') {
      const file = status?.files.find((entry) => entry.path === workbenchRequest.filePath || entry.previousPath === workbenchRequest.filePath)
      if (file) void loadDiff(file)
      else {
        toast.info('Il file corrente non contiene modifiche Git.', { description: workbenchRequest.filePath })
        requestAnimationFrame(focusChangesPrimary)
      }
      return
    }

    requestAnimationFrame(focusChangesPrimaryAction)
  }, [focusChangesPrimary, focusChangesPrimaryAction, loadDiff, loading, setTab, status, workbenchRequest])

  useApplicationMenuCommand('github.refresh', () => { void (tab === 'changes' ? refreshGit(true) : refreshGitHub(true)) })
  useApplicationMenuCommand('github.fetch', () => {
    if (!status?.remote) {
      toast.info('Collega prima un repository remoto.')
      return
    }
    fetchRemote()
  })

  useEffect(() => gitBridge.contextMenu?.onAction?.((action) => {
    if ((action.contextKind !== 'git-unstaged-file' && action.contextKind !== 'git-staged-file') || !action.contextId) return
    const file = status?.files.find((candidate) => candidate.path === action.contextId)
    if (!file) return
    if (action.command === 'gitFile.open') { onOpenFile?.(file.path); return }
    if (busy) {
      if (action.command === 'gitFile.diff' || action.command === 'gitFile.stage' || action.command === 'gitFile.unstage') toast.info('Attendi la conclusione dell’operazione Git in corso.')
      return
    }
    if (action.command === 'gitFile.diff') { void loadDiff(file); return }
    if (action.command === 'gitFile.stage' && !file.sensitive) { stage(file); return }
    if (action.command === 'gitFile.unstage') unstage(file)
  }) ?? (() => undefined), [busy, loadDiff, onOpenFile, stage, status?.files, unstage])

}
