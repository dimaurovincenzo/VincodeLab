import { useCallback, useEffect, useRef, useState } from 'react'
import { getVincodeLabBridge, type WorkspaceSessionFocusTarget, type WorkspaceSessionState } from '@/bridge'
import { createWorkspaceSessionClient } from '@/features/workspace'
import { reportRendererFailure } from '@/lib/renderer-error'
import type { AppSection, WorkspaceSessionFailure } from '../model/app-controller.types'

function primaryFocusTarget(section: AppSection, aiTab: 'terminal' | 'skills' | 'instructions'): WorkspaceSessionFocusTarget {
  if (section === 'ai') return `ai.${aiTab}`
  if (section === 'editor') return 'editor.code'
  if (section === 'terminal') return 'terminal.shell'
  if (section === 'github') return 'github.changes'
  if (section === 'database') return 'database.query'
  if (section === 'redis') return 'redis.keys'
  return 'settings.primary'
}

type UseWorkspacePersistenceOptions = {
  aiTab: 'terminal' | 'skills' | 'instructions'
  appSection: AppSection
  workspace: string | null
}

export function useWorkspacePersistence({ aiTab, appSection, workspace }: UseWorkspacePersistenceOptions) {
  const mounted = useRef(false)
  const [workspaceSessionState, setWorkspaceSessionState] = useState<WorkspaceSessionState | null>(null)
  const [workspaceSessionRecovery, setWorkspaceSessionRecovery] = useState<WorkspaceSessionFailure | null>(null)
  const [workspaceSession] = useState(() => createWorkspaceSessionClient({
    storage: getVincodeLabBridge().workspaceSession,
    onError: (nextError) => {
      setWorkspaceSessionRecovery({
        error: reportRendererFailure(nextError, {
          category: 'persistence',
          component: 'workspace-shell',
          operation: 'save-layout',
          severity: 'warning',
          title: 'Layout del workspace non salvato',
          description: 'La disposizione corrente resta attiva, ma non è stata salvata. Puoi riprovare senza perdere file o modifiche.',
        }),
        kind: 'persistence',
      })
    },
  }))

  const patchWorkspaceSession = useCallback((updater: (state: Readonly<WorkspaceSessionState>) => WorkspaceSessionState) => {
    if (!workspaceSession.getSnapshot().loaded) return
    workspaceSession.patch(updater)
  }, [workspaceSession])

  const recoverWorkspaceSession = useCallback(async () => {
    if (!workspaceSessionRecovery || workspaceSessionRecovery.kind === 'corrupt') {
      setWorkspaceSessionRecovery(null)
      return
    }
    try {
      await workspaceSession.flush()
      setWorkspaceSessionRecovery(null)
    } catch {
      // Il client conserva la sessione dirty e onError aggiorna questo stesso avviso
      // con il nuovo correlation ID, senza una seconda notifica.
    }
  }, [workspaceSession, workspaceSessionRecovery])

  const resetWorkspaceSession = useCallback(() => {
    setWorkspaceSessionState(null)
    setWorkspaceSessionRecovery(null)
  }, [])

  const restoreWorkspaceSession = useCallback(async (onRestored: (state: WorkspaceSessionState) => void) => {
    try {
      const restored = await workspaceSession.load()
      if (!restored.applied) return
      if (restored.recovery?.kind === 'corrupt') {
        setWorkspaceSessionRecovery({
          error: reportRendererFailure(new Error('Layout workspace salvato non valido.'), {
            category: 'persistence',
            code: 'PERSISTENCE_SESSION_CORRUPT',
            component: 'workspace-shell',
            correlationId: restored.recovery.correlationId,
            operation: 'restore-layout',
            severity: 'warning',
            title: 'Layout del workspace ripristinato',
            description: 'La disposizione salvata non era valida. File e dati sono rimasti al sicuro ed è stato applicato il layout predefinito.',
          }),
          kind: 'corrupt',
        })
      }
      setWorkspaceSessionState(restored.state)
      onRestored(restored.state)
    } catch (nextError) {
      setWorkspaceSessionRecovery({
        error: reportRendererFailure(nextError, {
          category: 'persistence',
          component: 'workspace-shell',
          operation: 'restore-layout',
          severity: 'warning',
          title: 'Layout del workspace non ripristinato',
          description: 'File e dati restano disponibili; è stato usato il layout predefinito. Puoi riprovare il salvataggio della disposizione corrente.',
        }),
        kind: 'persistence',
      })
    }
  }, [workspaceSession])

  const flushUntilClean = useCallback(async () => {
    // Una patch può arrivare mentre una write precedente è ancora in volo. Continua
    // finché la revisione più recente risulta persistita prima di autorizzare l'uscita.
    do {
      await workspaceSession.flush()
    } while (workspaceSession.getSnapshot().dirty)
  }, [workspaceSession])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode esegue un cleanup di prova e rimonta subito lo stesso App:
      // rinviare di una microtask distingue quel ciclo da un vero unmount.
      queueMicrotask(() => {
        if (mounted.current) return
        void workspaceSession.flush().catch((nextError) => {
          // L'app sta uscendo e non esiste più una superficie sicura: resta un evento diagnostico, non un toast tardivo.
          reportRendererFailure(nextError, {
            category: 'persistence',
            component: 'workspace-shell',
            operation: 'flush-on-unmount',
            severity: 'warning',
            title: 'Sessione workspace non salvata',
            fallbackDescription: 'La chiusura è proseguita senza salvare l’ultima disposizione.',
          })
        }).finally(() => {
          if (!mounted.current) workspaceSession.dispose()
        })
      })
    }
  }, [workspaceSession])

  useEffect(() => {
    if (!workspace) return
    const snapshot = workspaceSession.getSnapshot()
    if (!snapshot.loaded) return
    const section = appSection
    if (
      snapshot.state.navigation.section === section
      && snapshot.state.navigation.aiTab === aiTab
      && snapshot.state.focus.view === section
      && snapshot.state.focus.target === primaryFocusTarget(section, aiTab)
    ) return
    workspaceSession.patch((current) => ({
      ...current,
      navigation: { section, aiTab },
      focus: { view: section, target: primaryFocusTarget(section, aiTab) },
    }))
  }, [aiTab, appSection, workspace, workspaceSession])

  const updateTerminalSession = useCallback((next: Pick<WorkspaceSessionState['terminal'], 'tab' | 'openSessionCount' | 'activeSessionOrdinal'>) => {
    const current = workspaceSession.getSnapshot().state.terminal
    if (
      current.tab === next.tab
      && current.openSessionCount === next.openSessionCount
      && current.activeSessionOrdinal === next.activeSessionOrdinal
    ) return
    patchWorkspaceSession((current) => ({ ...current, terminal: { ...current.terminal, ...next } }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateEditorSession = useCallback((next: WorkspaceSessionState['editor']) => {
    const current = workspaceSession.getSnapshot().state.editor
    if (JSON.stringify(current) === JSON.stringify(next)) return
    patchWorkspaceSession((state) => ({ ...state, editor: next }))
  }, [patchWorkspaceSession, workspaceSession])

  const refreshWorkspaceSessionForRecovery = useCallback(() => {
    const snapshot = workspaceSession.getSnapshot()
    if (snapshot.loaded) setWorkspaceSessionState(snapshot.state)
  }, [workspaceSession])

  const updateGitHubSession = useCallback((next: Pick<WorkspaceSessionState['github'], 'tab' | 'selectedDiffPath' | 'selectedProjectNumber' | 'issueStateFilter'>) => {
    const current = workspaceSession.getSnapshot().state.github
    if (current.tab === next.tab && current.selectedDiffPath === next.selectedDiffPath && current.selectedProjectNumber === next.selectedProjectNumber && current.issueStateFilter === next.issueStateFilter) return
    patchWorkspaceSession((state) => ({ ...state, github: { ...state.github, ...next } }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateDatabaseSession = useCallback((next: Pick<WorkspaceSessionState['database'], 'selectedConnectionId' | 'sidebarTab' | 'view' | 'expandedSchemaIds' | 'selectedTableName' | 'activeSavedQueryId'>) => {
    const current = workspaceSession.getSnapshot().state.database
    if (
      current.selectedConnectionId === next.selectedConnectionId
      && current.sidebarTab === next.sidebarTab
      && current.view === next.view
      && current.selectedTableName === next.selectedTableName
      && current.activeSavedQueryId === next.activeSavedQueryId
      && current.expandedSchemaIds.join('\0') === next.expandedSchemaIds.join('\0')
    ) return
    patchWorkspaceSession((state) => ({ ...state, database: { ...state.database, ...next } }))
  }, [patchWorkspaceSession, workspaceSession])

  const updateRedisSession = useCallback((next: WorkspaceSessionState['redis']) => {
    const current = workspaceSession.getSnapshot().state.redis
    if (
      current.selectedConnectionId === next.selectedConnectionId
      && current.databaseIndex === next.databaseIndex
      && current.view === next.view
      && current.typeFilter === next.typeFilter
      && current.inspectorTab === next.inspectorTab
    ) return
    patchWorkspaceSession((state) => ({ ...state, redis: next }))
  }, [patchWorkspaceSession, workspaceSession])

  return {
    flushUntilClean,
    patchWorkspaceSession,
    recoverWorkspaceSession,
    refreshWorkspaceSessionForRecovery,
    resetWorkspaceSession,
    restoreWorkspaceSession,
    setWorkspaceSessionRecovery,
    updateDatabaseSession,
    updateEditorSession,
    updateGitHubSession,
    updateRedisSession,
    updateTerminalSession,
    workspaceSession,
    workspaceSessionRecovery,
    workspaceSessionState,
  }
}

export type WorkspacePersistenceController = ReturnType<typeof useWorkspacePersistence>
