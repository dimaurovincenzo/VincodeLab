import { useCallback, useEffect, useRef, useState } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import type { LifecycleCloseDecision, LifecycleCloseRequest } from '@/bridge'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import type { WorkspaceChangeRequest, WorkspaceGuardScope } from '../model/app-controller.types'

type UseWorkspaceCloseGuardsOptions = {
  flushUntilClean: () => Promise<void>
  performWorkspaceChange: (request: WorkspaceChangeRequest) => Promise<void>
}

export function useWorkspaceCloseGuards({ flushUntilClean, performWorkspaceChange }: UseWorkspaceCloseGuardsOptions) {
  const [workspaceChangeRequest, setWorkspaceChangeRequest] = useState<WorkspaceChangeRequest | null>(null)
  const [savingBeforeWorkspaceChange, setSavingBeforeWorkspaceChange] = useState(false)
  const [lifecycleCloseRequest, setLifecycleCloseRequest] = useState<LifecycleCloseRequest | null>(null)
  const [savingBeforeLifecycleClose, setSavingBeforeLifecycleClose] = useState(false)
  const workspaceChangeGuards = useRef(new Map<WorkspaceGuardScope, WorkspaceChangeGuard>())
  const workspaceChangeGuard = useRef<WorkspaceChangeGuard>({
    hasUnsavedChanges: () => [...workspaceChangeGuards.current.values()].some((guard) => guard.hasUnsavedChanges()),
    saveAll: async () => {
      for (const guard of workspaceChangeGuards.current.values()) await guard.saveAll()
    },
    discardAll: async () => {
      for (const guard of workspaceChangeGuards.current.values()) await guard.discardAll()
    },
  })
  const activeLifecycleCloseRequest = useRef<LifecycleCloseRequest | null>(null)
  const lifecycleCloseOperation = useRef<string | null>(null)
  const respondedLifecycleCloseRequests = useRef(new Set<string>())

  const requestWorkspaceChange = useCallback((request: WorkspaceChangeRequest) => {
    if (activeLifecycleCloseRequest.current) return
    if (workspaceChangeGuard.current.hasUnsavedChanges()) {
      setWorkspaceChangeRequest(request)
      return
    }
    void performWorkspaceChange(request)
  }, [performWorkspaceChange])

  const openWorkspace = useCallback(() => requestWorkspaceChange({ kind: 'choose' }), [requestWorkspaceChange])
  const openRecentWorkspace = useCallback((workspacePath: string) => requestWorkspaceChange({ kind: 'recent', path: workspacePath }), [requestWorkspaceChange])

  const registerWorkspaceGuard = useCallback((scope: WorkspaceGuardScope, guard: WorkspaceChangeGuard | null) => {
    if (guard) workspaceChangeGuards.current.set(scope, guard)
    else workspaceChangeGuards.current.delete(scope)
  }, [])
  const handleEditorWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('editor', guard), [registerWorkspaceGuard])
  const handleSkillsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('skills', guard), [registerWorkspaceGuard])
  const handleInstructionsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('instructions', guard), [registerWorkspaceGuard])
  const handleDatabaseWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('database', guard), [registerWorkspaceGuard])
  const handleSettingsWorkspaceGuardChange = useCallback((guard: WorkspaceChangeGuard | null) => registerWorkspaceGuard('settings', guard), [registerWorkspaceGuard])
  const saveWorkspaceGuardScope = useCallback(async (scope: WorkspaceGuardScope) => {
    await workspaceChangeGuards.current.get(scope)?.saveAll()
  }, [])

  const saveAndChangeWorkspace = useCallback(async () => {
    const request = workspaceChangeRequest
    if (!request) return
    setSavingBeforeWorkspaceChange(true)
    try {
      await workspaceChangeGuard.current.saveAll()
      setWorkspaceChangeRequest(null)
      await performWorkspaceChange(request)
    } catch {
      // La sezione interessata mostra il dettaglio locale e il dialogo resta aperto.
    } finally {
      setSavingBeforeWorkspaceChange(false)
    }
  }, [performWorkspaceChange, workspaceChangeRequest])

  const discardAndChangeWorkspace = useCallback(async () => {
    const request = workspaceChangeRequest
    if (!request) return
    setSavingBeforeWorkspaceChange(true)
    try {
      await workspaceChangeGuard.current.discardAll()
      setWorkspaceChangeRequest(null)
      await performWorkspaceChange(request)
    } catch {
      // La guardia che non riesce a ripristinare mantiene il dialogo e mostra il dettaglio.
    } finally {
      setSavingBeforeWorkspaceChange(false)
    }
  }, [performWorkspaceChange, workspaceChangeRequest])

  const respondToLifecycleClose = useCallback((requestId: string, decision: LifecycleCloseDecision) => {
    if (respondedLifecycleCloseRequests.current.has(requestId)) return false
    respondedLifecycleCloseRequests.current.add(requestId)
    if (activeLifecycleCloseRequest.current?.requestId === requestId) {
      activeLifecycleCloseRequest.current = null
      lifecycleCloseOperation.current = null
    }
    setLifecycleCloseRequest((current) => current?.requestId === requestId ? null : current)
    appBridge.lifecycle.respondToClose(requestId, decision)
    return true
  }, [])

  const handleLifecycleCloseRequest = useCallback((request: LifecycleCloseRequest) => {
    if (respondedLifecycleCloseRequests.current.has(request.requestId)) return
    const activeRequest = activeLifecycleCloseRequest.current
    if (activeRequest?.requestId === request.requestId) return
    if (activeRequest) {
      // Il processo principale non dovrebbe sovrapporre richieste, ma una richiesta
      // diversa non deve sostituire il dialogo a cui l'utente sta già rispondendo.
      respondToLifecycleClose(request.requestId, 'cancel')
      return
    }

    activeLifecycleCloseRequest.current = request
    setWorkspaceChangeRequest(null)
    if (workspaceChangeGuard.current.hasUnsavedChanges()) {
      setLifecycleCloseRequest(request)
      return
    }

    lifecycleCloseOperation.current = request.requestId
    void flushUntilClean().then(() => {
      if (workspaceChangeGuard.current.hasUnsavedChanges()) {
        lifecycleCloseOperation.current = null
        setLifecycleCloseRequest(request)
        return
      }
      respondToLifecycleClose(request.requestId, 'proceed')
    }).catch(() => {
      // workspaceSession.onError mantiene il singolo avviso persistente con la recovery;
      // la chiusura viene soltanto annullata, senza duplicare lo stesso incidente in un toast.
      respondToLifecycleClose(request.requestId, 'cancel')
    }).finally(() => {
      if (lifecycleCloseOperation.current === request.requestId) lifecycleCloseOperation.current = null
    })
  }, [flushUntilClean, respondToLifecycleClose])

  useEffect(() => appBridge.lifecycle.onCloseRequested(handleLifecycleCloseRequest), [handleLifecycleCloseRequest])

  const cancelLifecycleClose = useCallback(() => {
    const request = activeLifecycleCloseRequest.current
    if (!request || lifecycleCloseOperation.current) return
    respondToLifecycleClose(request.requestId, 'cancel')
  }, [respondToLifecycleClose])

  const completeLifecycleClose = useCallback(async (action: 'save' | 'discard') => {
    const request = activeLifecycleCloseRequest.current
    if (!request || lifecycleCloseOperation.current) return
    lifecycleCloseOperation.current = request.requestId
    setSavingBeforeLifecycleClose(true)
    try {
      if (action === 'save') await workspaceChangeGuard.current.saveAll()
      else await workspaceChangeGuard.current.discardAll()
      await flushUntilClean()
      respondToLifecycleClose(request.requestId, 'proceed')
    } catch {
      // La guardia della sezione interessata (o workspaceSession.onError) possiede già
      // l'ErrorNotice locale; manteniamo aperta l'app senza una notifica globale duplicata.
      respondToLifecycleClose(request.requestId, 'cancel')
    } finally {
      if (lifecycleCloseOperation.current === request.requestId) lifecycleCloseOperation.current = null
      setSavingBeforeLifecycleClose(false)
    }
  }, [flushUntilClean, respondToLifecycleClose])

  return {
    cancelLifecycleClose,
    completeLifecycleClose,
    discardAndChangeWorkspace,
    handleDatabaseWorkspaceGuardChange,
    handleEditorWorkspaceGuardChange,
    handleInstructionsWorkspaceGuardChange,
    handleSettingsWorkspaceGuardChange,
    handleSkillsWorkspaceGuardChange,
    lifecycleCloseRequest,
    openRecentWorkspace,
    openWorkspace,
    requestWorkspaceChange,
    saveWorkspaceGuardScope,
    saveAndChangeWorkspace,
    savingBeforeLifecycleClose,
    savingBeforeWorkspaceChange,
    setWorkspaceChangeRequest,
    workspaceChangeRequest,
  }
}

export type WorkspaceCloseGuardsController = ReturnType<typeof useWorkspaceCloseGuards>
