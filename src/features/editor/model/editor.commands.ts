import type { EditorWorkbenchRequest } from './editor.types'

export type EditorTabCloseCommand =
  | 'editorTab.close'
  | 'editorTab.closeOthers'
  | 'editorTab.closeRight'
  | 'editorTab.closeAll'

export function editorWorkbenchCycleDirection(request: EditorWorkbenchRequest): -1 | 1 | null {
  if (request.kind === 'next-tab') return 1
  if (request.kind === 'previous-tab') return -1
  return null
}

export function editorTabCloseTargets(command: ContextMenuAction['command'], tabIds: readonly string[], targetId: string): string[] | null {
  if (command === 'editorTab.close') return [targetId]
  if (command === 'editorTab.closeOthers') return tabIds.filter((tabId) => tabId !== targetId)
  if (command === 'editorTab.closeRight') {
    const targetIndex = tabIds.indexOf(targetId)
    return tabIds.slice(targetIndex + 1)
  }
  if (command === 'editorTab.closeAll') return [...tabIds]
  return null
}
