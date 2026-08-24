import { useCallback } from 'react'
import { toast } from '@/components/ui'
import { githubBridge } from '../api/github.bridge'
import type { GitHubErrors } from './use-github-errors'
import type { GitHubWorkspaceState } from './use-github-workspace-state'

export function useGitHubIssueActions(state: GitHubWorkspaceState, errors: GitHubErrors) {
  const {
    beginBusy,
    endBusy,
    githubDataRequests,
    issueBody,
    issueTitle,
    setData,
    setIssueBody,
    setIssueComposerOpen,
    setIssueTitle,
  } = state
  const { clearSurfaceError, publishSurfaceError } = errors

  const createIssue = useCallback(async () => {
    if (!issueTitle.trim()) return
    beginBusy()
    try {
      const nextData = await githubBridge.createIssue(issueTitle, issueBody)
      githubDataRequests.invalidate()
      setData(nextData)
      setIssueTitle('')
      setIssueBody('')
      setIssueComposerOpen(false)
      clearSurfaceError('issues')
      toast.success('Issue creata')
    } catch (nextError) {
      publishSurfaceError('issues', nextError, {
        action: 'La creazione della issue',
        notFoundTitle: 'Repository GitHub non disponibile',
        operation: 'create-github-issue',
        preserved: 'Titolo e descrizione sono stati mantenuti.',
        recovery: 'Aggiorna le issue prima di decidere se riprovare',
        title: 'Issue non creata',
      })
    } finally {
      endBusy()
    }
  }, [beginBusy, clearSurfaceError, endBusy, githubDataRequests, issueBody, issueTitle, publishSurfaceError, setData, setIssueBody, setIssueComposerOpen, setIssueTitle])

  return { createIssue }
}

export type GitHubIssueActions = ReturnType<typeof useGitHubIssueActions>
