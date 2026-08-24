import type { UserError } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

export type SettingsTab = 'general' | 'compatibility' | 'updates' | 'runtime' | 'packages' | 'skills'
export type PackageSource = 'npm' | 'git' | 'local'
export type Appearance = 'system' | 'light' | 'dark'
export type PreferenceScope = 'global' | 'workspace'
export type SettingsRecovery = { label: string; run: () => void | Promise<void>; pendingLabel?: string }
export type SettingsSectionFailure = { error: UserError; recovery?: SettingsRecovery; secondaryRecovery?: SettingsRecovery }
export type PreferenceFailure = {
  definition: AppPreferenceDefinition
  error: UserError
  kind: 'reset' | 'save'
  scope: PreferenceScope
  value?: AppPreferenceValue
}

export type SettingsProps = {
  active?: boolean
  appearance: Appearance
  openRuntimeRequest?: number
  onAppearanceChange: (appearance: Appearance) => void
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}
