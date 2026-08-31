import { useMemo, useRef, useState } from 'react'
import { CircleDot, FilePlus2, Plus, X } from 'lucide-react'
import { Button, Dialog, Field, IconButton, SelectField, Tabs } from '@/components/ui'
import { githubStyles as gh } from '@/theme/styles/github'
import { cx } from '../../../../styled-system/css'
import type { GitHubWorkspaceController } from '../hooks/use-github-workspace-controller'
import { GitHubErrorNotice, LimitNotice } from './github-feedback'

type ComposerMode = 'issue' | 'draft'

export function GitHubProjectItemComposer({ controller }: { controller: GitHubWorkspaceController }) {
  const { actions, errors, recoveries, state } = controller
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<ComposerMode>('issue')
  const [issueUrl, setIssueUrl] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const draftTitleInput = useRef<HTMLInputElement>(null)

  const availableIssues = useMemo(() => {
    const boardIssueUrls = new Set(state.board?.items.map((item) => item.content?.url).filter(Boolean))
    const boardIssueNumbers = new Set(state.board?.items.map((item) => item.content?.number).filter((number): number is number => typeof number === 'number'))
    return (state.data?.issues ?? []).filter((issue) => !boardIssueUrls.has(issue.url) && !boardIssueNumbers.has(issue.number))
  }, [state.board?.items, state.data?.issues])

  const selectedIssueUrl = availableIssues.some((issue) => issue.url === issueUrl) ? issueUrl : availableIssues[0]?.url ?? ''

  const closeAndReset = () => {
    setOpen(false)
    setMode('issue')
    setDraftTitle('')
    setDraftBody('')
    errors.clearSurfaceError('project-item-create')
  }

  const submit = async () => {
    const succeeded = mode === 'issue'
      ? await actions.addIssueToBoard(selectedIssueUrl)
      : await actions.createBoardDraft(draftTitle, draftBody)
    if (succeeded) closeAndReset()
  }

  return <>
    <Button ref={trigger} size="sm" onClick={() => setOpen(true)}><Plus aria-hidden="true" size={15} /> Aggiungi attività</Button>
    <Dialog.Root
      finalFocusEl={() => trigger.current}
      initialFocusEl={() => mode === 'draft' ? draftTitleInput.current : document.getElementById('github-project-issue-select')}
      ids={{ title: 'github-project-item-create-title' }}
      lazyMount
      open={open}
      onOpenChange={({ open: nextOpen }) => { if (nextOpen) setOpen(true); else closeAndReset() }}
    >
      <Dialog.Portal><Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content className={cx(gh.modalContent, gh.projectComposerModal)}>
            <header className={gh.modalHeader}>
              <div><p className={gh.modalEyebrow}>Project attivo</p><Dialog.Title asChild><h3 className={gh.modalTitle} id="github-project-item-create-title">Aggiungi attività</h3></Dialog.Title></div>
              <Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi aggiunta attività"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger>
            </header>
            <Dialog.Description className={gh.projectComposerDescription}>Collega una issue del repository oppure crea una bozza direttamente nella board.</Dialog.Description>
            <GitHubErrorNotice error={errors.surfaceErrors['project-item-create']} label="Ricarica board" onClick={recoveries.retryProjectItemCreate} />
            <Tabs.Root value={mode} onValueChange={({ value }) => { setMode(value as ComposerMode); errors.clearSurfaceError('project-item-create') }}>
              <Tabs.List className={gh.projectComposerTabs} aria-label="Tipo di attività">
                <Tabs.Trigger value="issue"><CircleDot aria-hidden="true" size={14} /> Issue esistente</Tabs.Trigger>
                <Tabs.Trigger value="draft"><FilePlus2 aria-hidden="true" size={14} /> Nuova bozza</Tabs.Trigger>
                <Tabs.Indicator />
              </Tabs.List>
              <Tabs.Content className={gh.projectComposerContent} value="issue">
                {availableIssues.length ? <SelectField
                  id="github-project-issue-select"
                  label="Issue del repository"
                  options={availableIssues.map((issue) => ({ label: `#${issue.number} · ${issue.title}`, value: issue.url }))}
                  value={selectedIssueUrl}
                  onValueChange={setIssueUrl}
                /> : <p className={gh.projectComposerEmpty}>Tutte le issue caricate sono già nella board. Puoi creare una bozza oppure aggiornare i dati GitHub.</p>}
                {state.data?.issuesHasMore && <LimitNotice>La scelta mostra solo le issue caricate. Aggiorna GitHub per ottenere l’elenco più recente.</LimitNotice>}
              </Tabs.Content>
              <Tabs.Content className={gh.projectComposerContent} value="draft">
                <Field.Root id="github-project-draft-title"><Field.Label>Titolo</Field.Label><Field.Input ref={draftTitleInput} id="github-project-draft-title" value={draftTitle} maxLength={256} placeholder="Descrivi l’attività" onChange={(event) => setDraftTitle(event.target.value)} /></Field.Root>
                <Field.Root id="github-project-draft-body"><Field.Label>Descrizione <span className={gh.projectComposerOptional}>opzionale</span></Field.Label><Field.Textarea id="github-project-draft-body" value={draftBody} maxLength={65_536} placeholder="Contesto e dettagli utili (Markdown)" onChange={(event) => setDraftBody(event.target.value)} /></Field.Root>
              </Tabs.Content>
            </Tabs.Root>
            <footer className={gh.modalFooter}><Dialog.CloseTrigger asChild unstyled><Button variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={state.busy || (mode === 'issue' ? !selectedIssueUrl : !draftTitle.trim())} onClick={() => void submit()}>{mode === 'issue' ? 'Aggiungi al Project' : 'Crea bozza'}</Button></footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
