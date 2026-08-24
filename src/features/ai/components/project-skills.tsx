import { useMemo } from 'react'
import { AlertTriangle, BookOpen, Check, FilePlus2, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useProjectSkillsController, type ProjectSkillsControllerProps } from '../hooks/use-project-skills-controller'
import {
  Button,
  createListCollection,
  ErrorNotice,
  Field,
  IconButton,
  Listbox,
  Spinner,
  Splitter,
  type SplitterPanelData,
} from '@/components/ui'
import { ConfirmationDialog } from '@/components/confirmation-dialog'
import { EmptyState } from '@/components/empty-state'
import { SKILL_NAME_HELP, SKILL_NAME_MAX_LENGTH } from '@/lib/skill-name'
import { aiStyles } from '@/theme/styles/ai'

const skillPanels: SplitterPanelData[] = [
  { id: 'skills-sidebar', minSize: '230px', maxSize: '520px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'skills-editor', minSize: '420px' },
]

type Props = ProjectSkillsControllerProps

export function ProjectSkills({ workspace, onWorkspaceGuardChange }: Props) {
  const controller = useProjectSkillsController({ workspace, onWorkspaceGuardChange })
  const {
    cancelConfirmation,
    changeContent,
    createSkill,
    deleteSkill,
    discardChanges,
    loadSkills,
    reloadPi,
    requestSelectSkill,
    retryOperation,
    saveSkill,
    setNewName,
  } = controller.actions
  const { hasUnsavedChanges, selected, sidebarFailure, skillName, skillNameError } = controller.derived
  const { content, loadError, loading, newName, operationFailure, saving, selectedId, skills } = controller.state
  const skillCollection = useMemo(() => createListCollection({
    items: skills,
    itemToString: (skill) => skill.name,
    itemToValue: (skill) => skill.id,
  }), [skills])

  return (
    <Splitter.Root asChild defaultFixedSize={300} panels={skillPanels} storageKey={`vincodelab.skills.sidebar-width:${workspace}`}>
    <section className={aiStyles.skillsPage} aria-label="Skill progetto">
      <Splitter.Panel asChild id="skills-sidebar"><aside className={aiStyles.skillsSidebar}>
        <div className={aiStyles.paneHeader}>
          <div className={aiStyles.paneHeaderCopy}>
            <h2 id="project-skills-list-label">Skill progetto</h2>
            <p><code>.pi/skills</code></p>
          </div>
          <IconButton size="icon-sm" variant="outline" onClick={() => void loadSkills()} disabled={loading} tooltip="Aggiorna elenco Skill">
            {loading ? <Spinner /> : <RefreshCw aria-hidden="true" />}
          </IconButton>
        </div>

        <div className={aiStyles.newSkillForm}>
          <Field.Root className={aiStyles.newSkillField} invalid={Boolean(skillNameError)}>
            <Field.Input className={aiStyles.newSkillInput} aria-describedby="skill-name-help" aria-label="Nome nuova skill" autoCapitalize="none" maxLength={SKILL_NAME_MAX_LENGTH} placeholder="es. analisi-codice" spellCheck={false} value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !skillNameError && void createSkill()} />
            <Field.HelperText id="skill-name-help">{skillNameError ?? SKILL_NAME_HELP}</Field.HelperText>
          </Field.Root>
          <Button size="sm" onClick={() => void createSkill()} disabled={saving || !skillName || Boolean(skillNameError)}><FilePlus2 aria-hidden="true" /> Crea</Button>
        </div>

        {sidebarFailure && <ErrorNotice error={sidebarFailure.error} action={{ label: 'Riprova', onClick: retryOperation }} />}

        {loading ? <div className={aiStyles.skillsList}><p className={aiStyles.skillsPlaceholder}><Spinner /> Caricamento…</p></div> : loadError ? <div className={aiStyles.skillsList}><ErrorNotice error={loadError} action={{ label: 'Riprova', onClick: loadSkills }} /></div> : skills.length === 0 ? (
          <div className={aiStyles.skillsList}><p className={aiStyles.skillsPlaceholder}>Nessuna skill nel workspace.</p></div>
        ) : <Listbox.Root
          className={aiStyles.skillsList}
          collection={skillCollection}
          deselectable={false}
          ids={{ label: 'project-skills-list-label' }}
          loopFocus
          selectionMode="single"
          value={selectedId ? [selectedId] : []}
          onValueChange={({ value }) => { const skillId = value[0]; if (skillId) requestSelectSkill(skillId) }}
        >
          <Listbox.Content>
            {skills.map((skill) => <Listbox.Item className={aiStyles.skillListItem} highlightOnHover item={skill} key={skill.id}>
              <BookOpen aria-hidden="true" size={16} />
              <Listbox.ItemText asChild><span className={aiStyles.skillListCopy}><strong>{skill.name}</strong><small>{skill.description || 'Descrizione mancante'}</small></span></Listbox.ItemText>
              {skill.valid ? <Check className={aiStyles.skillValid} aria-label="Valida" size={15} /> : <AlertTriangle className={aiStyles.skillInvalid} aria-label="Non valida" size={15} />}
            </Listbox.Item>)}
          </Listbox.Content>
        </Listbox.Root>}
      </aside></Splitter.Panel>

      <Splitter.ResizeTrigger aria-label="Ridimensiona elenco Skill" className={aiStyles.skillsResizeTrigger} id="skills-sidebar:skills-editor" title="Trascina per ridimensionare l’elenco Skill. Doppio clic per ripristinare."><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>

      <Splitter.Panel asChild id="skills-editor"><div className={aiStyles.skillsEditor}>
        <div className={aiStyles.paneHeader}>
          <div className={aiStyles.paneHeaderCopy}>
            <h1>{selected?.name ?? 'Gestisci le skill del progetto'}</h1>
            <p>{selected ? `${selected.id}/SKILL.md${hasUnsavedChanges ? ' · modificata, non salvata' : ''}` : 'Crea o seleziona una skill per modificarla.'}</p>
          </div>
          <div className={aiStyles.editorActions}>
            <Button variant="outline" size="sm" onClick={() => void reloadPi()}><RefreshCw aria-hidden="true" /> Ricarica Pi</Button>
            {selected && <>
              {hasUnsavedChanges && <Button variant="outline" size="sm" onClick={discardChanges} disabled={saving}>Annulla modifiche</Button>}
              <Button size="sm" onClick={() => void saveSkill()} disabled={saving || !hasUnsavedChanges}><Save aria-hidden="true" /> Salva modifiche</Button>
              <IconButton variant="subtle" tone="danger" tooltip="Elimina skill selezionata" onClick={deleteSkill} disabled={saving}><Trash2 aria-hidden="true" /></IconButton>
            </>}
          </div>
        </div>

        <div className={aiStyles.advisory}><AlertTriangle aria-hidden="true" size={15} /> Pi carica le skill progetto solo dopo la conferma <code>/trust</code>. Dopo modifiche usa “Ricarica Pi”.</div>

        {operationFailure && !sidebarFailure && <ErrorNotice error={operationFailure.error} action={{ label: 'Riprova', onClick: retryOperation }} />}

        {selected ? <>
          {selected.issues.length > 0 && <div className={aiStyles.skillIssues}>{selected.issues.map(({ level, message }) => <p key={message} className={`${aiStyles.skillIssue} ${level === 'error' ? aiStyles.skillIssueError : aiStyles.skillIssueWarning}`}>{message}</p>)}</div>}
          <Field.Root className={aiStyles.editorField}><Field.Textarea className={aiStyles.editorTextarea} value={content} onChange={(event) => changeContent(event.target.value)} spellCheck={false} aria-label="Contenuto SKILL.md" /></Field.Root>
        </> : (
          <EmptyState className={aiStyles.skillsEmpty} eyebrow="Nessuna skill selezionata" icon={<BookOpen size={30} />} title="Skill locali e progressive" description="Crea o seleziona una skill: Pi leggerà le istruzioni complete solo quando gli servono." />
        )}
      </div></Splitter.Panel>
      <ConfirmationDialog request={controller.confirmation} onCancel={cancelConfirmation} />
    </section>
    </Splitter.Root>
  )
}
