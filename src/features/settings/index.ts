export { settingsBridge } from './api/settings.bridge'
export { NumberPreferenceInput } from './components/number-preference-input'
export type { NumberPreferenceInputProps } from './components/number-preference-input'
export { Settings } from './components/settings'
export {
  defaultPiConfigDimensions,
  isPackageSource,
  newSystemSkillDraftIdentity,
  normalizePackageSource,
  packageSourceCopy,
  packageSourceDraftIdentity,
  preferenceEnumLabels,
  preferenceSectionLabels,
  systemSkillDraftIdentity,
} from './model/settings-model'
export { settingsUserError } from './services/settings-error'
export type {
  Appearance,
  PackageSource,
  PreferenceFailure,
  PreferenceScope,
  SettingsProps,
  SettingsRecovery,
  SettingsSectionFailure,
  SettingsTab,
} from './model/settings.types'
