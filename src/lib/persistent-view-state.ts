export const persistentViewIds = [
  'settings',
  'skills',
  'instructions',
  'editor',
  'terminal',
  'github',
  'database',
] as const

export type PersistentViewId = typeof persistentViewIds[number]
export type PersistentViewState = Record<PersistentViewId, boolean>

export function createPersistentViewState(): PersistentViewState {
  return Object.fromEntries(persistentViewIds.map((view) => [view, false])) as PersistentViewState
}

export function visitPersistentView(state: PersistentViewState, view: PersistentViewId): PersistentViewState {
  return state[view] ? state : { ...state, [view]: true }
}

export function shouldMountPersistentView(state: PersistentViewState, view: PersistentViewId, active: boolean) {
  return active || state[view]
}
