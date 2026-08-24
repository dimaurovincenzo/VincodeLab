import { useCallback } from 'react'
import { toast } from '@/components/ui'
import { gitBridge } from '@/features/git'
import { githubBridge } from '../api/github.bridge'
import type { GitHubErrorContext, GitHubErrorSurface } from '../model/github-workspace.types'
import type { GitHubErrors } from './use-github-errors'
import type { GitHubWorkspaceState } from './use-github-workspace-state'

type Options = {
  confirmRemoteActions: boolean
  errors: GitHubErrors
  state: GitHubWorkspaceState
}

export function useGitHubGitActions({ confirmRemoteActions, errors, state }: Options) {
  const {
    beginBusy,
    branchName,
    endBusy,
    diffRequests,
    focusDiffRegion,
    gitRequests,
    githubRepositoryName,
    githubRepositoryVisibility,
    remoteUrl,
    rememberFailedDiff,
    setBranchName,
    setBranchPage,
    setCommitMessage,
    setConfirmation,
    setGitHubRepositoryName,
    setLoading,
    setRemoteUrl,
    setSelectedDiff,
    setStatus,
    status,
  } = state
  const { clearSurfaceError, publishSurfaceError } = errors

  const mutateGit = useCallback(async (
    operation: () => Promise<GitStatus>,
    success: string,
    surface: GitHubErrorSurface,
    context: GitHubErrorContext,
  ) => {
    beginBusy()
    try {
      const nextStatus = await operation()
      gitRequests.invalidate()
      setStatus(nextStatus)
      setLoading(false)
      clearSurfaceError(surface)
      toast.success(success)
    } catch (nextError) {
      publishSurfaceError(surface, nextError, context)
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, gitRequests, publishSurfaceError, setLoading, setStatus])

  const confirmGit = useCallback((
    message: string,
    operation: () => Promise<GitStatus>,
    success: string,
    surface: GitHubErrorSurface,
    context: GitHubErrorContext,
  ) => {
    if (!confirmRemoteActions) {
      void mutateGit(operation, success, surface, context)
      return
    }
    setConfirmation({
      title: success,
      detail: message,
      confirmLabel: 'Conferma',
      onConfirm: () => void mutateGit(operation, success, surface, context),
    })
  }, [confirmRemoteActions, mutateGit, setConfirmation])

  const initializeRepositoryConfirmed = useCallback(async () => {
    beginBusy()
    try {
      const nextStatus = await gitBridge.initRepository()
      gitRequests.invalidate()
      setStatus(nextStatus)
      setLoading(false)
      clearSurfaceError('git-changes')
      toast.success('Repository Git inizializzato')
      try {
        const nextBranches = await gitBridge.branches()
        setBranchPage(nextBranches)
        clearSurfaceError('branches')
      } catch (branchError) {
        publishSurfaceError('branches', branchError, {
          action: 'L’aggiornamento dei branch dopo l’inizializzazione',
          operation: 'refresh-git-branches-after-initialize',
          recovery: 'Aggiorna branch e stato Git',
          title: 'Repository inizializzato, branch non aggiornati',
        })
      }
    } catch (nextError) {
      publishSurfaceError('git-changes', nextError, {
        action: 'L’inizializzazione del repository',
        operation: 'initialize-git-repository',
        recovery: 'Aggiorna lo stato Git prima di riprovare',
        title: 'Repository Git non inizializzato',
      })
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, gitRequests, publishSurfaceError, setBranchPage, setLoading, setStatus])

  const initializeRepository = useCallback(() => {
    setConfirmation({
      title: 'Inizializza repository Git',
      detail: 'Verrà creata la cartella nascosta .git nel workspace aperto. I file del progetto non verranno modificati.',
      confirmLabel: 'Inizializza repository',
      onConfirm: () => void initializeRepositoryConfirmed(),
    })
  }, [initializeRepositoryConfirmed, setConfirmation])

  // Stage e unstage sono locali, immediatamente reversibili e già protetti dal
  // servizio Git per i file sensibili: una conferma qui interrompe solo il flusso.
  const stage = useCallback((file: GitFileStatus) => void mutateGit(() => gitBridge.stage([file.path]), 'File aggiunto allo staging', 'git-changes', {
    action: `La preparazione di “${file.path}”`, operation: 'stage-git-file', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'File non aggiunto allo staging',
  }), [mutateGit])

  const unstage = useCallback((file: GitFileStatus) => void mutateGit(() => gitBridge.unstage([file.path]), 'File rimosso dallo staging', 'git-changes', {
    action: `La rimozione di “${file.path}” dallo staging`, operation: 'unstage-git-file', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Staging non aggiornato',
  }), [mutateGit])

  const stageAll = useCallback((files: GitFileStatus[]) => void mutateGit(() => gitBridge.stage(files.map((file) => file.path)), 'Modifiche aggiunte allo staging', 'git-changes', {
    action: 'La preparazione dei file visibili', operation: 'stage-git-files', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'File non aggiunti allo staging',
  }), [mutateGit])

  const unstageAll = useCallback((files: GitFileStatus[]) => void mutateGit(() => gitBridge.unstage(files.map((file) => file.path)), 'File rimossi dallo staging', 'git-changes', {
    action: 'La rimozione dei file visibili dallo staging', operation: 'unstage-git-files', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Staging non aggiornato',
  }), [mutateGit])

  const loadDiff = useCallback(async (file: GitFileStatus) => {
    const requestId = diffRequests.begin()
    beginBusy()
    try {
      const content = await gitBridge.fileDiff(file.path)
      if (!diffRequests.isCurrent(requestId)) return
      setSelectedDiff({ path: file.path, content })
      rememberFailedDiff(null)
      clearSurfaceError('diff')
      requestAnimationFrame(focusDiffRegion)
    } catch (nextError) {
      if (diffRequests.isCurrent(requestId)) {
        rememberFailedDiff(file)
        publishSurfaceError('diff', nextError, {
          action: `La lettura del diff di “${file.path}”`,
          notFoundTitle: 'File del diff non disponibile',
          operation: 'load-git-file-diff',
          preserved: 'L’eventuale diff precedente resta visibile.',
          recovery: 'Riprova a leggere il diff',
          title: 'Diff Git non disponibile',
        })
      }
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, diffRequests, endBusy, focusDiffRegion, publishSurfaceError, rememberFailedDiff, setSelectedDiff])

  const clearSelectedDiff = useCallback(() => {
    diffRequests.invalidate()
    setSelectedDiff(null)
  }, [diffRequests, setSelectedDiff])

  const switchBranch = useCallback((nextBranch: string) => {
    if (!status || nextBranch === status.branch) return
    const dirty = status.files.length > 0 ? '\n\nIl working tree contiene modifiche: Git potrebbe rifiutare il cambio.' : ''
    confirmGit(`Passare al branch “${nextBranch}”?${dirty}`, () => gitBridge.switchBranch(nextBranch), `Branch attivo: ${nextBranch}`, 'git-changes', {
      action: `Il passaggio al branch “${nextBranch}”`, notFoundTitle: 'Branch Git non disponibile', operation: 'switch-git-branch', recovery: 'Aggiorna branch e stato Git prima di riprovare', title: 'Branch Git non cambiato',
    })
  }, [confirmGit, status])

  const createBranch = useCallback(() => {
    const nextBranch = branchName.trim()
    if (!nextBranch) return
    confirmGit(`Creare e attivare il branch “${nextBranch}”?`, async () => {
      const next = await gitBridge.createBranch(nextBranch)
      setBranchName('')
      return next
    }, `Branch creato: ${nextBranch}`, 'git-changes', {
      action: `La creazione del branch “${nextBranch}”`, operation: 'create-git-branch', preserved: 'Il nome inserito è stato mantenuto.', recovery: 'Aggiorna branch e stato Git prima di riprovare', title: 'Branch Git non creato',
    })
  }, [branchName, confirmGit, setBranchName])

  const fetchRemote = useCallback(() => {
    if (!status?.remote) return
    confirmGit(`Controllare gli aggiornamenti remoti da ${status.remote}?`, () => gitBridge.fetch(), 'Aggiornamenti remoti controllati', 'git-remote', {
      action: 'La verifica degli aggiornamenti remoti', notFoundTitle: 'Repository remoto non disponibile', operation: 'fetch-git-remote', recovery: 'Aggiorna lo stato Git prima di riprovare', title: 'Aggiornamenti remoti non verificati',
    })
  }, [confirmGit, status])

  const pullRemote = useCallback(() => {
    if (!status?.upstream) return
    confirmGit(`Scaricare e integrare gli aggiornamenti da ${status.upstream}?`, () => gitBridge.pullRebase(), 'Aggiornamenti integrati', 'git-remote', {
      action: 'L’integrazione degli aggiornamenti remoti', notFoundTitle: 'Branch remoto non disponibile', operation: 'pull-rebase-git-remote', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Aggiornamenti remoti non integrati',
    })
  }, [confirmGit, status])

  const pushRemote = useCallback(() => {
    if (!status?.remote) return
    confirmGit(status.upstream ? `Pubblicare ${status.ahead ?? 0} commit sul remote ${status.upstream}?` : `Pubblicare ${status.ahead ?? 0} commit su ${status.remote} e associare il branch?`, () => gitBridge.push(), status.upstream ? 'Commit pubblicati' : 'Branch pubblicato e associato al remote', 'git-remote', {
      action: 'La pubblicazione dei commit', notFoundTitle: 'Repository o branch remoto non disponibile', operation: 'push-git-remote', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Commit non pubblicati',
    })
  }, [confirmGit, status])

  const addRemoteConfirmed = useCallback(async () => {
    beginBusy()
    try {
      const nextStatus = await gitBridge.addRemote(remoteUrl)
      gitRequests.invalidate()
      setStatus(nextStatus)
      setLoading(false)
      setRemoteUrl('')
      clearSurfaceError('git-remote')
      toast.success('Repository GitHub collegato')
    } catch (nextError) {
      publishSurfaceError('git-remote', nextError, {
        action: 'Il collegamento del repository remoto',
        notFoundTitle: 'Repository GitHub non trovato',
        operation: 'add-github-remote',
        preserved: 'L’indirizzo inserito è stato mantenuto.',
        recovery: 'Verifica il repository e aggiorna lo stato Git prima di riprovare',
        title: 'Repository GitHub non collegato',
      })
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, gitRequests, publishSurfaceError, remoteUrl, setLoading, setRemoteUrl, setStatus])

  const addRemote = useCallback(() => {
    if (!remoteUrl.trim()) return
    setConfirmation({ title: 'Collega repository GitHub', detail: `Il remote origin verrà configurato con:\n${remoteUrl.trim()}`, confirmLabel: 'Collega repository', onConfirm: () => void addRemoteConfirmed() })
  }, [addRemoteConfirmed, remoteUrl, setConfirmation])

  const createGitHubRepositoryConfirmed = useCallback(async () => {
    beginBusy()
    try {
      const nextStatus = await githubBridge.createRepository(githubRepositoryName, githubRepositoryVisibility)
      gitRequests.invalidate()
      setStatus(nextStatus)
      setLoading(false)
      setGitHubRepositoryName('')
      clearSurfaceError('git-remote')
      toast.success('Repository GitHub creato e pubblicato')
    } catch (nextError) {
      publishSurfaceError('git-remote', nextError, {
        action: 'La creazione e pubblicazione del repository',
        operation: 'create-github-repository',
        preserved: 'Nome e visibilità inseriti sono stati mantenuti.',
        recovery: 'Aggiorna lo stato Git prima di decidere se riprovare',
        title: 'Repository GitHub non creato',
      })
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, gitRequests, githubRepositoryName, githubRepositoryVisibility, publishSurfaceError, setGitHubRepositoryName, setLoading, setStatus])

  const createGitHubRepository = useCallback(() => {
    if (!githubRepositoryName.trim()) return
    const visibility = githubRepositoryVisibility === 'private' ? 'privato' : 'pubblico'
    setConfirmation({
      title: 'Crea repository GitHub',
      detail: `Verrà creato e pubblicato il repository ${visibility} “${githubRepositoryName.trim()}” nell’account GitHub configurato. Il remote origin verrà collegato al workspace.`,
      confirmLabel: 'Crea e pubblica',
      onConfirm: () => void createGitHubRepositoryConfirmed(),
    })
  }, [createGitHubRepositoryConfirmed, githubRepositoryName, githubRepositoryVisibility, setConfirmation])

  const requestCommit = useCallback(() => {
    if (!state.commitMessage.trim() || !status) return
    const stagedCount = status.files.filter((file) => file.index !== ' ' && file.index !== '?').length
    setConfirmation({
      title: 'Crea commit',
      detail: `${stagedCount} file in staging. Messaggio: ${state.commitMessage.trim()}`,
      confirmLabel: 'Crea commit',
      onConfirm: () => void mutateGit(async () => {
        const next = await gitBridge.commit(state.commitMessage)
        setCommitMessage('')
        return next
      }, 'Commit creato', 'git-commit', {
        action: 'La creazione del commit', operation: 'create-git-commit', preserved: 'Il messaggio e i file in staging sono stati mantenuti.', recovery: 'Aggiorna lo stato Git prima di decidere se riprovare', title: 'Commit non creato',
      }),
    })
  }, [mutateGit, setCommitMessage, setConfirmation, state.commitMessage, status])

  return {
    addRemote,
    clearSelectedDiff,
    createBranch,
    createGitHubRepository,
    fetchRemote,
    initializeRepository,
    loadDiff,
    pullRemote,
    pushRemote,
    requestCommit,
    stage,
    stageAll,
    switchBranch,
    unstage,
    unstageAll,
  }
}

export type GitHubGitActions = ReturnType<typeof useGitHubGitActions>
