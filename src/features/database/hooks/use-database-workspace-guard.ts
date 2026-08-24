import { useEffect, useRef, useState } from 'react'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import type { DatabaseGuardFailure } from '../model/database.types'
import { reportDatabaseFailure } from '../services/database-error'

type UseDatabaseWorkspaceGuardOptions = {
  discardWork: () => Promise<void>
  hasUnsavedChanges: () => boolean
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
  saveWork: () => Promise<void>
}

export function useDatabaseWorkspaceGuard({
  discardWork,
  hasUnsavedChanges,
  onWorkspaceGuardChange,
  saveWork,
}: UseDatabaseWorkspaceGuardOptions) {
  const [guardFailure, setGuardFailure] = useState<DatabaseGuardFailure | null>(null)
  const databaseGuardActions = useRef<Pick<WorkspaceChangeGuard, 'hasUnsavedChanges' | 'saveAll' | 'discardAll'>>({
    hasUnsavedChanges: () => false,
    saveAll: async () => undefined,
    discardAll: async () => undefined,
  })

  const saveAll = async () => {
    setGuardFailure(null)
    try {
      await saveWork()
    } catch (error) {
      setGuardFailure({
        error: reportDatabaseFailure(
          error,
          'save-before-context-change',
          'Cambio contesto Database sospeso',
          'Il lavoro Database non è stato salvato. Query, modifiche e transazione restano nel contesto corrente; correggi il problema e riprova.',
        ),
        recovery: 'save',
      })
      throw error
    }
  }

  const discardAll = async () => {
    setGuardFailure(null)
    try {
      await discardWork()
    } catch (error) {
      setGuardFailure({
        error: reportDatabaseFailure(
          error,
          'discard-before-context-change',
          'Ripristino Database non completato',
          'Il lavoro Database è stato mantenuto per evitare perdite. Risolvi l’operazione in corso e riprova il ripristino.',
        ),
        recovery: 'discard',
      })
      throw error
    }
  }

  // Il callback nativo può arrivare prima del prossimo effect: conserva sempre
  // le azioni dell'ultimo render committibile senza registrare una guardia stale.
  // eslint-disable-next-line react-hooks/refs
  databaseGuardActions.current = { hasUnsavedChanges, saveAll, discardAll }

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => databaseGuardActions.current.hasUnsavedChanges(),
      saveAll: () => databaseGuardActions.current.saveAll(),
      discardAll: () => databaseGuardActions.current.discardAll(),
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [onWorkspaceGuardChange])

  return { discardAll, guardFailure, saveAll }
}
