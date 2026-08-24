import { Button, Checkbox, Field, SelectField } from '@/components/ui'
import { preferenceEnumLabels } from '../model/settings-model'
import { preferenceOriginStyle, settingsStyles } from '@/theme/styles/settings'
import type { SettingsPreferencesController } from '../hooks/use-settings-preferences'
import { NumberPreferenceInput } from './number-preference-input'

export function PreferenceControl({
  controller,
  definition,
}: {
  controller: SettingsPreferencesController
  definition: AppPreferenceDefinition
}) {
  const {
    preferenceBusy,
    preferenceDraftResetRevision,
    preferenceDraftValues,
    preferenceFailures,
    preferences,
    preferenceScope,
    resetWorkspacePreference,
    restorePreferenceDraft,
    retryPreferenceFailure,
    savePreference,
    updateNumberPreferenceDraft,
  } = controller
  if (!preferences) return null
  const value = preferenceScope === 'workspace' ? preferences.effective[definition.key] : preferences.global[definition.key]
  const overridden = Object.hasOwn(preferences.overrides, definition.key)
  const explicitGlobal = Object.hasOwn(preferences.explicitGlobal, definition.key)
  const failure = preferenceFailures[`${preferenceScope}:${definition.key}`]
  const displayedValue = failure?.kind === 'save' && failure.value !== undefined ? failure.value : value
  const disabled = preferenceBusy === '*' || preferenceBusy === definition.key || (preferenceScope === 'workspace' && !preferences.workspaceAvailable)

  return <Field.Root className={settingsStyles.preferenceRow} invalid={Boolean(failure)}>
    <span className={settingsStyles.preferenceCopy}>
      <strong className={settingsStyles.preferenceLabel}>{definition.label}</strong>
      <small className={preferenceOriginStyle({ customized: overridden && preferenceScope === 'workspace' })}>{preferenceScope === 'workspace' ? overridden ? 'Personalizzato' : 'Ereditato dal valore globale' : explicitGlobal ? 'Valore globale' : 'Default applicativo'}</small>
    </span>
    <span className={settingsStyles.preferenceControl}>
      {definition.type === 'boolean' && <Checkbox aria-label={definition.label} checked={Boolean(displayedValue)} disabled={disabled} label="" onCheckedChange={(checked) => void savePreference(definition, checked, preferenceScope)} />}
      {definition.type === 'enum' && <SelectField aria-label={definition.label} disabled={disabled} options={(definition.values ?? []).map((option) => ({ value: option, label: preferenceEnumLabels[option] ?? option }))} value={String(displayedValue)} onValueChange={(next) => void savePreference(definition, next, preferenceScope)} />}
      {definition.type === 'number' && <NumberPreferenceInput
        key={`${preferenceScope}:${definition.key}:${String(value)}:${preferenceDraftResetRevision}`}
        definition={definition}
        disabled={disabled}
        initialDraft={preferenceDraftValues[`${preferenceScope}:${definition.key}`]}
        value={Number(displayedValue)}
        onCommit={(next) => savePreference(definition, next, preferenceScope)}
        onDraftChange={(draft) => updateNumberPreferenceDraft(definition, preferenceScope, Number(value), draft)}
      />}
      {preferenceScope === 'workspace' && overridden && <Button disabled={disabled} size="xs" variant="plain" type="button" onClick={() => void resetWorkspacePreference(definition)}>Usa globale</Button>}
      {failure && <Button disabled={disabled} size="xs" variant="outline" type="button" onClick={() => void retryPreferenceFailure(failure)}>Riprova</Button>}
      {failure?.kind === 'save' && <Button disabled={disabled} size="xs" variant="plain" type="button" onClick={() => restorePreferenceDraft(failure)}>Ripristina</Button>}
    </span>
    {failure && <Field.ErrorText>{failure.error.title}. {failure.error.description} Riferimento {failure.error.correlationId}.</Field.ErrorText>}
  </Field.Root>
}
