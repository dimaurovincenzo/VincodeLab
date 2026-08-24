import type * as Bridge from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type ExpectedApplicationErrorCategory =
  | 'validation'
  | 'not-found'
  | 'permission'
  | 'authentication'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'conflict'
  | 'process'
  | 'database'
  | 'filesystem'
  | 'git'
  | 'github'
  | 'remote'
  | 'configuration'
  | 'persistence'
  | 'internal'

type ExpectedApplicationErrorSeverity = 'info' | 'warning' | 'error'

interface ExpectedPublicApplicationError {
  category: ExpectedApplicationErrorCategory
  code: string
  correlationId: string
  message: string
  recoverable: boolean
  severity: ExpectedApplicationErrorSeverity
}

interface ExpectedWorkspaceOpenResult {
  path?: string
  error?: string
  errorIncident?: ExpectedPublicApplicationError
}

interface ExpectedRecentWorkspace {
  path: string
  lastOpenedAt: number
}

interface ExpectedWorkspaceInstanceStatus {
  activeCount: number
  maxInstances: 2
  canOpenNew: boolean
  workspaceOpenElsewhere: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path'
}

interface ExpectedWorkspaceLaunchResult {
  launched: boolean
  reason?: 'limit' | 'duplicate' | 'invalid-path' | 'launch-failed'
  message?: string
}

type ExpectedWorkspaceApi = {
  open: () => Promise<ExpectedWorkspaceOpenResult | null>
  getActive: () => Promise<ExpectedWorkspaceOpenResult | null>
  listRecent: () => Promise<ExpectedRecentWorkspace[]>
  reveal: () => Promise<{ revealed: true }>
  openRecent: (workspacePath: string) => Promise<ExpectedWorkspaceOpenResult>
  instanceStatus: (workspacePath?: string) => Promise<ExpectedWorkspaceInstanceStatus>
  openInNewInstance: (workspacePath: string) => Promise<ExpectedWorkspaceLaunchResult>
  onOpened: (listener: (result: ExpectedWorkspaceOpenResult | null) => void) => () => void
}

type ExpectedAppAppearance = 'system' | 'light' | 'dark'
type ExpectedAppearanceApi = {
  get: () => Promise<ExpectedAppAppearance>
  set: (appearance: ExpectedAppAppearance) => Promise<ExpectedAppAppearance>
}

export type WorkspaceAppearanceBridgeContractAssertions = [
  Expect<Equal<Bridge.ApplicationErrorCategory, ExpectedApplicationErrorCategory>>,
  Expect<Equal<Bridge.ApplicationErrorSeverity, ExpectedApplicationErrorSeverity>>,
  Expect<Equal<Bridge.PublicApplicationError, ExpectedPublicApplicationError>>,
  Expect<Equal<Bridge.WorkspaceOpenResult, ExpectedWorkspaceOpenResult>>,
  Expect<Equal<Bridge.RecentWorkspace, ExpectedRecentWorkspace>>,
  Expect<Equal<Bridge.WorkspaceInstanceStatus, ExpectedWorkspaceInstanceStatus>>,
  Expect<Equal<Bridge.WorkspaceLaunchResult, ExpectedWorkspaceLaunchResult>>,
  Expect<Equal<Bridge.WorkspaceApi, ExpectedWorkspaceApi>>,
  Expect<Equal<Window['vincodeLab']['workspace'], Bridge.WorkspaceApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['workspace'], Bridge.WorkspaceApi>>,
  Expect<Equal<keyof Bridge.WorkspaceApi,
    | 'open'
    | 'getActive'
    | 'listRecent'
    | 'reveal'
    | 'openRecent'
    | 'instanceStatus'
    | 'openInNewInstance'
    | 'onOpened'
  >>,
  Expect<Equal<Bridge.AppAppearance, ExpectedAppAppearance>>,
  Expect<Equal<Bridge.AppearanceApi, ExpectedAppearanceApi>>,
  Expect<Equal<Window['vincodeLab']['appearance'], Bridge.AppearanceApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['appearance'], Bridge.AppearanceApi>>,
  Expect<Equal<keyof Bridge.AppearanceApi, 'get' | 'set'>>,
]

// @ts-expect-error La categoria errore deve essere importata dal bridge, non dichiarata globalmente.
export type ApplicationErrorCategoryContractMustNotBeGlobal = ApplicationErrorCategory
// @ts-expect-error La severità errore deve essere importata dal bridge, non dichiarata globalmente.
export type ApplicationErrorSeverityContractMustNotBeGlobal = ApplicationErrorSeverity
// @ts-expect-error L'errore pubblico deve essere importato dal bridge, non dichiarato globalmente.
export type PublicApplicationErrorContractMustNotBeGlobal = PublicApplicationError
// @ts-expect-error Il risultato workspace deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceOpenResultContractMustNotBeGlobal = WorkspaceOpenResult
// @ts-expect-error I workspace recenti devono essere importati dal bridge, non dichiarati globalmente.
export type RecentWorkspaceContractMustNotBeGlobal = RecentWorkspace
// @ts-expect-error Lo stato istanza deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceInstanceStatusContractMustNotBeGlobal = WorkspaceInstanceStatus
// @ts-expect-error Il risultato di avvio deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceLaunchResultContractMustNotBeGlobal = WorkspaceLaunchResult
// @ts-expect-error L'API workspace deve essere importata dal bridge, non dichiarata globalmente.
export type WorkspaceApiContractMustNotBeGlobal = WorkspaceApi
// @ts-expect-error L'apparenza deve essere importata dal bridge, non dichiarata globalmente.
export type AppAppearanceContractMustNotBeGlobal = AppAppearance
// @ts-expect-error L'API appearance deve essere importata dal bridge, non dichiarata globalmente.
export type AppearanceApiContractMustNotBeGlobal = AppearanceApi
