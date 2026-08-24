export type AppPreferenceValue = string | number | boolean

export interface AppPreferenceDefinition {
  key: string
  section: 'editor' | 'terminal' | 'git' | 'database'
  label: string
  type: 'number' | 'boolean' | 'enum'
  default: AppPreferenceValue
  min?: number
  max?: number
  step?: number
  values?: string[]
}

export interface AppPreferencesSnapshot {
  schema: AppPreferenceDefinition[]
  global: Record<string, AppPreferenceValue>
  explicitGlobal: Record<string, AppPreferenceValue>
  overrides: Record<string, AppPreferenceValue>
  effective: Record<string, AppPreferenceValue>
  sources: Record<string, 'default' | 'global' | 'workspace'>
  workspaceAvailable: boolean
  recovery?: {
    kind: 'corrupt'
    correlationId: string
    globalCount: number
    workspaceCount: number
  }
}

export type PreferencesApi = {
  get: () => Promise<AppPreferencesSnapshot>
  setGlobal: (key: string, value: AppPreferenceValue) => Promise<AppPreferencesSnapshot>
  setWorkspace: (key: string, value: AppPreferenceValue) => Promise<AppPreferencesSnapshot>
  clearWorkspace: (key: string) => Promise<AppPreferencesSnapshot>
  clearAllWorkspace: () => Promise<AppPreferencesSnapshot>
}
