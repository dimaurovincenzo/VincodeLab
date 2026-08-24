import type { GitFileStatus, GitStatus } from '@/bridge'

export function gitStatusMap(status: GitStatus) {
  const next = new Map<string, GitFileStatus>()
  for (const file of status.files) {
    next.set(file.path, file)
    if (file.previousPath) next.set(file.previousPath, file)
  }
  return next
}
