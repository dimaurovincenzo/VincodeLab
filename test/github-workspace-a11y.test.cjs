const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readGitHubSource } = require('./helpers/github-source.cjs')

const workspace = readGitHubSource()
const styles = [
  '../src/theme/styles/github.ts',
  '../src/theme/styles/github-issue-detail.ts',
  '../src/theme/styles/github-project-board.ts',
].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')

test('GitHub usa primitive accessibili per azioni icon-only e selezione branch', () => {
  assert.match(workspace, /tooltip=\{file\.sensitive \?[\s\S]*?\} onClick=\{\(\) => void actions\.stage\(file\)\}><Plus aria-hidden="true" size=\{13\} \/><\/IconButton>/)
  assert.match(workspace, /tooltip="Rimuovi dallo staging" onClick=\{\(\) => void actions\.unstage\(file\)\}><Minus aria-hidden="true" size=\{13\} \/><\/IconButton>/)
  for (const tooltip of ['Chiudi creazione issue', 'Chiudi dettaglio issue', 'Chiudi dettaglio attività']) {
    assert.match(workspace, new RegExp(`<Dialog\\.CloseTrigger asChild><IconButton tooltip="${tooltip}"`))
  }
  assert.doesNotMatch(workspace, /<Dialog\.CloseTrigger asChild><Button[^>]*(?:size="icon|aria-label="Chiudi)/)
  assert.match(workspace, /<SelectField\s+id="github-active-branch"\s+label="Branch"/)
  assert.doesNotMatch(workspace, /<label[^>]*htmlFor="github-active-branch"/)
  assert.doesNotMatch(styles, /branchLabel:/)
})

test('il select visibilità non eredita l’id del campo nome repository', () => {
  const start = workspace.indexOf('<div className={gh.remoteForm}>')
  const end = workspace.indexOf('<Field.Root className={gh.remoteForm} id="github-remote-url">', start)
  const createRepositoryForm = workspace.slice(start, end)

  assert.match(createRepositoryForm, /<Field\.Root id="github-repository-name">[\s\S]*?<Field\.Input id="github-repository-name"[\s\S]*?<\/Field\.Root>/)
  assert.match(createRepositoryForm, /<SelectField\s+id="github-repository-visibility"\s+aria-label="Visibilità del repository"/)
  const nameField = createRepositoryForm.slice(
    createRepositoryForm.indexOf('<Field.Root id="github-repository-name">'),
    createRepositoryForm.indexOf('</Field.Root>') + '</Field.Root>'.length,
  )
  assert.doesNotMatch(nameField, /<SelectField/)
})

test('i dialog GitHub delegano focus iniziale e ritorno all opener ad Ark', () => {
  assert.match(workspace, /const issueComposerTrigger = useRef<HTMLButtonElement>\(null\)/)
  assert.match(workspace, /const issueTitleInput = useRef<HTMLInputElement>\(null\)/)
  assert.match(workspace, /setIssueComposerTrigger = useCallback\([\s\S]*?issueComposerTrigger\.current = element/)
  assert.match(workspace, /state\.setIssueComposerTrigger\(event\.currentTarget\)[\s\S]*?state\.setIssueComposerOpen\(true\)[\s\S]*?Nuova issue/)
  assert.match(workspace, /aria-label=\{`Apri issue #\$\{issue\.number\}: \$\{issue\.title\}; stato \$\{stateLabel\}`\}/)
  assert.match(workspace, /<Dialog\.Root[^>]*finalFocusEl=\{\(\) => issueComposerTrigger\.current\}[^>]*initialFocusEl=\{\(\) => issueTitleInput\.current\}[^>]*lazyMount[^>]*open=\{state\.issueComposerOpen\}/)
  assert.match(workspace, /ids=\{\{ title: 'github-issue-create-title' \}\}/)
  assert.match(workspace, /<Field\.Input ref=\{issueTitleInput\} id="github-new-issue-title"/)
  assert.doesNotMatch(workspace, /<Field\.Input autoFocus/)

  assert.match(workspace, /issueDetailTrigger\.current = event\.currentTarget[\s\S]*?state\.setSelectedIssue\(issue\)/)
  assert.match(workspace, /<Dialog\.Root[^>]*finalFocusEl=\{\(\) => issueDetailTrigger\.current\}[^>]*open=\{state\.issueDetailOpen\}/)
  assert.match(workspace, /setBoardItemDialogTrigger = useCallback\([\s\S]*?boardItemDialogTrigger\.current = element/)
  assert.match(workspace, /setBoardItemDialogTrigger\(trigger\)/)
  assert.match(workspace, /actions\.selectBoardItem\(item, event\.currentTarget\)/)
  assert.match(workspace, /finalFocusEl=\{\(\) => boardItemDialogTrigger\.current\?\.isConnected \? boardItemDialogTrigger\.current : boardSearchInput\.current\}/)
})

test('gli stati vuoti GitHub restano informativi e la board usa una lista di attività accessibile', () => {
  assert.match(workspace, /import \{ EmptyState \} from '@\/components\/empty-state'/)
  assert.match(workspace, /<EmptyState[\s\S]*?className=\{gh\.issueEmpty\}[\s\S]*?title=\{state\.data\.issues\.length > 0 \? 'Nessun risultato' : 'Nessuna issue'\}/)
  assert.match(workspace, /Crea la prima issue/)
  assert.match(workspace, /<EmptyState action=\{projectComposerOpen \? undefined : <Button[\s\S]*?Crea il primo Project[\s\S]*?className=\{gh\.projectListEmpty\}.*?title="Nessun Project collegato"/)
  assert.match(workspace, /<EmptyState className=\{gh\.boardPlaceholder\}.*?title="Seleziona un Project"/)

  assert.match(workspace, /<div className=\{gh\.projectTable\} role="list" aria-label="Attività del Project">/)
  assert.match(workspace, /<section className=\{gh\.projectGroup\} role="listitem">/)
  assert.match(workspace, /<div className=\{gh\.boardEmpty\}><EmptyState[\s\S]*?className=\{gh\.boardEmptyState\}/)
  assert.match(styles, /issueEmpty:\s*css\(/)
  assert.match(styles, /projectListEmpty:\s*css\(/)
  assert.match(styles, /boardEmptyState:\s*css\(/)
  assert.match(styles, /boardPlaceholder:\s*css\(/)
})
