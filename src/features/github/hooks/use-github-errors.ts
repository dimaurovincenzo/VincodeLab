import { useCallback, useRef, useState } from 'react'
import { reportUserError, type UserError } from '@/lib/user-error'
import type { GitHubErrorContext, GitHubErrorSurface } from '../model/github-workspace.types'
import { contextualGitHubError, sameUserError } from '../services/github-error'

export function useGitHubErrors() {
  const gitStatusErrorRef = useRef<UserError | null>(null)
  const [gitStatusError, setGitStatusError] = useState<UserError | null>(null)
  const surfaceErrorsRef = useRef<Partial<Record<GitHubErrorSurface, UserError>>>({})
  const [surfaceErrors, setSurfaceErrors] = useState<Partial<Record<GitHubErrorSurface, UserError>>>({})

  const clearSurfaceError = useCallback((surface: GitHubErrorSurface) => {
    if (!surfaceErrorsRef.current[surface]) return
    const next = { ...surfaceErrorsRef.current }
    delete next[surface]
    surfaceErrorsRef.current = next
    setSurfaceErrors(next)
  }, [])

  const publishSurfaceError = useCallback((surface: GitHubErrorSurface, cause: unknown, context: GitHubErrorContext) => {
    const normalized = contextualGitHubError(cause, context)
    if (sameUserError(surfaceErrorsRef.current[surface], normalized)) return surfaceErrorsRef.current[surface]!
    const incident = reportUserError(normalized)
    const next = { ...surfaceErrorsRef.current, [surface]: incident }
    surfaceErrorsRef.current = next
    setSurfaceErrors(next)
    return incident
  }, [])

  const clearGitStatusError = useCallback(() => {
    gitStatusErrorRef.current = null
    setGitStatusError(null)
  }, [])

  const publishGitStatusError = useCallback((cause: unknown) => {
    const normalized = contextualGitHubError(cause, {
      action: 'La lettura dello stato Git',
      operation: 'refresh-git-status',
      recovery: 'Riprova',
      title: 'Stato Git non disponibile',
    })
    if (sameUserError(gitStatusErrorRef.current ?? undefined, normalized)) return gitStatusErrorRef.current!
    const incident = reportUserError(normalized)
    gitStatusErrorRef.current = incident
    setGitStatusError(incident)
    return incident
  }, [])

  return {
    clearGitStatusError,
    clearSurfaceError,
    gitStatusError,
    publishGitStatusError,
    publishSurfaceError,
    surfaceErrors,
  }
}

export type GitHubErrors = ReturnType<typeof useGitHubErrors>
