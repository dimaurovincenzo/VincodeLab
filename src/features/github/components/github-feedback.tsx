import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { ErrorNotice } from '@/components/ui'
import type { UserError } from '@/lib/user-error'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'

type LimitNoticeProps = {
  children: ReactNode
  className?: string
}

type GitHubErrorNoticeProps = {
  error?: UserError
  label: string
  onClick: () => void | Promise<void>
}

export function LimitNotice({ children, className }: LimitNoticeProps) {
  return <p className={cx(gh.limitNotice, className)} role="status"><TriangleAlert aria-hidden="true" size={14} /><span>{children}</span></p>
}

export function GitHubErrorNotice({ error, label, onClick }: GitHubErrorNoticeProps) {
  return error ? <ErrorNotice action={{ label, onClick }} error={error} /> : null
}
