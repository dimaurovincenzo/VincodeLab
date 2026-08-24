import { useEffect } from 'react'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import type { SettingsProps } from '../model/settings.types'
import type { PiPackagesController } from './use-pi-packages'
import type { SettingsPreferencesController } from './use-settings-preferences'
import type { SystemSkillsController } from './use-system-skills'

export function useSettingsWorkspaceGuard({
  onWorkspaceGuardChange,
  packages,
  preferences,
  setConfirmation,
  skills,
}: {
  onWorkspaceGuardChange: SettingsProps['onWorkspaceGuardChange']
  packages: PiPackagesController
  preferences: SettingsPreferencesController
  setConfirmation: (request: ConfirmationRequest | null) => void
  skills: SystemSkillsController
}) {
  const {
    discardDrafts: discardPackageDrafts,
    hasDraft: hasPackageDraft,
  } = packages
  const {
    discardDrafts: discardPreferenceDrafts,
    hasDrafts: hasPreferenceDrafts,
    saveDrafts: savePreferenceDrafts,
  } = preferences
  const {
    discardDrafts: discardSkillDrafts,
    hasNameDraft,
    hasUnsavedSkill,
    saveSystemSkill,
  } = skills

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => hasPreferenceDrafts()
        || hasPackageDraft()
        || hasNameDraft()
        || hasUnsavedSkill(),
      saveAll: async () => {
        if (hasPackageDraft() || hasNameDraft()) {
          throw new Error('Completa oppure scarta la sorgente pacchetto o il nome della nuova Skill Pi prima di continuare.')
        }
        await savePreferenceDrafts()
        const savedSkill = await saveSystemSkill()
        if (!savedSkill) throw new Error('Non è stato possibile salvare la Skill Pi corrente.')
        if (hasUnsavedSkill()) {
          throw new Error('La Skill Pi è stata modificata di nuovo durante il salvataggio. Controlla il contenuto e riprova.')
        }
      },
      discardAll: async () => {
        discardPreferenceDrafts()
        discardPackageDrafts()
        setConfirmation(null)
        discardSkillDrafts()
      },
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [
    discardPackageDrafts,
    discardPreferenceDrafts,
    discardSkillDrafts,
    hasNameDraft,
    hasPackageDraft,
    hasPreferenceDrafts,
    hasUnsavedSkill,
    onWorkspaceGuardChange,
    savePreferenceDrafts,
    saveSystemSkill,
    setConfirmation,
  ])
}
