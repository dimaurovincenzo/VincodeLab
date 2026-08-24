import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError } from '@/lib/user-error'

export const externalFileConflictCode = 'FILESYSTEM_EXTERNAL_CONFLICT'
export const gitStatusWarningToastId = 'project-editor:git-status-warning'
export const createdFileExplorerWarningToastId = 'project-editor:created-file-explorer-warning'

export function isExternalFileConflict(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && error.code === externalFileConflictCode) return true
  return normalizeUserError(error, { component: 'project-editor', operation: 'detect-file-conflict' }).code === externalFileConflictCode
}

export function reportEditorFailure(error: unknown, options: Parameters<typeof normalizeUserError>[1]) {
  return reportUserError(normalizeUserError(error, { component: 'project-editor', ...options }))
}

export function showGitStatusWarning(
  error: unknown,
  options: Pick<NonNullable<Parameters<typeof normalizeUserError>[1]>, 'fallbackDescription' | 'operation' | 'title'>,
  onRefresh: () => void,
) {
  const incident = reportEditorFailure(error, {
    ...options,
    category: 'git',
    severity: 'warning',
  })
  toast.warning(incident.title, {
    action: { label: 'Aggiorna', onClick: onRefresh },
    description: `${incident.description} Riferimento ${incident.correlationId}.`,
    id: gitStatusWarningToastId,
  })
}
