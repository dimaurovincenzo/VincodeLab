import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, Check, FilePlus2, RefreshCw, Save, Trash2 } from 'lucide-react'
import { aiBridge } from '../api/ai.bridge'
import { Button, createListCollection, ErrorNotice, Field, IconButton, Listbox, Spinner, Splitter, toast, type SplitterPanelData } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { EmptyState } from '@/components/empty-state'
import { SKILL_NAME_HELP, SKILL_NAME_MAX_LENGTH, skillNameIssue } from '@/lib/skill-name'
import { commitVolatileDraft, discardVolatileDraft, latestVolatileDraft, restoreVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import { normalizeUserError, reportUserError, type NormalizeUserErrorOptions, type UserError } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { aiStyles } from '@/theme/styles/ai'

const skillPanels: SplitterPanelData[] = [
  { id: 'skills-sidebar', minSize: '230px', maxSize: '520px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'skills-editor', minSize: '420px' },
]

type Props = {
  workspace: string
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}

type SkillsRecovery =
  | { kind: 'create' }
  | { kind: 'delete' }
  | { kind: 'discard' }
  | { kind: 'reload' }
  | { kind: 'save' }
  | { kind: 'select'; skillId: string }
type SkillsFailure = { error: UserError; recovery: SkillsRecovery }

function projectSkillsError(error: unknown, options: NormalizeUserErrorOptions) {
  return reportUserError(normalizeUserError(error, {
    component: 'project-skills',
    recoverable: true,
    ...options,
  }))
}

function skillDraftIdentity(workspace: string, skillId: string): VolatileDraftIdentity {
  return { scope: 'project-skill', workspace, resource: skillId }
}

export function ProjectSkills({ workspace, onWorkspaceGuardChange }: Props) {
  const [skills, setSkills] = useState<ProjectSkill[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<UserError | null>(null)
  const [operationFailure, setOperationFailure] = useState<SkillsFailure | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const selectionRequestId = useRef(0)
  const selectionGeneration = useRef(0)
  const loadRequestId = useRef(0)
  const selectedIdRef = useRef<string | null>(null)
  const contentRef = useRef('')
  const savedContentRef = useRef('')
  const savingRef = useRef(false)
  const saveJobRef = useRef<Promise<ProjectSkill | null> | null>(null)
  const skillCollection = useMemo(() => createListCollection({
    items: skills,
    itemToString: (skill) => skill.name,
    itemToValue: (skill) => skill.id,
  }), [skills])

  const loadSkills = useCallback(async () => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setLoadError(null)
    try {
      const nextSkills = await aiBridge.skills.list()
      if (requestId !== loadRequestId.current) return
      setSkills(nextSkills)
    } catch (error) {
      if (requestId !== loadRequestId.current) return
      setLoadError(projectSkillsError(error, {
        category: 'filesystem',
        operation: 'list-project-skills',
        title: 'Elenco delle skill non disponibile',
        description: 'Le skill del workspace non sono state lette. Puoi riprovare senza modificare i file.',
      }))
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [])

  const selectSkill = useCallback(async (skillId: string, discardPrevious = false) => {
    const requestId = ++selectionRequestId.current
    const previousSkillId = selectedIdRef.current
    const previousContent = contentRef.current
    try {
      const skill = await aiBridge.skills.get(skillId)
      // Un completamento più lento non deve sostituire una selezione già cambiata dall’utente.
      if (requestId !== selectionRequestId.current) return
      if (skill.id !== skillId) throw new Error('La skill caricata non corrisponde alla selezione richiesta.')
      if (selectedIdRef.current !== previousSkillId || contentRef.current !== previousContent) {
        toast.info('Selezione annullata per conservare le modifiche più recenti.')
        return
      }
      const persistedContent = skill.content ?? ''
      const nextContent = restoreVolatileDraft(skillDraftIdentity(workspace, skillId), persistedContent)
      // Selezione, contenuto e baseline vengono pubblicati insieme soltanto dopo
      // una lettura valida: durante il caricamento resta attiva la skill precedente.
      if (discardPrevious && previousSkillId && previousSkillId !== skillId) {
        discardVolatileDraft(skillDraftIdentity(workspace, previousSkillId))
      }
      selectionGeneration.current += 1
      selectedIdRef.current = skillId
      contentRef.current = nextContent
      savedContentRef.current = persistedContent
      setSelectedId(skillId)
      setContent(nextContent)
      setSavedContent(persistedContent)
      setOperationFailure(null)
    } catch (error) {
      if (requestId !== selectionRequestId.current) return
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'filesystem',
          operation: 'open-project-skill',
          title: 'Skill selezionata non aperta',
          description: 'La skill precedente e le sue modifiche sono rimaste nell’editor. Puoi riprovare ad aprire la selezione.',
        }),
        recovery: { kind: 'select', skillId },
      })
    }
  }, [workspace])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void loadSkills() })
    return () => {
      active = false
      loadRequestId.current += 1
      selectionRequestId.current += 1
    }
  }, [loadSkills])

  useEffect(() => {
    if (loading || selectedIdRef.current) return
    const draft = latestVolatileDraft('project-skill', workspace)
    if (!draft || !skills.some((skill) => skill.id === draft.resource)) return
    let active = true
    queueMicrotask(() => { if (active) void selectSkill(draft.resource) })
    return () => { active = false }
  }, [loading, selectSkill, skills, workspace])

  const createSkill = async () => {
    const name = newName.trim()
    if (!name) return

    setSaving(true)
    setOperationFailure(null)
    try {
      const skill = await aiBridge.skills.create(name)
      setNewName('')
      await loadSkills()
      await selectSkill(skill.id)
      toast.success('Skill progetto creata.', { description: skill.name })
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'validation',
          operation: 'create-project-skill',
          title: 'Skill progetto non creata',
          description: 'La nuova skill non è stata creata. Controlla il nome e riprova.',
        }),
        recovery: { kind: 'create' },
      })
    } finally {
      setSaving(false)
    }
  }

  const persistSelectedSkill = useCallback(() => {
    if (saveJobRef.current) return saveJobRef.current
    const skillId = selectedIdRef.current
    const nextContent = contentRef.current
    const selectionVersion = selectionGeneration.current
    if (!skillId || nextContent === savedContentRef.current) return Promise.resolve(null)

    savingRef.current = true
    setSaving(true)
    const job = (async () => {
      try {
        const skill = await aiBridge.skills.update(skillId, nextContent)
        commitVolatileDraft(skillDraftIdentity(workspace, skillId), nextContent)
        // Il salvataggio appartiene alla selezione catturata: se nel frattempo
        // l'utente apre un'altra skill, il suo baseline non deve essere sostituito.
        if (selectedIdRef.current === skillId && selectionGeneration.current === selectionVersion) {
          savedContentRef.current = nextContent
          setSavedContent(nextContent)
        }
        await loadSkills()
        return skill
      } finally {
        saveJobRef.current = null
        savingRef.current = false
        setSaving(false)
      }
    })()
    saveJobRef.current = job
    return job
  }, [loadSkills, workspace])

  const saveSkill = async () => {
    setOperationFailure(null)
    try {
      const skill = await persistSelectedSkill()
      if (skill) toast.success('Skill salvata.', { description: skill.name })
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'validation',
          operation: 'save-project-skill',
          title: 'Skill non salvata',
          description: 'Il contenuto è rimasto nell’editor. Controlla le indicazioni di validazione e riprova.',
        }),
        recovery: { kind: 'save' },
      })
    }
  }

  const deleteSkillConfirmed = async () => {
    if (!selectedId) return
    setSaving(true)
    setOperationFailure(null)
    try {
      await aiBridge.skills.delete(selectedId)
      discardVolatileDraft(skillDraftIdentity(workspace, selectedId))
      selectionGeneration.current += 1
      selectedIdRef.current = null
      contentRef.current = ''
      savedContentRef.current = ''
      setSelectedId(null)
      setContent('')
      setSavedContent('')
      await loadSkills()
      toast.success('Skill eliminata.')
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'filesystem',
          operation: 'delete-project-skill',
          title: 'Skill non eliminata',
          description: 'La skill è rimasta nel workspace e può essere eliminata di nuovo.',
        }),
        recovery: { kind: 'delete' },
      })
    } finally {
      setSaving(false)
    }
  }

  const deleteSkill = () => {
    if (!selectedId) return
    const selected = skills.find((skill) => skill.id === selectedId)
    setConfirmation({ title: 'Elimina skill', detail: `La skill “${selected?.name ?? selectedId}” verrà eliminata definitivamente dal workspace.`, confirmLabel: 'Elimina skill', destructive: true, onConfirm: () => void deleteSkillConfirmed() })
  }

  const reloadPi = async () => {
    setOperationFailure(null)
    try {
      await aiBridge.skills.reload()
      toast.success('Pi sta ricaricando skill, prompt ed estensioni.')
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'process',
          operation: 'reload-pi-project-skills',
          title: 'Pi non ha ricaricato le skill',
          description: 'Le skill salvate restano disponibili. Riprova quando la sessione AI è pronta.',
        }),
        recovery: { kind: 'reload' },
      })
    }
  }

  const selected = skills.find((skill) => skill.id === selectedId)
  const skillName = newName.trim()
  const skillNameError = skillNameIssue(skillName)
  const hasUnsavedChanges = content !== savedContent

  const discardAll = useCallback(async () => {
    const skillId = selectedIdRef.current
    const baseline = savedContentRef.current
    const pendingSave = saveJobRef.current
    try {
      if (skillId && pendingSave) {
        await pendingSave.catch(() => {
          // La recovery seguente riscrive la baseline; il salvataggio concorrente ha
          // già comunicato il proprio failure senza perdere il contenuto della skill.
        })
        if (selectedIdRef.current !== skillId) throw new Error('La skill selezionata è cambiata durante il ripristino.')
        await aiBridge.skills.update(skillId, baseline)
        await loadSkills()
      }
      if (selectedIdRef.current !== skillId) return
      contentRef.current = baseline
      savedContentRef.current = baseline
      setContent(baseline)
      setSavedContent(baseline)
      if (skillId) discardVolatileDraft(skillDraftIdentity(workspace, skillId))
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'persistence',
          operation: 'discard-project-skill-changes',
          title: 'Modifiche alla skill non annullate',
          description: 'Le modifiche sono state mantenute per evitare perdite. Puoi riprovare.',
        }),
        recovery: { kind: 'discard' },
      })
      throw error
    }
  }, [loadSkills, workspace])

  const discardChanges = () => {
    void discardAll().then(() => toast.info('Modifiche non salvate annullate.')).catch(() => {
      // discardAll mantiene il draft e possiede già il feedback locale del failure.
    })
  }

  const saveAll = useCallback(async () => {
    try {
      while (selectedIdRef.current && contentRef.current !== savedContentRef.current) await persistSelectedSkill()
    } catch (error) {
      setOperationFailure({
        error: projectSkillsError(error, {
          category: 'persistence',
          operation: 'save-project-skill-before-workspace-change',
          title: 'Cambio workspace sospeso',
          description: 'La skill non è stata salvata. Le modifiche restano nel workspace corrente e puoi riprovare.',
        }),
        recovery: { kind: 'save' },
      })
      throw error
    }
  }, [persistSelectedSkill])

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => Boolean(selectedIdRef.current) && contentRef.current !== savedContentRef.current,
      saveAll,
      discardAll,
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [discardAll, onWorkspaceGuardChange, saveAll])

  const requestSelectSkill = (skillId: string) => {
    if (skillId === selectedId) return
    if (!selectedId || !hasUnsavedChanges) {
      void selectSkill(skillId)
      return
    }
    setConfirmation({ title: 'Modifiche non salvate', detail: `Le modifiche a “${selected?.name ?? 'questa skill'}” verranno scartate prima di aprire un’altra skill.`, confirmLabel: 'Scarta e apri', destructive: true, onConfirm: () => void selectSkill(skillId, true) })
  }

  const retryOperation = () => {
    if (!operationFailure) return
    const recovery = operationFailure.recovery
    if (recovery.kind === 'create') return void createSkill()
    if (recovery.kind === 'delete') return void deleteSkillConfirmed()
    if (recovery.kind === 'discard') {
      void discardAll().then(() => {
        setOperationFailure(null)
        toast.info('Modifiche non salvate annullate.')
      }).catch(() => {
        // discardAll mantiene il draft e aggiorna il feedback contestuale.
      })
      return
    }
    if (recovery.kind === 'reload') return void reloadPi()
    if (recovery.kind === 'select') return void selectSkill(recovery.skillId)
    void saveSkill()
  }

  const sidebarFailure = operationFailure && (operationFailure.recovery.kind === 'create' || operationFailure.recovery.kind === 'select')
    ? operationFailure
    : null

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
          <Field.Root className={aiStyles.editorField}><Field.Textarea className={aiStyles.editorTextarea} value={content} onChange={(event) => {
            const nextContent = event.target.value
            contentRef.current = nextContent
            setContent(nextContent)
            const skillId = selectedIdRef.current
            if (skillId) writeVolatileDraft(skillDraftIdentity(workspace, skillId), nextContent, savedContentRef.current)
          }} spellCheck={false} aria-label="Contenuto SKILL.md" /></Field.Root>
        </> : (
          <EmptyState className={aiStyles.skillsEmpty} eyebrow="Nessuna skill selezionata" icon={<BookOpen size={30} />} title="Skill locali e progressive" description="Crea o seleziona una skill: Pi leggerà le istruzioni complete solo quando gli servono." />
        )}
      </div></Splitter.Panel>
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    </section>
    </Splitter.Root>
  )
}
