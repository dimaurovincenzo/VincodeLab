import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { gitBridge } from '@/features/git'
import { githubBridge } from '../api/github.bridge'
import type { RefreshOutcome } from '../model/github-workspace.types'
import type { GitHubErrors } from './use-github-errors'
import type { GitHubWorkspaceState } from './use-github-workspace-state'

type Options = {
  active: boolean
  autoRefreshSeconds: number
  errors: GitHubErrors
  state: GitHubWorkspaceState
}

export function useGitHubData({ active, autoRefreshSeconds, errors, state }: Options) {
  const {
    beginBusy,
    boardRequests,
    endBusy,
    getSelectedProject,
    gitRequests,
    githubDataRequests,
    setBoard,
    setBoardCache,
    setBranchPage,
    setData,
    setGitCache,
    setGitHubCache,
    setLoading,
    setLoadingBoard,
    setStatus,
    tab,
  } = state
  const {
    clearGitStatusError,
    clearSurfaceError,
    publishGitStatusError,
    publishSurfaceError,
  } = errors
  const activeRef = useRef(active)
  useLayoutEffect(() => { activeRef.current = active }, [active])
  const refreshGitRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined)
  const refreshGitHubRef = useRef<(force?: boolean, includeBoard?: boolean) => Promise<void>>(async () => undefined)

  const refreshGit = useCallback(async (force = false) => {
    const requestId = gitRequests.begin()
    if (!force) setLoading(true)
    const branchesRefresh = gitBridge.branches().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ error, ok: false as const }),
    )
    try {
      const nextStatus = await gitBridge.gitStatus({ force })
      if (!gitRequests.isCurrent(requestId)) return
      setStatus(nextStatus.data)
      setGitCache(nextStatus.cache)
      clearGitStatusError()
      if (nextStatus.data.isRepository) {
        const branchesOutcome = await branchesRefresh
        if (!gitRequests.isCurrent(requestId)) return
        if (branchesOutcome.ok) {
          setBranchPage(branchesOutcome.value)
          clearSurfaceError('branches')
        } else {
          publishSurfaceError('branches', branchesOutcome.error, {
            action: 'La lettura dei branch',
            notFoundTitle: 'Branch del repository non disponibili',
            operation: 'refresh-git-branches',
            recovery: 'Aggiorna lo stato Git',
            title: 'Branch Git non disponibili',
          })
        }
      }
      if (nextStatus.cache.stale && !force) void refreshGitRef.current(true)
    } catch (nextError) {
      if (gitRequests.isCurrent(requestId)) publishGitStatusError(nextError)
    } finally {
      if (gitRequests.isCurrent(requestId)) setLoading(false)
    }
  }, [clearGitStatusError, clearSurfaceError, gitRequests, publishGitStatusError, publishSurfaceError, setBranchPage, setGitCache, setLoading, setStatus])
  useEffect(() => { refreshGitRef.current = refreshGit }, [refreshGit])

  const retryGitStatus = useCallback(async () => {
    const requestId = gitRequests.begin()
    clearGitStatusError()
    try {
      const nextStatus = await gitBridge.gitStatus({ force: true })
      if (!gitRequests.isCurrent(requestId)) return
      setStatus(nextStatus.data)
      setGitCache(nextStatus.cache)
      clearGitStatusError()
      setLoading(false)
    } catch (cause) {
      if (gitRequests.isCurrent(requestId)) publishGitStatusError(cause)
    }
  }, [clearGitStatusError, gitRequests, publishGitStatusError, setGitCache, setLoading, setStatus])

  const refreshGitHub = useCallback(async (force = false, includeBoard = true) => {
    const dataRequestId = githubDataRequests.begin()
    const projectNumber = includeBoard ? getSelectedProject() : null
    const boardRequestId = includeBoard ? boardRequests.begin() : null
    if (!force) beginBusy()
    if (projectNumber) setLoadingBoard(true)
    try {
      const dataRefresh = githubBridge.data({ force }).then<RefreshOutcome, RefreshOutcome>((nextData) => {
        if (!githubDataRequests.isCurrent(dataRequestId)) return { accepted: false, stale: false }
        setData(nextData.data)
        setGitHubCache(nextData.cache)
        if (nextData.data.githubDiagnostic) publishSurfaceError('github-diagnostic', nextData.data.githubDiagnostic, {
          action: 'L’accesso ai dati del repository',
          notFoundTitle: 'Repository GitHub non collegato',
          operation: 'read-github-diagnostic',
          recovery: 'Controlla accesso, repository e connessione, poi aggiorna i dati',
          title: 'GitHub non disponibile per il workspace',
        })
        else clearSurfaceError('github-diagnostic')
        if (nextData.data.projectsDiagnostic) publishSurfaceError('projects-diagnostic', nextData.data.projectsDiagnostic, {
          action: 'La lettura dei GitHub Projects',
          operation: 'read-github-projects-diagnostic',
          recovery: 'Autorizza lo scope Projects e aggiorna i dati',
          title: 'GitHub Projects non disponibili',
        })
        else clearSurfaceError('projects-diagnostic')
        return { accepted: true, stale: nextData.cache.stale }
      }, (error) => githubDataRequests.isCurrent(dataRequestId)
        ? { accepted: true, stale: false, error }
        : { accepted: false, stale: false })
      const boardRefresh = projectNumber
        ? githubBridge.projectBoard(projectNumber, { force }).then<RefreshOutcome, RefreshOutcome>((nextBoard) => {
          if (boardRequestId === null || !boardRequests.isCurrent(boardRequestId) || getSelectedProject() !== projectNumber) return { accepted: false, stale: false }
          setBoard(nextBoard.data)
          setBoardCache(nextBoard.cache)
          return { accepted: true, stale: nextBoard.cache.stale }
        }, (error) => boardRequestId !== null && boardRequests.isCurrent(boardRequestId) && getSelectedProject() === projectNumber
          ? { accepted: true, stale: false, error }
          : { accepted: false, stale: false })
        : Promise.resolve<RefreshOutcome>({ accepted: false, stale: false })
      const outcomes = await Promise.all([dataRefresh, boardRefresh])
      const [dataOutcome, boardOutcome] = outcomes
      if (dataOutcome.accepted) {
        if (dataOutcome.error) publishSurfaceError('github-data', dataOutcome.error, {
          action: 'L’aggiornamento di issue e Projects',
          notFoundTitle: 'Repository GitHub non disponibile',
          operation: 'refresh-github-data',
          preserved: 'Gli eventuali dati già caricati restano visibili.',
          recovery: 'Riprova l’aggiornamento',
          title: 'Dati GitHub non disponibili',
        })
        else clearSurfaceError('github-data')
      }
      if (boardOutcome.accepted) {
        if (boardOutcome.error) publishSurfaceError('board', boardOutcome.error, {
          action: 'L’aggiornamento del Project',
          notFoundTitle: 'Project GitHub non disponibile',
          operation: 'refresh-github-project-board',
          preserved: 'L’eventuale board già caricata resta visibile.',
          recovery: 'Riprova l’aggiornamento',
          title: 'Board del Project non disponibile',
        })
        else clearSurfaceError('board')
      }
      if (!force && outcomes.some((outcome) => outcome.accepted && outcome.stale)) void refreshGitHubRef.current(true, includeBoard)
    } finally {
      if (includeBoard && boardRequestId !== null && boardRequests.isCurrent(boardRequestId)) setLoadingBoard(false)
      if (!force) endBusy()
    }
  }, [beginBusy, boardRequests, clearSurfaceError, endBusy, getSelectedProject, githubDataRequests, publishSurfaceError, setBoard, setBoardCache, setData, setGitHubCache, setLoadingBoard])
  useEffect(() => { refreshGitHubRef.current = refreshGitHub }, [refreshGitHub])

  useEffect(() => {
    if (!active || autoRefreshSeconds <= 0) return
    const timer = window.setInterval(() => {
      if (!activeRef.current) return
      if (tab === 'changes' || tab === 'graph') void refreshGitRef.current(true)
      else void refreshGitHubRef.current(true)
    }, autoRefreshSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [active, autoRefreshSeconds, tab])

  useEffect(() => {
    // Rimanda al microtask: l'effetto registra soltanto il caricamento iniziale, non forza un render sincrono.
    void Promise.resolve().then(() => refreshGit())
  }, [refreshGit])

  useEffect(() => {
    if ((tab === 'issues' || tab === 'projects') && !state.data) void Promise.resolve().then(() => refreshGitHub())
  }, [refreshGitHub, state.data, tab])

  return { refreshGit, refreshGitHub, retryGitStatus }
}

export type GitHubDataController = ReturnType<typeof useGitHubData>
