import type { ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { Button, ErrorNotice, Spinner } from '@/components/ui'
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

export function GitHubDataState({ busy, error, onRefresh }: { busy: boolean; error?: UserError; onRefresh: () => void }) {
  return <section aria-live="polite" className={cx(gh.panel, gh.liveState)}>{busy ? <p className={cx(gh.muted, gh.inlineLoading)}><Spinner size={15} /> Caricamento dati GitHub…</p> : error ? <ErrorNotice action={{ label: 'Riprova caricamento GitHub', onClick: onRefresh }} error={error} /> : <><p className={gh.muted}>I dati GitHub non sono ancora disponibili.</p><Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw size={14} /> Riprova caricamento GitHub</Button></>}</section>
}
