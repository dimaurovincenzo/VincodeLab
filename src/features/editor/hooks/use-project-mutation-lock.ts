import { useCallback, useRef } from 'react'
import { projectEntriesOverlap } from '../model/editor-tree'

type ProjectEntryKind = 'file' | 'directory'

export function useProjectMutationLock() {
  const activeMutationsRef = useRef(new Map<string, { entryId: string; entryKind: ProjectEntryKind }>())

  const hasActiveMutation = useCallback((entryId: string, entryKind: ProjectEntryKind) => (
    [...activeMutationsRef.current.values()].some((mutation) => (
      projectEntriesOverlap(mutation.entryId, mutation.entryKind, entryId, entryKind)
    ))
  ), [])

  const beginMutation = useCallback((entryId: string, entryKind: ProjectEntryKind) => {
    const key = `${entryKind}\0${entryId}`
    activeMutationsRef.current.set(key, { entryId, entryKind })
    return () => { activeMutationsRef.current.delete(key) }
  }, [])

  const clearMutations = useCallback(() => {
    activeMutationsRef.current.clear()
  }, [])

  return { beginMutation, clearMutations, hasActiveMutation }
}
