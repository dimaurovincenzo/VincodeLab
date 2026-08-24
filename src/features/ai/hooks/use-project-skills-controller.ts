import { useCallback, useEffect, useRef, useState } from 'react'
import { aiBridge } from '../api/ai.bridge'
import { toast } from '@/components/ui'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { skillNameIssue } from '@/lib/skill-name'
import {
  commitVolatileDraft,
  discardVolatileDraft,
  latestVolatileDraft,
  restoreVolatileDraft,
  writeVolatileDraft,
  type VolatileDraftIdentity,
} from '@/lib/volatile-draft-store'
import {
  normalizeUserError,
  reportUserError,
  type NormalizeUserErrorOptions,
  type UserError,
} from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

export type ProjectSkillsControllerProps = {
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

export function useProjectSkillsController({ workspace, onWorkspaceGuardChange }: ProjectSkillsControllerProps) {
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
  const saveJobRef = useRef<Promise<ProjectSkill | null> | null>(null)

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

  const selected = skills.find((skill) => skill.id === selectedId)

  const deleteSkill = () => {
    if (!selectedId) return
    setConfirmation({
      title: 'Elimina skill',
      detail: `La skill “${selected?.name ?? selectedId}” verrà eliminata definitivamente dal workspace.`,
      confirmLabel: 'Elimina skill',
      destructive: true,
      onConfirm: () => void deleteSkillConfirmed(),
    })
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
    setConfirmation({
      title: 'Modifiche non salvate',
      detail: `Le modifiche a “${selected?.name ?? 'questa skill'}” verranno scartate prima di aprire un’altra skill.`,
      confirmLabel: 'Scarta e apri',
      destructive: true,
      onConfirm: () => void selectSkill(skillId, true),
    })
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

  const changeContent = (nextContent: string) => {
    contentRef.current = nextContent
    setContent(nextContent)
    const skillId = selectedIdRef.current
    if (skillId) writeVolatileDraft(skillDraftIdentity(workspace, skillId), nextContent, savedContentRef.current)
  }

  const sidebarFailure = operationFailure && (operationFailure.recovery.kind === 'create' || operationFailure.recovery.kind === 'select')
    ? operationFailure
    : null

  return {
    actions: {
      cancelConfirmation: () => setConfirmation(null),
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
    },
    confirmation,
    derived: {
      hasUnsavedChanges,
      selected,
      sidebarFailure,
      skillName,
      skillNameError,
    },
    state: {
      content,
      loadError,
      loading,
      newName,
      operationFailure,
      saving,
      selectedId,
      skills,
    },
  }
}
