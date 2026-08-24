import { useCallback, useEffect, useRef, useState } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import { toast } from '@/components/ui'
import type { AiSessionFailure, LaunchState } from '@/features/ai'
import { setAppPreferencesWorkspace } from '@/lib/app-preferences'
import { reportRendererFailure, reportTransientFailure } from '@/lib/renderer-error'
import { normalizeUserError } from '@/lib/user-error'
import type { HomeFailure, WorkspaceChangeRequest, WorkspaceOpenFailure } from '../model/app-controller.types'
import { reportWorkspaceResultError } from '../services/app-controller-errors'
import type { AppNavigationController } from './use-app-navigation'
import type { WorkspacePersistenceController } from './use-workspace-persistence'

export function useWorkspaceLifecycleState() {
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentWorkspace[]>([])
  const [openingWorkspacePath, setOpeningWorkspacePath] = useState<string | null>(null)
  const [workspaceOpenFailure, setWorkspaceOpenFailure] = useState<WorkspaceOpenFailure | null>(null)
  const [status, setStatus] = useState<LaunchState>('idle')
  const [homeFailure, setHomeFailure] = useState<HomeFailure | null>(null)
  const workspaceOpenGeneration = useRef(0)
  // Tutte le richieste sovrapposte condividono lo stato precedente alla prima:
  // un completamento superato non può lasciare la UI in stato “in avvio”.
  const workspaceStateBeforeOpen = useRef<{ status: LaunchState; homeFailure: HomeFailure | null; aiFailure: AiSessionFailure | null } | null>(null)

  const beginWorkspaceOpen = useCallback((snapshot: { status: LaunchState; homeFailure: HomeFailure | null; aiFailure: AiSessionFailure | null }) => {
    workspaceOpenGeneration.current += 1
    workspaceStateBeforeOpen.current ??= snapshot
    return workspaceOpenGeneration.current
  }, [])
  const clearWorkspaceStateBeforeOpen = useCallback(() => { workspaceStateBeforeOpen.current = null }, [])
  const currentWorkspaceOpenGeneration = useCallback(() => workspaceOpenGeneration.current, [])
  const invalidateWorkspaceOpen = useCallback(() => { workspaceOpenGeneration.current += 1 }, [])
  const isCurrentWorkspaceOpen = useCallback((operationId: number) => operationId === workspaceOpenGeneration.current, [])
  const takeWorkspaceStateBeforeOpen = useCallback(() => {
    const previous = workspaceStateBeforeOpen.current
    workspaceStateBeforeOpen.current = null
    return previous
  }, [])

  return {
    beginWorkspaceOpen,
    clearWorkspaceStateBeforeOpen,
    currentWorkspaceOpenGeneration,
    homeFailure,
    invalidateWorkspaceOpen,
    isCurrentWorkspaceOpen,
    openingWorkspacePath,
    recents,
    setHomeFailure,
    setOpeningWorkspacePath,
    setRecents,
    setStatus,
    setWorkspace,
    setWorkspaceOpenFailure,
    status,
    takeWorkspaceStateBeforeOpen,
    workspace,
    workspaceOpenFailure,
  }
}

type UseWorkspaceLifecycleOptions = {
  aiFailure: AiSessionFailure | null
  clearAiFailure: (operation?: string) => void
  lifecycleState: ReturnType<typeof useWorkspaceLifecycleState>
  loadAiTerminalPreferences: (workspacePath: string) => void
  publishAiFailure: (cause: unknown, context: {
    fallbackDescription: string
    operation: string
    preserved: string
    recovery: 'restart'
    title: string
  }) => AiSessionFailure
  resetCommandSurfaceForWorkspace: () => void
  resetNavigationForWorkspace: AppNavigationController['resetForWorkspace']
  resetWorkspaceSession: WorkspacePersistenceController['resetWorkspaceSession']
  restoreAiFailure: (failure: AiSessionFailure | null) => void
  restoreNavigation: AppNavigationController['restoreNavigation']
  restoreWorkspaceSession: WorkspacePersistenceController['restoreWorkspaceSession']
  setWorkspaceSessionRecovery: WorkspacePersistenceController['setWorkspaceSessionRecovery']
  updateHasUnreadTerminalOutput: (nextValue: boolean) => void
  updateTerminalStreamState: (nextState: TerminalStreamState | null) => void
  workspaceSession: WorkspacePersistenceController['workspaceSession']
}

function workspaceName(workspacePath: string) {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}

export function useWorkspaceLifecycle({
  aiFailure,
  clearAiFailure,
  lifecycleState,
  loadAiTerminalPreferences,
  publishAiFailure,
  resetCommandSurfaceForWorkspace,
  resetNavigationForWorkspace,
  resetWorkspaceSession,
  restoreAiFailure,
  restoreNavigation,
  restoreWorkspaceSession,
  setWorkspaceSessionRecovery,
  updateHasUnreadTerminalOutput,
  updateTerminalStreamState,
  workspaceSession,
}: UseWorkspaceLifecycleOptions) {
  const {
    beginWorkspaceOpen,
    clearWorkspaceStateBeforeOpen,
    currentWorkspaceOpenGeneration,
    homeFailure,
    invalidateWorkspaceOpen,
    isCurrentWorkspaceOpen,
    setHomeFailure,
    setOpeningWorkspacePath,
    setRecents,
    setStatus,
    setWorkspace,
    setWorkspaceOpenFailure,
    status,
    takeWorkspaceStateBeforeOpen,
    workspace,
  } = lifecycleState

  const refreshRecents = useCallback(async () => {
    try {
      setRecents(await appBridge.workspace.listRecent())
      setHomeFailure(null)
    } catch (nextError) {
      const incident = reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-home',
        operation: 'list-recent-workspaces',
        title: 'Workspace recenti non disponibili',
        description: 'Puoi comunque scegliere una cartella oppure aggiornare nuovamente l’elenco.',
      })
      setHomeFailure({ error: incident, recovery: 'refresh-recents' })
    }
  }, [setHomeFailure, setRecents])

  const restoreWorkspaceStateBeforeOpen = useCallback(() => {
    const previous = takeWorkspaceStateBeforeOpen()
    if (!previous) return
    setStatus(previous.status)
    setHomeFailure(previous.homeFailure)
    restoreAiFailure(previous.aiFailure)
  }, [restoreAiFailure, setHomeFailure, setStatus, takeWorkspaceStateBeforeOpen])

  const handleWorkspaceResult = useCallback((result: WorkspaceOpenResult | null, announce = true) => {
    setOpeningWorkspacePath(null)
    setWorkspaceOpenFailure(null)
    if (!result) {
      restoreWorkspaceStateBeforeOpen()
      return
    }
    clearWorkspaceStateBeforeOpen()
    const workspaceIncident = result.path
      ? null
      : reportWorkspaceResultError(result, 'Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')
    if (workspaceIncident && !result.path) {
      setStatus('error')
      setHomeFailure({ error: workspaceIncident, recovery: 'open-workspace' })
      return
    }

    clearAiFailure()
    const startFailure = result.path && result.error
      ? publishAiFailure(result.errorIncident ?? new Error(result.error), {
          operation: 'start-ai-session',
          preserved: 'Il workspace è aperto e gli strumenti locali restano disponibili.',
          recovery: 'restart',
          title: 'Sessione AI non disponibile',
          fallbackDescription: 'Non è stato possibile avviare la sessione AI.',
        })
      : null

    if (result.path) {
      setAppPreferencesWorkspace(result.path)
      loadAiTerminalPreferences(result.path)
    }
    updateHasUnreadTerminalOutput(false)
    updateTerminalStreamState(null)
    setWorkspace(result.path ?? null)
    resetNavigationForWorkspace()
    resetCommandSurfaceForWorkspace()
    resetWorkspaceSession()
    setStatus(startFailure ? 'error' : 'running')
    setHomeFailure(null)
    if (result.path) void restoreWorkspaceSession(restoreNavigation)
    if (announce && !startFailure) {
      toast.success('Terminale AI avviato', { description: result.path ? workspaceName(result.path) : undefined })
    }
    void refreshRecents()
  }, [clearAiFailure, clearWorkspaceStateBeforeOpen, loadAiTerminalPreferences, publishAiFailure, refreshRecents, resetCommandSurfaceForWorkspace, resetNavigationForWorkspace, resetWorkspaceSession, restoreNavigation, restoreWorkspaceSession, restoreWorkspaceStateBeforeOpen, setHomeFailure, setOpeningWorkspacePath, setStatus, setWorkspace, setWorkspaceOpenFailure, updateHasUnreadTerminalOutput, updateTerminalStreamState])

  const reportWorkspaceOpenFailure = useCallback((request: WorkspaceChangeRequest, error: WorkspaceOpenFailure['error']) => {
    restoreWorkspaceStateBeforeOpen()
    setOpeningWorkspacePath(null)
    setWorkspaceOpenFailure({ request, error })
  }, [restoreWorkspaceStateBeforeOpen, setOpeningWorkspacePath, setWorkspaceOpenFailure])

  const performWorkspaceChange = useCallback(async (request: WorkspaceChangeRequest) => {
    const operationId = beginWorkspaceOpen({ status, homeFailure, aiFailure })
    setWorkspaceOpenFailure(null)
    setStatus('launching')
    setHomeFailure(null)
    clearAiFailure()
    setOpeningWorkspacePath(request.kind === 'recent' ? request.path : null)
    if (workspace) {
      try {
        await workspaceSession.flush()
      } catch (nextError) {
        if (isCurrentWorkspaceOpen(operationId)) {
          setWorkspaceSessionRecovery({
            error: normalizeUserError(nextError, {
              category: 'persistence',
              component: 'workspace-shell',
              operation: 'save-layout-before-workspace-change',
              severity: 'warning',
              title: 'Cambio workspace sospeso',
              description: 'Il layout corrente non è stato salvato. File e modifiche sono rimasti al sicuro; salva il layout e riprova il cambio workspace.',
            }),
            kind: 'persistence',
          })
          restoreWorkspaceStateBeforeOpen()
          setOpeningWorkspacePath(null)
          return
        }
      }
    }
    if (!isCurrentWorkspaceOpen(operationId)) return
    try {
      const result = request.kind === 'recent'
        ? await appBridge.workspace.openRecent(request.path)
        : await appBridge.workspace.open()
      if (!isCurrentWorkspaceOpen(operationId)) return
      if (result?.error && !result.path) {
        const incident = reportWorkspaceResultError(result, 'Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')
        reportWorkspaceOpenFailure(request, incident ?? reportRendererFailure(new Error('Workspace non aperto.'), {
          component: 'workspace-shell',
          operation: 'open-workspace',
          title: 'Workspace non aperto',
          description: 'Il workspace precedente è rimasto disponibile. Puoi riprovare.',
        }))
        return
      }
      handleWorkspaceResult(result)
    } catch (nextError) {
      if (!isCurrentWorkspaceOpen(operationId)) return
      const incident = reportRendererFailure(nextError, {
        component: 'workspace-shell',
        operation: 'open-workspace',
        title: 'Workspace non aperto',
        fallbackDescription: 'Il servizio workspace non ha completato la richiesta. Il workspace precedente è rimasto aperto.',
      })
      reportWorkspaceOpenFailure(request, incident)
    } finally {
      if (isCurrentWorkspaceOpen(operationId)) setOpeningWorkspacePath(null)
    }
  }, [aiFailure, beginWorkspaceOpen, clearAiFailure, handleWorkspaceResult, homeFailure, isCurrentWorkspaceOpen, reportWorkspaceOpenFailure, restoreWorkspaceStateBeforeOpen, setHomeFailure, setOpeningWorkspacePath, setStatus, setWorkspaceOpenFailure, setWorkspaceSessionRecovery, status, workspace, workspaceSession])

  const revealWorkspace = useCallback(async function revealWorkspaceAction() {
    try {
      await appBridge.workspace.reveal()
    } catch (nextError) {
      reportTransientFailure(nextError, {
        component: 'workspace-shell',
        operation: 'reveal-workspace',
        title: 'Workspace non mostrato nel Finder',
        description: 'Il workspace è rimasto aperto e puoi continuare a lavorare. Verifica che la cartella sia ancora accessibile e riprova.',
      }, { label: 'Riprova', onClick: () => { void revealWorkspaceAction() } })
    }
  }, [])

  const openWorkspaceInNewInstance = useCallback(async function openWorkspaceInNewInstanceAction(workspacePath: string) {
    try {
      const result = await appBridge.workspace.openInNewInstance(workspacePath)
      if (!result.launched) {
        const refusalCode = result.reason ? `WORKSPACE_NEW_INSTANCE_${result.reason.replaceAll('-', '_').toUpperCase()}` : 'WORKSPACE_NEW_INSTANCE_REFUSED'
        reportTransientFailure(new Error(`Workspace new instance refused: ${result.reason ?? 'unknown'} [${refusalCode}]`), {
          code: refusalCode,
          component: 'workspace-switcher',
          operation: 'open-workspace-new-window',
          title: 'Nuova finestra non aperta',
          description: 'Il workspace è rimasto disponibile in questa finestra. Puoi riprovare senza interrompere il lavoro corrente.',
        }, { label: 'Riprova', onClick: () => { void openWorkspaceInNewInstanceAction(workspacePath) } })
        return false
      }
      toast.success('Workspace aperto in una nuova finestra.', { description: workspacePath })
      return true
    } catch (nextError) {
      reportTransientFailure(nextError, {
        component: 'workspace-switcher',
        operation: 'open-workspace-new-window',
        title: 'Nuova finestra non aperta',
        description: 'Il workspace è rimasto disponibile in questa finestra. Puoi riprovare senza interrompere il lavoro corrente.',
      }, { label: 'Riprova', onClick: () => { void openWorkspaceInNewInstanceAction(workspacePath) } })
      return false
    }
  }, [])

  useEffect(() => {
    let active = true
    void appBridge.workspace.listRecent().then((recentWorkspaces) => {
      if (active) setRecents(recentWorkspaces)
    }).catch((nextError) => {
      if (!active) return
      const incident = reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-home',
        operation: 'list-recent-workspaces',
        title: 'Workspace recenti non disponibili',
        fallbackDescription: 'Puoi comunque scegliere una cartella e continuare.',
      })
      setHomeFailure({ error: incident, recovery: 'refresh-recents' })
    })
    return () => { active = false }
  }, [setHomeFailure, setRecents])

  useEffect(() => {
    let active = true
    const operationId = currentWorkspaceOpenGeneration()
    void appBridge.workspace.getActive().then((result) => {
      if (active && isCurrentWorkspaceOpen(operationId) && result?.path) handleWorkspaceResult(result, false)
    }).catch((nextError) => {
      if (!active || !isCurrentWorkspaceOpen(operationId)) return
      const incident = reportRendererFailure(nextError, {
        category: 'persistence',
        component: 'workspace-home',
        operation: 'restore-active-workspace',
        severity: 'warning',
        title: 'Workspace precedente non ripristinato',
        description: 'La Home resta disponibile e nessun file è stato modificato. Scegli una cartella per continuare.',
      })
      setHomeFailure({ error: incident, recovery: 'open-workspace' })
    })
    return () => { active = false }
  }, [currentWorkspaceOpenGeneration, handleWorkspaceResult, isCurrentWorkspaceOpen, setHomeFailure])

  useEffect(() => appBridge.workspace.onOpened((result) => {
    invalidateWorkspaceOpen()
    handleWorkspaceResult(result)
  }), [handleWorkspaceResult, invalidateWorkspaceOpen])

  return {
    handleWorkspaceResult,
    openWorkspaceInNewInstance,
    performWorkspaceChange,
    refreshRecents,
    revealWorkspace,
  }
}

export type WorkspaceLifecycleController = ReturnType<typeof useWorkspaceLifecycle>
