import { githubProjectStatusTone } from '@/lib/github-project-status.js'
import { githubProjectStatus } from '@/theme/styles/github'

export function projectStatusClass(status: unknown) {
  return githubProjectStatus({ tone: githubProjectStatusTone(status) })
}
