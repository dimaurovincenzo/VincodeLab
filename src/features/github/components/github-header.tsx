import { ArrowDown, ArrowDownToLine, ArrowUp, CloudDownload, CloudUpload, GitFork, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { githubStyles as gh } from '@/theme/styles/github'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { LimitNotice } from './github-feedback'

export function GitHubHeader({ controller }: { controller: GitHubWorkspaceController }) {
  const { dataController, derived, state } = controller
  const { fetchRemote, pullRemote, pushRemote } = controller.actions
  const status = state.status
  if (!status) return null

  return <header className={gh.header}>
    <div className={gh.repositorySummary}>
      <h1 className={gh.pageTitle}><GitFork aria-hidden="true" size={18} /> Git del workspace</h1>
      <div className={gh.repositoryContext}>
        <p className={gh.headerDescription}><strong>Branch attivo</strong> {status.branch}{status.upstream ? ` · ${status.upstream}` : status.remote ? ` · ${status.remote} non associato al branch` : ' · nessun remote configurato'}</p>
        <div aria-label="Stato del repository" className={gh.metrics}>
          <span className={gh.metric}><strong>{status.files.length}{derived.filesLimited ? '+' : ''}</strong> modifiche</span>
          <span className={gh.metric} title="Commit locali non ancora pubblicati"><ArrowUp aria-hidden="true" size={11} /> {status.ahead ?? 0}</span>
          <span className={gh.metric} title="Commit disponibili sul remoto"><ArrowDown aria-hidden="true" size={11} /> {status.behind ?? 0}</span>
        </div>
      </div>
    </div>
    <div className={gh.headerActions}>{derived.activeLimitMessage && <LimitNotice className={gh.limitNoticeInline}>{derived.activeLimitMessage}</LimitNotice>}{derived.cacheState && <span aria-live="polite" className={gh.cacheState({ stale: derived.activeCache?.stale })}>{derived.cacheState}</span>}<Button variant="outline" size="sm" disabled={state.busy} onClick={() => void (state.tab === 'changes' ? dataController.refreshGit(true) : dataController.refreshGitHub(true))}><RefreshCw /> Aggiorna</Button>{state.tab === 'changes' && <><Button variant="outline" size="sm" title={!status.remote ? 'Collega un repository GitHub prima di verificare gli aggiornamenti remoti' : 'Git fetch: controlla gli aggiornamenti senza modificare il branch'} disabled={state.busy || !status.remote} onClick={fetchRemote}><CloudDownload /> Verifica remoto</Button><Button variant="outline" size="sm" title={!status.upstream ? 'Pubblica e associa il branch prima di integrare aggiornamenti' : 'Git pull --rebase: scarica e integra gli aggiornamenti'} disabled={state.busy || !status.upstream} onClick={pullRemote}><ArrowDownToLine /> Integra</Button><Button size="sm" title={!status.remote ? 'Collega o crea un repository GitHub dalla scheda Modifiche per pubblicare e sincronizzare il branch.' : status.upstream ? 'Git push: pubblica i commit locali' : 'Git push --set-upstream: pubblica e collega il branch'} disabled={state.busy || !status.remote || !status.ahead} onClick={pushRemote}><CloudUpload /> Pubblica</Button></>}</div>
  </header>
}
