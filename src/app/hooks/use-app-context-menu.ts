import { useEffect } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import { WorkbenchCommandRegistry } from '@/lib/workbench-command-registry'
import type { WorkbenchCommandContext } from '../model/app-controller.types'
import { reportTransientFailure } from '../services/app-controller-errors'

type UseAppContextMenuOptions = {
  commandRegistry: WorkbenchCommandRegistry<WorkbenchCommandContext>
  openRecentWorkspace: (workspacePath: string) => void
  openWorkspaceInNewInstance: (workspacePath: string) => Promise<boolean>
}

export function useAppContextMenu({ commandRegistry, openRecentWorkspace, openWorkspaceInNewInstance }: UseAppContextMenuOptions) {
  useEffect(() => {
    const openContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const editor = target?.closest('input, textarea, [contenteditable="true"]') as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
      const isInput = editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
      const editable = Boolean(editor && (!isInput || (!editor.disabled && !editor.readOnly)))
      const fieldSelection = isInput && editor.selectionStart !== null && editor.selectionEnd !== null && editor.selectionEnd > editor.selectionStart
      const documentSelection = (window.getSelection()?.toString().length ?? 0) > 0
      const remoteTarget = target?.closest<HTMLElement>('[data-remote-context-id]')
      const remoteKind = remoteTarget?.dataset.remoteContextKind
      const workspaceTarget = target?.closest<HTMLElement>('[data-workspace-context-id]')
      const workspaceKind = workspaceTarget?.dataset.workspaceContextKind
      const genericTarget = target?.closest<HTMLElement>('[data-context-menu-kind]')
      const contextTarget = editable ? null : remoteTarget ?? workspaceTarget ?? genericTarget
      const contextKind = (editable ? undefined : remoteKind ?? workspaceKind ?? genericTarget?.dataset.contextMenuKind) as ContextMenuKind | undefined
      const contextId = editable
        ? undefined
        : remoteTarget?.dataset.remoteContextId ?? workspaceTarget?.dataset.workspaceContextId ?? genericTarget?.dataset.contextMenuId
      const commandStates = commandRegistry.list()
      const enabledCommands = commandStates.length > 0
        ? commandStates.filter(({ enabled }) => enabled).map(({ command }) => command.id as AppMenuCommand)
        : undefined
      event.preventDefault()
      const request = {
        kind: contextKind ?? (target?.closest('.xterm') ? 'terminal' : 'default'),
        editable,
        hasSelection: fieldSelection || documentSelection,
        ...(contextId !== undefined ? { contextId } : {}),
        ...(enabledCommands ? { enabledCommands } : {}),
        contextFlags: {
          expanded: contextTarget?.dataset.contextExpanded === 'true',
          cancellable: contextTarget?.dataset.contextCancellable === 'true',
          retryable: contextTarget?.dataset.contextRetryable === 'true',
          dirty: contextTarget?.dataset.contextDirty === 'true',
          hasOtherTabs: contextTarget?.dataset.contextHasOtherTabs === 'true',
          hasRightTabs: contextTarget?.dataset.contextHasRightTabs === 'true',
          stageable: contextTarget?.dataset.contextStageable === 'true',
          operable: contextTarget?.dataset.contextOperable === 'true',
          canCreate: contextTarget?.dataset.contextCanCreate === 'true',
          hasVisibleValue: contextTarget?.dataset.contextHasVisibleValue === 'true',
        },
      }
      const requestContextMenu = () => {
        void appBridge.contextMenu.open(request).catch((nextError) => {
          reportTransientFailure(nextError, {
            component: 'context-menu',
            operation: 'open-context-menu',
            title: 'Menu contestuale non aperto',
            description: 'La selezione è rimasta invariata. Puoi riprovare oppure usare la palette comandi.',
          }, { label: 'Riprova', onClick: requestContextMenu })
        })
      }
      requestContextMenu()
    }
    document.addEventListener('contextmenu', openContextMenu)
    return () => document.removeEventListener('contextmenu', openContextMenu)
  }, [commandRegistry])

  useEffect(() => appBridge.contextMenu?.onAction?.((action) => {
    if (action.contextKind !== 'recent-workspace' || !action.contextId) return
    if (action.command === 'recentWorkspace.open') openRecentWorkspace(action.contextId)
    if (action.command === 'recentWorkspace.openNew') void openWorkspaceInNewInstance(action.contextId)
  }) ?? (() => undefined), [openRecentWorkspace, openWorkspaceInNewInstance])
}
