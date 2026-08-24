import { CircleDot, X } from 'lucide-react'
import { Button, Dialog, Field, IconButton } from '@/components/ui'
import { MarkdownPreview } from '@/components/markdown-preview'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import { formatDate } from '../model/github-display'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'

export function GitHubIssueDialogs({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, errors, recoveries, state } = controller
  const { issueComposerTrigger, issueDetailTrigger, issueTitleInput } = controller.elements

  return <>
    <Dialog.Root finalFocusEl={() => issueComposerTrigger.current} ids={{ title: 'github-issue-create-title' }} initialFocusEl={() => issueTitleInput.current} lazyMount open={state.issueComposerOpen} onOpenChange={({ open }) => state.setIssueComposerOpen(open)}>
      <Dialog.Portal><Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className={cx(gh.modalContent, gh.issueModal)}>
            <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Repository del workspace</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-issue-create-title">Nuova issue</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi creazione issue"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
            <GitHubErrorNotice error={errors.surfaceErrors.issues} label="Aggiorna issue" onClick={() => recoveries.refreshGitHubAfterFailure('issues')} />
            <div className={gh.issueForm}>
              <Field.Root id="github-new-issue-title"><Field.Label>Titolo</Field.Label><Field.Input ref={issueTitleInput} id="github-new-issue-title" value={state.issueTitle} onChange={(event) => state.setIssueTitle(event.target.value)} maxLength={256} placeholder="Descrivi il problema o l’attività" /></Field.Root>
              <Field.Root id="github-new-issue-body"><Field.Label>Descrizione</Field.Label><Field.Textarea className={gh.issueBody} id="github-new-issue-body" value={state.issueBody} onChange={(event) => state.setIssueBody(event.target.value)} maxLength={65_536} placeholder="Contesto, comportamento atteso e dettagli utili (Markdown)" /></Field.Root>
            </div>
            <footer className={gh.modalFooter}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={state.busy || !state.issueTitle.trim()} onClick={() => void actions.createIssue()}><CircleDot /> Crea issue</Button></footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
    {state.selectedIssue && <Dialog.Root finalFocusEl={() => issueDetailTrigger.current} ids={{ title: 'github-issue-modal-title' }} open={state.issueDetailOpen} onOpenChange={({ open }) => state.setIssueDetailOpen(open)} onExitComplete={() => { if (!state.issueDetailOpen) state.setSelectedIssue(null) }}>
      <Dialog.Portal><Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className={cx(gh.modalContent, gh.itemModal)}>
            <header className={gh.modalHeader}><div><p className={gh.modalEyebrow}>Issue del workspace</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-issue-modal-title">#{state.selectedIssue.number} {state.selectedIssue.title}</h3></Dialog.Title></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi dettaglio issue"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
            <div className={gh.itemMeta}><span className={gh.metaBadge}>{state.selectedIssue.state === 'OPEN' ? 'Aperta' : 'Chiusa'}</span><span className={gh.metaBadge}>{state.selectedIssue.author?.login ?? 'Autore sconosciuto'}</span><span className={gh.metaBadge}>Aggiornata {formatDate(state.selectedIssue.updatedAt)}</span>{state.selectedIssue.labels.map((label) => <span className={gh.metaBadge} key={label.name}>{label.name}</span>)}</div>
            {state.selectedIssue.labelsHasMore && <LimitNotice>Etichette limitate: questa issue contiene altre etichette.</LimitNotice>}
            <section className={gh.itemContent}><h4 className={gh.itemContentTitle}>Descrizione</h4>{state.selectedIssue.body ? <MarkdownPreview source={state.selectedIssue.body} /> : <p className={gh.muted}>Nessuna descrizione disponibile per questa issue.</p>}</section>
            {state.selectedIssue.bodyTruncated && <LimitNotice>Descrizione abbreviata: apri la issue su GitHub per leggere il contenuto completo.</LimitNotice>}
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>}
  </>
}
