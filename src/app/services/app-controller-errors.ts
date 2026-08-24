import type { WorkspaceOpenResult } from '@/bridge'
import { reportRendererFailure } from '@/lib/renderer-error'

export function reportWorkspaceResultError(result: WorkspaceOpenResult, fallback: string) {
  if (!result.error) return null
  return reportRendererFailure(result.errorIncident ?? new Error(result.error), {
    component: 'workspace-shell',
    operation: result.path ? 'start-ai-session' : 'open-workspace',
    title: result.path ? 'Sessione AI non disponibile' : 'Workspace non aperto',
    fallbackDescription: fallback,
  })
}
