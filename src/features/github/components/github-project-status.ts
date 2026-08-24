import { githubProjectStatus } from '@/theme/styles/github'
import { githubProjectStatusTone } from '../model/github-project-status.js'

export function projectStatusClass(status: unknown) {
  return githubProjectStatus({ tone: githubProjectStatusTone(status) })
}
