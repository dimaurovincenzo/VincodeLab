import { ErrorNotice } from '@/components/ui'
import type { SettingsRecovery, SettingsSectionFailure } from '../model/settings.types'

export function SettingsSectionError({
  failure,
  fallbackRecovery,
  fallbackSecondaryRecovery,
}: {
  failure?: SettingsSectionFailure
  fallbackRecovery: SettingsRecovery
  fallbackSecondaryRecovery?: SettingsRecovery
}) {
  if (!failure) return null
  const recovery = failure.recovery ?? fallbackRecovery
  const secondaryRecovery = failure.secondaryRecovery ?? (!failure.recovery ? fallbackSecondaryRecovery : undefined)
  return <ErrorNotice
    action={{ label: recovery.label, onClick: recovery.run, pendingLabel: recovery.pendingLabel }}
    error={failure.error}
    secondaryAction={secondaryRecovery ? {
      label: secondaryRecovery.label,
      onClick: secondaryRecovery.run,
      pendingLabel: secondaryRecovery.pendingLabel,
    } : undefined}
  />
}
