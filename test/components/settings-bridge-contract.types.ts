import type {
  PreferencesApi,
  RuntimeCapabilitiesApi,
  UpdatesApi,
  VincodeLabBridge,
} from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedPreferenceValue = string | number | boolean
interface ExpectedPreferenceDefinition {
  key: string
  section: 'editor' | 'terminal' | 'git' | 'database'
  label: string
  type: 'number' | 'boolean' | 'enum'
  default: ExpectedPreferenceValue
  min?: number
  max?: number
  step?: number
  values?: string[]
}
interface ExpectedPreferencesSnapshot {
  schema: ExpectedPreferenceDefinition[]
  global: Record<string, ExpectedPreferenceValue>
  explicitGlobal: Record<string, ExpectedPreferenceValue>
  overrides: Record<string, ExpectedPreferenceValue>
  effective: Record<string, ExpectedPreferenceValue>
  sources: Record<string, 'default' | 'global' | 'workspace'>
  workspaceAvailable: boolean
  recovery?: {
    kind: 'corrupt'
    correlationId: string
    globalCount: number
    workspaceCount: number
  }
}
type ExpectedPreferencesApi = {
  get: () => Promise<ExpectedPreferencesSnapshot>
  setGlobal: (key: string, value: ExpectedPreferenceValue) => Promise<ExpectedPreferencesSnapshot>
  setWorkspace: (key: string, value: ExpectedPreferenceValue) => Promise<ExpectedPreferencesSnapshot>
  clearWorkspace: (key: string) => Promise<ExpectedPreferencesSnapshot>
  clearAllWorkspace: () => Promise<ExpectedPreferencesSnapshot>
}

interface ExpectedManagedUpdate {
  id: string
  kind: 'skill' | 'pi-extension' | 'pi-runtime'
  name: string
  sourceType: 'github' | 'runtime'
  owner: string | null
  repository: string | null
  ref: string | null
  channel: string
  activeVersion: string
  rollbackVersion: string | null
  availableVersion: string | null
  stagedVersion: string | null
  changelog: string | null
  policy: 'manual' | 'automatic'
  status: string
  restartRequired: boolean
  lastCheckedAt: number | null
  lastError: string | null
}
type ExpectedUpdatesApi = {
  list: () => Promise<ExpectedManagedUpdate[]>
  check: (id?: string) => Promise<ExpectedManagedUpdate[]>
  download: (id: string) => Promise<ExpectedManagedUpdate>
  downloadAll: () => Promise<ExpectedManagedUpdate[]>
  setPolicy: (id: string, policy: 'manual' | 'automatic') => Promise<ExpectedManagedUpdate>
  rollback: (id: string) => Promise<ExpectedManagedUpdate>
  activatePending: () => Promise<Array<{
    id: string
    success: boolean
    error?: string
    update?: ExpectedManagedUpdate
  }>>
}

interface ExpectedRuntimeCapability {
  id: string
  kind: 'included' | 'optional'
  label: string
  state: 'ready' | 'missing' | 'broken'
  code?: string
  detail: string
}
type ExpectedRuntimeCapabilitiesApi = {
  capabilities: () => Promise<{
    checkedAt: string
    items: ExpectedRuntimeCapability[]
  }>
}

export type SettingsBridgeContractAssertions = [
  Expect<Equal<PreferencesApi, ExpectedPreferencesApi>>,
  Expect<Equal<Window['vincodeLab']['preferences'], PreferencesApi>>,
  Expect<Equal<VincodeLabBridge['preferences'], PreferencesApi>>,
  Expect<Equal<keyof PreferencesApi, 'get' | 'setGlobal' | 'setWorkspace' | 'clearWorkspace' | 'clearAllWorkspace'>>,
  Expect<Equal<UpdatesApi, ExpectedUpdatesApi>>,
  Expect<Equal<Window['vincodeLab']['updates'], UpdatesApi>>,
  Expect<Equal<VincodeLabBridge['updates'], UpdatesApi>>,
  Expect<Equal<keyof UpdatesApi, 'list' | 'check' | 'download' | 'downloadAll' | 'setPolicy' | 'rollback' | 'activatePending'>>,
  Expect<Equal<RuntimeCapabilitiesApi, ExpectedRuntimeCapabilitiesApi>>,
  Expect<Equal<Window['vincodeLab']['runtime'], RuntimeCapabilitiesApi>>,
  Expect<Equal<VincodeLabBridge['runtime'], RuntimeCapabilitiesApi>>,
  Expect<Equal<keyof RuntimeCapabilitiesApi, 'capabilities'>>,
]

// @ts-expect-error Le preferenze devono essere importate dal bridge, non dichiarate globalmente.
export type PreferencesContractMustNotBeGlobal = AppPreferencesSnapshot

// @ts-expect-error Le definizioni preferenza devono essere importate dal bridge, non dichiarate globalmente.
export type PreferenceDefinitionContractMustNotBeGlobal = AppPreferenceDefinition

// @ts-expect-error I valori preferenza devono essere importati dal bridge, non dichiarati globalmente.
export type PreferenceValueContractMustNotBeGlobal = AppPreferenceValue

// @ts-expect-error Gli aggiornamenti devono essere importati dal bridge, non dichiarati globalmente.
export type UpdatesContractMustNotBeGlobal = ManagedUpdate

// @ts-expect-error Le capability devono essere importate dal bridge, non dichiarate globalmente.
export type RuntimeCapabilitiesContractMustNotBeGlobal = RuntimeCapabilitiesSnapshot

// @ts-expect-error La singola capability deve essere importata dal bridge, non dichiarata globalmente.
export type RuntimeCapabilityContractMustNotBeGlobal = RuntimeCapability
