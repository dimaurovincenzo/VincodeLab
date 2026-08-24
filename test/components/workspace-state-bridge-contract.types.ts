import type { VincodeLabBridge, VolatileDraftsApi, WorkspaceSessionApi } from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

export type WorkspaceStateBridgeContractAssertions = [
  Expect<Equal<VincodeLabBridge['workspaceSession'], WorkspaceSessionApi>>,
  Expect<Equal<keyof WorkspaceSessionApi, 'get' | 'save'>>,
  Expect<Equal<VincodeLabBridge['volatileDrafts'], VolatileDraftsApi>>,
  Expect<Equal<keyof VolatileDraftsApi, 'list' | 'write' | 'discard'>>,
]

// @ts-expect-error Lo stato sessione deve essere importato dal bridge, non dichiarato globalmente.
export type WorkspaceSessionContractMustNotBeGlobal = WorkspaceSessionState

// @ts-expect-error La bozza renderer deve essere importata dal bridge, non dichiarata globalmente.
export type RendererDraftContractMustNotBeGlobal = RendererDraftSnapshot
