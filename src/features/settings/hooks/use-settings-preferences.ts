import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { toast } from '@/components/ui'
import { useAppPreferences } from '@/lib/app-preferences'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import { settingsBridge } from '../api/settings.bridge'
import type { PreferenceFailure, PreferenceScope } from '../model/settings.types'
import { settingsUserError } from '../services/settings-error'
import type { SettingsRefreshController } from './use-settings-refresh'

type PreferenceDraft = {
  baseline: number
  definition: AppPreferenceDefinition
  draft: string
  scope: PreferenceScope
}

export function useSettingsPreferences(
  refreshController: SettingsRefreshController,
  setConfirmation: (request: ConfirmationRequest | null) => void,
) {
  const { clearSectionFailure, mounted, publishSectionFailure } = refreshController
  const [preferenceScope, setPreferenceScope] = useState<PreferenceScope>('global')
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null)
  const [preferenceFailures, setPreferenceFailures] = useState<Record<string, PreferenceFailure>>({})
  const [preferenceDraftValues, setPreferenceDraftValues] = useState<Record<string, string>>({})
  const [preferenceDraftResetRevision, setPreferenceDraftResetRevision] = useState(0)
  const preferenceMutationGeneration = useRef(new Map<string, number>())
  const preferenceDrafts = useRef(new Map<string, PreferenceDraft>())
  const {
    preferences,
    preferencesError,
    preferencesLoading,
    publishPreferences,
    retryPreferences,
  } = useAppPreferences()
  const preferenceLoadFailure = useMemo(() => preferencesError ? normalizeUserError(preferencesError, {
    category: 'persistence',
    component: 'settings',
    description: preferences
      ? 'I valori già caricati restano utilizzabili. Riprova senza ricaricare l’app.'
      : 'Non è stato possibile leggere i valori. Riprova senza ricaricare l’app.',
    operation: 'load-preferences',
    title: preferences ? 'Preferenze non aggiornate' : 'Preferenze non disponibili',
  }) : null, [preferences, preferencesError])

  useEffect(() => {
    if (preferenceLoadFailure) reportUserError(preferenceLoadFailure)
  }, [preferenceLoadFailure])

  const clearPreferenceFailure = useCallback((mutationKey: string) => {
    setPreferenceFailures((current) => {
      if (!current[mutationKey]) return current
      const next = { ...current }
      delete next[mutationKey]
      return next
    })
  }, [])

  const savePreference = useCallback(async (
    definition: AppPreferenceDefinition,
    value: AppPreferenceValue,
    requestedScope: PreferenceScope,
  ) => {
    const scope = requestedScope
    const mutationKey = `${scope}:${definition.key}`
    const generation = (preferenceMutationGeneration.current.get(mutationKey) ?? 0) + 1
    preferenceMutationGeneration.current.set(mutationKey, generation)
    setPreferenceBusy(definition.key)
    try {
      const next = scope === 'workspace'
        ? await settingsBridge.preferences.setWorkspace(definition.key, value)
        : await settingsBridge.preferences.setGlobal(definition.key, value)
      if (preferenceMutationGeneration.current.get(mutationKey) !== generation) return false
      publishPreferences(next)
      clearPreferenceFailure(mutationKey)
      toast.success('Impostazione salvata.')
      return true
    } catch (cause) {
      if (mounted.current && preferenceMutationGeneration.current.get(mutationKey) === generation) {
        setPreferenceFailures((current) => ({ ...current, [mutationKey]: {
          definition,
          error: settingsUserError(cause, {
            category: 'persistence',
            description: `“${definition.label}” non è stata salvata. Il valore precedente è rimasto attivo e l’eventuale bozza è stata mantenuta.`,
            operation: 'save-preference',
            title: 'Impostazione non salvata',
          }),
          kind: 'save',
          scope,
          value,
        } }))
      }
      return false
    } finally {
      if (mounted.current && preferenceMutationGeneration.current.get(mutationKey) === generation) setPreferenceBusy(null)
    }
  }, [clearPreferenceFailure, mounted, publishPreferences])

  const resetWorkspacePreference = useCallback(async (definition: AppPreferenceDefinition) => {
    const mutationKey = `workspace:${definition.key}`
    setPreferenceBusy(definition.key)
    try {
      publishPreferences(await settingsBridge.preferences.clearWorkspace(definition.key))
      clearPreferenceFailure(mutationKey)
      toast.success('Personalizzazione rimossa.')
    } catch (cause) {
      if (mounted.current) setPreferenceFailures((current) => ({ ...current, [mutationKey]: {
        definition,
        error: settingsUserError(cause, {
          category: 'persistence',
          description: `La personalizzazione di “${definition.label}” è rimasta attiva. Puoi riprovare o mantenere il valore corrente.`,
          operation: 'reset-workspace-preference',
          title: 'Personalizzazione non rimossa',
        }),
        kind: 'reset',
        scope: 'workspace',
      } }))
    } finally {
      if (mounted.current) setPreferenceBusy(null)
    }
  }, [clearPreferenceFailure, mounted, publishPreferences])

  async function clearAllWorkspacePreferences() {
    setPreferenceBusy('*')
    clearSectionFailure('general')
    try {
      publishPreferences(await settingsBridge.preferences.clearAllWorkspace())
      setPreferenceFailures({})
      toast.success('Personalizzazioni rimosse.')
    } catch (cause) {
      if (mounted.current) publishSectionFailure('general', {
        error: settingsUserError(cause, {
          category: 'persistence',
          description: 'Le personalizzazioni del workspace sono rimaste attive. Nessun valore è stato scartato.',
          operation: 'reset-all-workspace-preferences',
          title: 'Personalizzazioni non rimosse',
        }),
        recovery: { label: 'Ripristina', run: requestClearAllWorkspacePreferences },
      })
    } finally {
      if (mounted.current) setPreferenceBusy(null)
    }
  }

  function requestClearAllWorkspacePreferences() {
    setConfirmation({
      title: 'Rimuovere tutte le personalizzazioni?',
      detail: 'Il workspace tornerà a usare tutti i valori globali.',
      confirmLabel: 'Rimuovi personalizzazioni',
      destructive: true,
      onConfirm: () => { void clearAllWorkspacePreferences() },
    })
  }

  const updateNumberPreferenceDraft = useCallback((
    definition: AppPreferenceDefinition,
    scope: PreferenceScope,
    baseline: number,
    draft: string | null,
  ) => {
    const key = `${scope}:${definition.key}`
    if (draft === null) {
      preferenceDrafts.current.delete(key)
      setPreferenceDraftValues((current) => {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    } else {
      preferenceDrafts.current.set(key, { definition, draft, scope, baseline })
      setPreferenceDraftValues((current) => ({ ...current, [key]: draft }))
    }
  }, [])

  const retryPreferenceFailure = useCallback(async (failure: PreferenceFailure) => {
    if (failure.kind === 'reset') await resetWorkspacePreference(failure.definition)
    else if (failure.value !== undefined) await savePreference(failure.definition, failure.value, failure.scope)
  }, [resetWorkspacePreference, savePreference])

  const retryPreferenceLoad = useCallback(async (): Promise<void> => {
    try {
      await retryPreferences()
    } catch {
      // useAppPreferences pubblica già il nuovo errore nella stessa superficie locale.
    }
  }, [retryPreferences])

  const restorePreferenceDraft = useCallback((failure: PreferenceFailure) => {
    const key = `${failure.scope}:${failure.definition.key}`
    preferenceDrafts.current.delete(key)
    setPreferenceDraftValues((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    clearPreferenceFailure(key)
    setPreferenceDraftResetRevision((current) => current + 1)
  }, [clearPreferenceFailure])

  const saveDrafts = useCallback(async () => {
    for (const [key, draft] of [...preferenceDrafts.current]) {
      const parsed = Number(draft.draft)
      const valid = draft.draft.trim() !== ''
        && Number.isFinite(parsed)
        && (draft.definition.min === undefined || parsed >= draft.definition.min)
        && (draft.definition.max === undefined || parsed <= draft.definition.max)
      if (!valid) throw new Error(`Il valore “${draft.definition.label}” non è valido.`)
      if (!Object.is(parsed, draft.baseline)) {
        const saved = await savePreference(draft.definition, parsed, draft.scope)
        if (!saved) throw new Error(`Non è stato possibile salvare “${draft.definition.label}”.`)
      }
      if (preferenceDrafts.current.get(key)?.draft === draft.draft) {
        preferenceDrafts.current.delete(key)
        setPreferenceDraftValues((current) => {
          if (current[key] !== draft.draft) return current
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }
  }, [savePreference])

  const discardDrafts = useCallback(() => {
    preferenceDrafts.current.clear()
    setPreferenceDraftValues({})
    setPreferenceDraftResetRevision((current) => current + 1)
    setPreferenceFailures({})
  }, [])

  return {
    discardDrafts,
    hasDrafts: () => preferenceDrafts.current.size > 0,
    preferenceBusy,
    preferenceDraftResetRevision,
    preferenceDraftValues,
    preferenceFailures,
    preferenceLoadFailure,
    preferences,
    preferencesLoading,
    preferenceScope,
    requestClearAllWorkspacePreferences,
    resetWorkspacePreference,
    restorePreferenceDraft,
    retryPreferenceFailure,
    retryPreferenceLoad,
    saveDrafts,
    savePreference,
    setPreferenceScope,
    updateNumberPreferenceDraft,
  }
}

export type SettingsPreferencesController = ReturnType<typeof useSettingsPreferences>
