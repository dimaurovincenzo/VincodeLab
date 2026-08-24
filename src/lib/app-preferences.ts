import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { bridgeNamespace } from '@/bridge'

type AppPreferencesWorkspaceKey = string | null
type AppPreferencesContext = {
  workspaceKey: AppPreferencesWorkspaceKey
  generation: number
}
type AppPreferencesStoreSnapshot = AppPreferencesContext & {
  error: Error | null
  loading: boolean
  preferences: AppPreferencesSnapshot | null
}

const PREFERENCE_SECTIONS = ['editor', 'terminal', 'git', 'database'] as const
const PREFERENCE_TYPES = ['number', 'boolean', 'enum'] as const
const PREFERENCE_SOURCES = ['default', 'global', 'workspace'] as const

function sameContext(left: AppPreferencesContext, right: AppPreferencesContext) {
  return left.workspaceKey === right.workspaceKey && left.generation === right.generation
}

function requestKey(context: AppPreferencesContext) {
  return JSON.stringify([context.workspaceKey, context.generation])
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function enumValue<const Value extends string>(value: unknown, values: readonly Value[]) {
  return typeof value === 'string' && values.includes(value as Value) ? value as Value : undefined
}

function boundedText(value: unknown, maximumLength: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength && !value.includes('\0')
    ? value
    : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function validPreferenceKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u.test(value)
}

function genericPreferenceValue(value: unknown): AppPreferenceValue | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.length <= 256 && !value.includes('\0')) return value
  return undefined
}

function normalizePreferenceDefinition(value: unknown): AppPreferenceDefinition | null {
  const input = recordValue(value)
  if (!input) return null
  const key = boundedText(input.key, 128)
  const section = enumValue(input.section, PREFERENCE_SECTIONS)
  const label = boundedText(input.label, 128)
  const type = enumValue(input.type, PREFERENCE_TYPES)
  if (!validPreferenceKey(key) || !section || !label || !type) return null

  if (type === 'boolean') {
    return typeof input.default === 'boolean' ? { key, section, label, type, default: input.default } : null
  }
  if (type === 'enum') {
    const values = Array.isArray(input.values)
      ? input.values.map((item) => boundedText(item, 64))
      : []
    if (
      values.length === 0
      || values.length > 100
      || values.some((item) => item === undefined)
      || new Set(values).size !== values.length
      || typeof input.default !== 'string'
      || !values.includes(input.default)
    ) return null
    return { key, section, label, type, default: input.default, values: values as string[] }
  }

  const defaultValue = finiteNumber(input.default)
  if (defaultValue === undefined) return null
  let min = finiteNumber(input.min)
  let max = finiteNumber(input.max)
  const step = finiteNumber(input.step)
  if (min !== undefined && max !== undefined && min > max) {
    min = undefined
    max = undefined
  }
  if ((min !== undefined && defaultValue < min) || (max !== undefined && defaultValue > max)) return null
  return {
    key,
    section,
    label,
    type,
    default: defaultValue,
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(step === undefined || step <= 0 ? {} : { step }),
  }
}

function preferenceValue(definition: AppPreferenceDefinition, value: unknown): AppPreferenceValue | undefined {
  if (definition.type === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (definition.type === 'enum') {
    return typeof value === 'string' && definition.values?.includes(value) ? value : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (definition.min !== undefined && value < definition.min) return undefined
  if (definition.max !== undefined && value > definition.max) return undefined
  return value
}

function normalizeAppPreferencesSnapshot(value: unknown): AppPreferencesSnapshot {
  const input = recordValue(value)
  if (!input) throw new Error('Le preferenze ricevute non sono valide.')

  const seenKeys = new Set<string>()
  const invalidSchemaKeys = new Set<string>()
  const schema: AppPreferenceDefinition[] = []
  if (Array.isArray(input.schema)) {
    for (const candidate of input.schema) {
      const definition = normalizePreferenceDefinition(candidate)
      if (!definition) {
        const candidateKey = recordValue(candidate)?.key
        if (validPreferenceKey(candidateKey) && !seenKeys.has(candidateKey)) invalidSchemaKeys.add(candidateKey)
        continue
      }
      if (seenKeys.has(definition.key)) continue
      invalidSchemaKeys.delete(definition.key)
      seenKeys.add(definition.key)
      schema.push(definition)
    }
  }

  const globalInput = recordValue(input.global) ?? {}
  const explicitGlobalInput = recordValue(input.explicitGlobal) ?? {}
  const overridesInput = recordValue(input.overrides) ?? {}
  const effectiveInput = recordValue(input.effective) ?? {}
  const sourcesInput = recordValue(input.sources) ?? {}
  const global: Record<string, AppPreferenceValue> = {}
  const explicitGlobal: Record<string, AppPreferenceValue> = {}
  const overrides: Record<string, AppPreferenceValue> = {}
  const effective: Record<string, AppPreferenceValue> = {}
  const sources: Record<string, 'default' | 'global' | 'workspace'> = {}

  for (const definition of schema) {
    const key = definition.key
    const explicitGlobalValue = preferenceValue(definition, explicitGlobalInput[key])
    global[key] = preferenceValue(definition, globalInput[key]) ?? explicitGlobalValue ?? definition.default
    if (explicitGlobalValue !== undefined) explicitGlobal[key] = explicitGlobalValue
    const overrideValue = preferenceValue(definition, overridesInput[key])
    if (overrideValue !== undefined) overrides[key] = overrideValue
    effective[key] = preferenceValue(definition, effectiveInput[key]) ?? overrideValue ?? global[key]!
    sources[key] = enumValue(sourcesInput[key], PREFERENCE_SOURCES)
      ?? (overrideValue !== undefined ? 'workspace' : explicitGlobalValue !== undefined ? 'global' : 'default')
  }

  const compatibleKeys = new Set([
    ...Object.keys(globalInput),
    ...Object.keys(explicitGlobalInput),
    ...Object.keys(overridesInput),
    ...Object.keys(effectiveInput),
  ])
  for (const key of compatibleKeys) {
    if (seenKeys.has(key) || invalidSchemaKeys.has(key) || !validPreferenceKey(key)) continue
    const explicitGlobalValue = genericPreferenceValue(explicitGlobalInput[key])
    const globalValue = genericPreferenceValue(globalInput[key]) ?? explicitGlobalValue
    const overrideValue = genericPreferenceValue(overridesInput[key])
    const effectiveValue = genericPreferenceValue(effectiveInput[key]) ?? overrideValue ?? globalValue
    if (globalValue !== undefined) global[key] = globalValue
    if (explicitGlobalValue !== undefined) explicitGlobal[key] = explicitGlobalValue
    if (overrideValue !== undefined) overrides[key] = overrideValue
    if (effectiveValue === undefined) continue
    effective[key] = effectiveValue
    sources[key] = enumValue(sourcesInput[key], PREFERENCE_SOURCES)
      ?? (overrideValue !== undefined ? 'workspace' : explicitGlobalValue !== undefined ? 'global' : 'default')
  }

  const recoveryInput = recordValue(input.recovery)
  const correlationId = boundedText(recoveryInput?.correlationId, 32)
  const globalCount = finiteNumber(recoveryInput?.globalCount)
  const workspaceCount = finiteNumber(recoveryInput?.workspaceCount)
  const recovery = recoveryInput?.kind === 'corrupt'
    && correlationId !== undefined
    && /^ERR-[A-F0-9]{6}$/u.test(correlationId)
    && globalCount !== undefined
    && Number.isSafeInteger(globalCount)
    && globalCount >= 0
    && workspaceCount !== undefined
    && Number.isSafeInteger(workspaceCount)
    && workspaceCount >= 0
    ? { kind: 'corrupt' as const, correlationId, globalCount, workspaceCount }
    : undefined

  return {
    schema,
    global,
    explicitGlobal,
    overrides,
    effective,
    sources,
    workspaceAvailable: typeof input.workspaceAvailable === 'boolean' ? input.workspaceAvailable : false,
    ...(recovery ? { recovery } : {}),
  }
}

function preferenceRecoveryError(preferences: AppPreferencesSnapshot) {
  const recovery = preferences.recovery
  if (!recovery) return null
  return new Error(`Alcune preferenze non valide sono state ripristinate ai valori sicuri. Controlla i valori e riprova. [PERSISTENCE_PREFERENCES_CORRUPT] [${recovery.correlationId}]`)
}

function errorValue(error: unknown) {
  return error instanceof Error ? error : new Error('Preferenze non disponibili.')
}

export function createAppPreferencesStore(fetchPreferences: () => Promise<AppPreferencesSnapshot>) {
  let snapshot: AppPreferencesStoreSnapshot = {
    workspaceKey: null,
    generation: 0,
    error: null,
    loading: false,
    preferences: null,
  }
  let publicationRevision = 0
  let requestRevision = 0
  let activeRequestId = 0
  const listeners = new Set<() => void>()
  const inFlight = new Map<string, { id: number; promise: Promise<AppPreferencesSnapshot | null> }>()

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const captureContext = (): AppPreferencesContext => ({
    workspaceKey: snapshot.workspaceKey,
    generation: snapshot.generation,
  })
  const publish = (preferences: AppPreferencesSnapshot, context = captureContext()) => {
    if (!sameContext(snapshot, context)) return null
    const normalized = normalizeAppPreferencesSnapshot(preferences)
    publicationRevision += 1
    activeRequestId = ++requestRevision
    snapshot = { ...snapshot, error: preferenceRecoveryError(normalized), loading: false, preferences: normalized }
    emit()
    return normalized
  }
  const fetchForContext = (context: AppPreferencesContext, deduplicate: boolean) => {
    const key = requestKey(context)
    const pending = inFlight.get(key)
    if (deduplicate && pending) return pending.promise

    const requestId = ++requestRevision
    activeRequestId = requestId
    const revision = publicationRevision
    if (sameContext(snapshot, context)) {
      snapshot = { ...snapshot, error: null, loading: true }
      emit()
    }
    let request!: Promise<AppPreferencesSnapshot | null>
    request = Promise.resolve()
      .then(fetchPreferences)
      .then(normalizeAppPreferencesSnapshot)
      .then((preferences) => {
        if (!sameContext(snapshot, context) || publicationRevision !== revision || activeRequestId !== requestId) return null
        snapshot = { ...snapshot, error: preferenceRecoveryError(preferences), loading: false, preferences }
        emit()
        return preferences
      })
      .catch((error) => {
        const nextError = errorValue(error)
        if (sameContext(snapshot, context) && publicationRevision === revision && activeRequestId === requestId) {
          snapshot = { ...snapshot, error: nextError, loading: false }
          emit()
        }
        throw nextError
      })
      .finally(() => {
        if (inFlight.get(key)?.id === requestId) inFlight.delete(key)
      })
    inFlight.set(key, { id: requestId, promise: request })
    return request
  }
  const ensure = () => snapshot.preferences
    ? Promise.resolve(snapshot.preferences)
    : fetchForContext(captureContext(), true)
  const refresh = () => fetchForContext(captureContext(), false)
  const setWorkspace = (workspaceKey: AppPreferencesWorkspaceKey) => {
    if (snapshot.workspaceKey === workspaceKey) return
    publicationRevision += 1
    snapshot = {
      workspaceKey,
      generation: snapshot.generation + 1,
      error: null,
      loading: false,
      preferences: null,
    }
    emit()
    void fetchForContext(captureContext(), true).catch(() => {
      // fetchForContext ha già pubblicato l'errore nello snapshot osservato dalla UI;
      // questa Promise fire-and-forget non deve produrre una seconda notifica globale.
    })
  }

  return {
    captureContext,
    ensure,
    getSnapshot: () => snapshot,
    publish,
    refresh,
    setWorkspace,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const appPreferencesStore = createAppPreferencesStore(() => bridgeNamespace('preferences').get())

export function setAppPreferencesWorkspace(workspaceKey: AppPreferencesWorkspaceKey) {
  appPreferencesStore.setWorkspace(workspaceKey)
}

export function publishAppPreferences(preferences: AppPreferencesSnapshot) {
  return appPreferencesStore.publish(preferences)
}

export function refreshAppPreferences() {
  return appPreferencesStore.refresh()
}

export function useAppPreferences() {
  const snapshot = useSyncExternalStore(
    appPreferencesStore.subscribe,
    appPreferencesStore.getSnapshot,
    appPreferencesStore.getSnapshot,
  )

  useEffect(() => {
    if (snapshot.preferences || snapshot.loading || snapshot.error) return
    void appPreferencesStore.ensure().catch(() => {
      // Lo store espone già snapshot.error e chiude loading; Settings ne possiede il banner e il retry.
    })
  }, [snapshot.error, snapshot.generation, snapshot.loading, snapshot.preferences])

  const refresh = useCallback(() => appPreferencesStore.refresh(), [])
  const publishPreferences = useCallback((preferences: AppPreferencesSnapshot) => appPreferencesStore.publish(preferences, {
    workspaceKey: snapshot.workspaceKey,
    generation: snapshot.generation,
  }), [snapshot.generation, snapshot.workspaceKey])
  return {
    preferences: snapshot.preferences,
    preferencesError: snapshot.error,
    preferencesLoading: snapshot.loading,
    publishPreferences,
    refresh,
    retryPreferences: refresh,
  }
}

export function effectivePreference<T extends AppPreferenceValue>(preferences: AppPreferencesSnapshot | null, key: string, fallback: T): T {
  const value = preferences?.effective[key]
  return (value === undefined ? fallback : value) as T
}

export function terminalFontFamily(value: string) {
  if (value === 'menlo') return 'Menlo, Monaco, Consolas, monospace'
  if (value === 'monaco') return 'Monaco, Menlo, Consolas, monospace'
  return '"SF Mono", Menlo, Monaco, Consolas, monospace'
}
