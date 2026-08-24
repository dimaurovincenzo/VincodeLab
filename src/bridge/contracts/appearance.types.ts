export type AppAppearance = 'system' | 'light' | 'dark'

export type AppearanceApi = {
  get: () => Promise<AppAppearance>
  set: (appearance: AppAppearance) => Promise<AppAppearance>
}
