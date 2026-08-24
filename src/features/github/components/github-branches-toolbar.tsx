import { ChevronRight, GitBranch, Plus } from 'lucide-react'
import { Button, Collapsible, Field, SelectField } from '@/components/ui'
import { githubStyles as gh } from '@/theme/styles/github'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { LimitNotice } from './github-feedback'

export function GitHubBranchesToolbar({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, derived, state } = controller
  const status = state.status
  if (!status) return null

  return <section aria-label="Gestione branch" className={gh.branchToolbar}>
    <div className={gh.currentBranch}>
      <GitBranch className={gh.branchIcon} size={15} />
      <div className={gh.branchSelect}>
        <SelectField
          id="github-active-branch"
          label="Branch"
          disabled={state.busy}
          options={derived.branches.map((branch) => ({ label: branch.name, value: branch.name }))}
          value={status.branch}
          onValueChange={actions.switchBranch}
        />
      </div>
      <span className={gh.branchUpstream}>{status.upstream ?? 'Solo locale'}</span>
      {derived.branchesLimited && <LimitNotice className={gh.limitNoticeInline}>Elenco branch limitato ai primi {derived.branches.length} risultati; il branch attivo resta incluso.</LimitNotice>}
    </div>
    <Collapsible.Root className={gh.branchActions}>
      <Collapsible.Trigger className={gh.branchActionsTrigger}>Gestisci branch e remote<Collapsible.Indicator><ChevronRight aria-hidden="true" size={13} /></Collapsible.Indicator></Collapsible.Trigger>
      <Collapsible.Content className={gh.branchActionsPanel}><div className={gh.branchActionsContent}>
        <div className={gh.createBranch}>
          <Field.Root className={gh.growField}>
            <Field.Input aria-label="Nome del nuovo branch" value={state.branchName} maxLength={255} placeholder="Nome nuovo branch" onChange={(event) => state.setBranchName(event.target.value)} />
          </Field.Root>
          <Button size="sm" variant="outline" disabled={state.busy || !state.branchName.trim()} onClick={actions.createBranch}><Plus /> Crea branch</Button>
        </div>
        {!status.remote && <>
          <div className={gh.remoteForm}>
            <Field.Root id="github-repository-name">
              <Field.Label>Crea repository GitHub</Field.Label>
              <Field.Input id="github-repository-name" value={state.githubRepositoryName} maxLength={200} placeholder="nome-repository" onChange={(event) => state.setGitHubRepositoryName(event.target.value)} />
            </Field.Root>
            <div className={gh.remoteControls}>
              <div className={gh.remoteVisibility}>
                <SelectField
                  id="github-repository-visibility"
                  aria-label="Visibilità del repository"
                  options={[{ label: 'Privato', value: 'private' }, { label: 'Pubblico', value: 'public' }]}
                  value={state.githubRepositoryVisibility}
                  onValueChange={(value) => state.setGitHubRepositoryVisibility(value as 'private' | 'public')}
                />
              </div>
              <Button size="sm" disabled={state.busy || !state.githubRepositoryName.trim() || status.commits.length === 0} onClick={actions.createGitHubRepository}>Crea e pubblica</Button>
            </div>
          </div>
          <Field.Root className={gh.remoteForm} id="github-remote-url">
            <Field.Label>Collega repository esistente</Field.Label>
            <div className={gh.remoteControls}>
              <Field.Input id="github-remote-url" aria-describedby="github-remote-help" value={state.remoteUrl} maxLength={2_048} placeholder="https://github.com/utente/repository.git" onChange={(event) => state.setRemoteUrl(event.target.value)} />
              <Button size="sm" variant="outline" disabled={state.busy || !state.remoteUrl.trim()} onClick={actions.addRemote}>Collega</Button>
            </div>
            <Field.HelperText id="github-remote-help">Sono accettati URL GitHub HTTPS o SSH.</Field.HelperText>
          </Field.Root>
        </>}
      </div></Collapsible.Content>
    </Collapsible.Root>
  </section>
}
