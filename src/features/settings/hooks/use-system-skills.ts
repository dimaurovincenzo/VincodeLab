import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectSkill } from '@/bridge'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { toast } from '@/components/ui'
import { skillNameIssue } from '@/lib/skill-name'
import type { UserError } from '@/lib/user-error'
import {
  commitVolatileDraft,
  discardVolatileDraft,
  restoreVolatileDraft,
  writeVolatileDraft,
} from '@/lib/volatile-draft-store'
import { settingsBridge } from '../api/settings.bridge'
import { newSystemSkillDraftIdentity, systemSkillDraftIdentity } from '../model/settings-model'
import { settingsUserError } from '../services/settings-error'
import type { SettingsRefreshController } from './use-settings-refresh'

export function useSystemSkills(
  refreshController: SettingsRefreshController,
  setConfirmation: (request: ConfirmationRequest | null) => void,
) {
  const {
    clearSectionFailure,
    markSectionOperation,
    mounted,
    publishSectionFailure,
    refresh,
  } = refreshController
  const [skillName, setSkillName] = useState(() => restoreVolatileDraft(newSystemSkillDraftIdentity, ''))
  const [selectedSkill, setSelectedSkill] = useState<ProjectSkill | null>(null)
  const [savedSystemSkillContent, setSavedSystemSkillContent] = useState('')
  const [systemSkillSaving, setSystemSkillSaving] = useState(false)
  const [skillNameFailure, setSkillNameFailure] = useState<UserError | null>(null)
  const [skillEditorFailure, setSkillEditorFailure] = useState<UserError | null>(null)
  const [systemSkillBusy, setSystemSkillBusy] = useState<string | null>(null)
  const skillNameRef = useRef(skillName)
  const systemSkillSelectionRequestId = useRef(0)
  const systemSkillSelectionGeneration = useRef(0)
  const systemSkillSaveRequestId = useRef(0)
  const selectedSystemSkillRef = useRef<ProjectSkill | null>(null)
  const savedSystemSkillContentRef = useRef('')

  useEffect(() => { skillNameRef.current = skillName }, [skillName])
  useEffect(() => () => {
    systemSkillSelectionRequestId.current += 1
    systemSkillSaveRequestId.current += 1
  }, [])

  const publishSystemSkillSelection = useCallback((skill: ProjectSkill | null) => {
    const persistedContent = skill?.content ?? ''
    const nextContent = skill ? restoreVolatileDraft(systemSkillDraftIdentity(skill.id), persistedContent) : ''
    const nextSkill = skill && nextContent !== persistedContent ? { ...skill, content: nextContent } : skill
    systemSkillSelectionGeneration.current += 1
    selectedSystemSkillRef.current = nextSkill
    savedSystemSkillContentRef.current = persistedContent
    setSelectedSkill(nextSkill)
    setSavedSystemSkillContent(persistedContent)
  }, [])

  async function selectSystemSkill(skillId: string, discardPreviousSkillId?: string): Promise<void> {
    if (selectedSystemSkillRef.current?.id === skillId) return
    const requestId = ++systemSkillSelectionRequestId.current
    const previousSkillId = selectedSystemSkillRef.current?.id ?? null
    const previousContent = selectedSystemSkillRef.current?.content ?? ''
    markSectionOperation('skills')
    setSystemSkillBusy(`load:${skillId}`)
    clearSectionFailure('skills')
    try {
      const skill = await settingsBridge.systemSkills.get(skillId)
      if (!mounted.current || requestId !== systemSkillSelectionRequestId.current) return
      if (skill.id !== skillId) throw new Error('La skill caricata non corrisponde alla selezione richiesta.')
      if ((selectedSystemSkillRef.current?.id ?? null) !== previousSkillId || (selectedSystemSkillRef.current?.content ?? '') !== previousContent) {
        toast.info('Selezione annullata per conservare le modifiche più recenti.')
        return
      }
      if (discardPreviousSkillId) discardVolatileDraft(systemSkillDraftIdentity(discardPreviousSkillId))
      publishSystemSkillSelection(skill)
    } catch (cause) {
      if (mounted.current && requestId === systemSkillSelectionRequestId.current) publishSectionFailure('skills', {
        error: settingsUserError(cause, {
          category: 'configuration',
          description: 'La selezione precedente e le modifiche locali sono rimaste disponibili.',
          operation: 'open-system-skill',
          title: 'Skill Pi non aperta',
        }),
        recovery: { label: 'Riprova apertura', run: () => selectSystemSkill(skillId, discardPreviousSkillId) },
      })
    } finally {
      if (mounted.current && requestId === systemSkillSelectionRequestId.current) setSystemSkillBusy(null)
    }
  }

  function requestSelectSystemSkill(skillId: string) {
    const current = selectedSystemSkillRef.current
    if (current?.id === skillId) return
    const hasUnsavedChanges = Boolean(current) && (current?.content ?? '') !== savedSystemSkillContentRef.current
    if (!hasUnsavedChanges) {
      void selectSystemSkill(skillId)
      return
    }
    setConfirmation({
      title: 'Modifiche non salvate',
      detail: `Le modifiche a “${current?.name ?? 'questa skill'}” verranno scartate prima di aprire un’altra skill.`,
      confirmLabel: 'Scarta e apri',
      destructive: true,
      onConfirm: () => { void selectSystemSkill(skillId, current?.id) },
    })
  }

  const saveSystemSkill = useCallback(async (): Promise<boolean> => {
    const current = selectedSystemSkillRef.current
    if (!current) return true
    const content = current.content ?? ''
    if (content === savedSystemSkillContentRef.current) return true
    const requestId = ++systemSkillSaveRequestId.current
    const selectionVersion = systemSkillSelectionGeneration.current
    setSystemSkillSaving(true)
    setSkillEditorFailure(null)
    try {
      const savedSkill = await settingsBridge.systemSkills.update(current.id, content)
      if (!mounted.current || requestId !== systemSkillSaveRequestId.current) return false
      if (systemSkillSelectionGeneration.current === selectionVersion && selectedSystemSkillRef.current?.id === current.id) {
        commitVolatileDraft(systemSkillDraftIdentity(current.id), content)
        savedSystemSkillContentRef.current = content
        setSavedSystemSkillContent(content)
        const nextSkill = { ...savedSkill, content: selectedSystemSkillRef.current.content ?? '' }
        selectedSystemSkillRef.current = nextSkill
        setSelectedSkill(nextSkill)
      }
      toast.success('Skill Pi salvata.')
      await refresh()
      return true
    } catch (cause) {
      if (mounted.current && requestId === systemSkillSaveRequestId.current) {
        setSkillEditorFailure(settingsUserError(cause, {
          category: 'configuration',
          description: 'Il contenuto non è stato salvato. La bozza locale è rimasta nell’editor.',
          operation: 'save-system-skill',
          title: 'Skill Pi non salvata',
        }))
      }
      return false
    } finally {
      if (mounted.current && requestId === systemSkillSaveRequestId.current) setSystemSkillSaving(false)
    }
  }, [mounted, refresh])

  async function createSystemSkill() {
    const draft = skillName
    const name = draft.trim()
    if (!name || skillNameIssue(name)) return
    markSectionOperation('skills')
    setSystemSkillBusy('create')
    setSkillNameFailure(null)
    try {
      const skill = await settingsBridge.systemSkills.create(name)
      if (!mounted.current) return
      if (skillNameRef.current === draft) {
        discardVolatileDraft(newSystemSkillDraftIdentity)
        skillNameRef.current = ''
        setSkillName('')
      }
      const current = selectedSystemSkillRef.current
      const hasUnsavedChanges = Boolean(current) && (current?.content ?? '') !== savedSystemSkillContentRef.current
      if (!hasUnsavedChanges) {
        systemSkillSelectionRequestId.current += 1
        publishSystemSkillSelection(skill)
      } else {
        toast.info('Skill Pi creata senza sostituire la modifica in corso.', { description: skill.name })
      }
      await refresh()
    } catch (cause) {
      if (mounted.current) setSkillNameFailure(settingsUserError(cause, {
        fallbackDescription: 'La nuova skill non è stata creata. Il nome inserito è rimasto disponibile.',
        operation: 'create-system-skill',
        title: 'Skill Pi non creata',
      }))
    } finally {
      if (mounted.current) setSystemSkillBusy(null)
    }
  }

  function requestCreateSystemSkill() {
    setConfirmation({
      title: 'Crea skill Pi',
      detail: `La skill ${skillName.trim()} sarà disponibile globalmente per Pi.`,
      confirmLabel: 'Crea',
      onConfirm: () => { void createSystemSkill() },
    })
  }

  function requestDeleteSystemSkill(skill: ProjectSkill): void {
    setConfirmation({
      title: 'Elimina skill Pi',
      detail: `La skill ${skill.name} verrà rimossa per tutti i workspace.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          markSectionOperation('skills')
          setSystemSkillBusy(`delete:${skill.id}`)
          clearSectionFailure('skills')
          try {
            await settingsBridge.systemSkills.delete(skill.id)
            if (!mounted.current) return
            if (selectedSystemSkillRef.current?.id === skill.id) {
              discardVolatileDraft(systemSkillDraftIdentity(skill.id))
              systemSkillSelectionRequestId.current += 1
              publishSystemSkillSelection(null)
            }
            await refresh()
          } catch (cause) {
            if (mounted.current) publishSectionFailure('skills', {
              error: settingsUserError(cause, {
                category: 'configuration',
                description: `“${skill.name}” è rimasta disponibile. Puoi riprovare la rimozione.`,
                operation: 'delete-system-skill',
                title: 'Skill Pi non eliminata',
              }),
              recovery: { label: 'Riprova eliminazione', run: () => requestDeleteSystemSkill(skill) },
            })
          } finally {
            if (mounted.current) setSystemSkillBusy(null)
          }
        })()
      },
    })
  }

  const changeSkillName = useCallback((value: string) => {
    skillNameRef.current = value
    setSkillName(value)
    setSkillNameFailure(null)
    writeVolatileDraft(newSystemSkillDraftIdentity, value, '')
  }, [])

  const changeSelectedSkillContent = useCallback((value: string) => {
    const current = selectedSystemSkillRef.current
    if (!current) return
    const nextSkill = { ...current, content: value }
    writeVolatileDraft(systemSkillDraftIdentity(current.id), value, savedSystemSkillContentRef.current)
    selectedSystemSkillRef.current = nextSkill
    setSelectedSkill(nextSkill)
    setSkillEditorFailure(null)
  }, [])

  const discardDrafts = useCallback(() => {
    discardVolatileDraft(newSystemSkillDraftIdentity)
    skillNameRef.current = ''
    setSkillName('')
    systemSkillSelectionRequestId.current += 1
    systemSkillSaveRequestId.current += 1
    setSystemSkillSaving(false)
    setSystemSkillBusy(null)
    setSkillEditorFailure(null)
    setSkillNameFailure(null)
    const currentSkill = selectedSystemSkillRef.current
    if (currentSkill) {
      discardVolatileDraft(systemSkillDraftIdentity(currentSkill.id))
      const restored = { ...currentSkill, content: savedSystemSkillContentRef.current }
      selectedSystemSkillRef.current = restored
      setSelectedSkill(restored)
    }
  }, [])

  const hasNameDraft = useCallback(() => Boolean(skillNameRef.current.trim()), [])
  const hasUnsavedSkill = useCallback(() => {
    const current = selectedSystemSkillRef.current
    return Boolean(current && (current.content ?? '') !== savedSystemSkillContentRef.current)
  }, [])

  return {
    changeSelectedSkillContent,
    changeSkillName,
    discardDrafts,
    hasNameDraft,
    hasUnsavedSkill,
    requestCreateSystemSkill,
    requestDeleteSystemSkill,
    requestSelectSystemSkill,
    saveSystemSkill,
    savedSystemSkillContent,
    selectedSkill,
    skillEditorFailure,
    skillName,
    skillNameError: skillNameIssue(skillName),
    skillNameFailure,
    systemSkillBusy,
    systemSkillHasUnsavedChanges: Boolean(selectedSkill) && (selectedSkill?.content ?? '') !== savedSystemSkillContent,
    systemSkillName: skillName.trim(),
    systemSkillSaving,
  }
}

export type SystemSkillsController = ReturnType<typeof useSystemSkills>
