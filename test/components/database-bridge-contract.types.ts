import type { DatabaseApi, VincodeLabBridge } from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

type DatabaseApiKey =
  | 'listConnections'
  | 'createConnection'
  | 'updateConnection'
  | 'deleteConnection'
  | 'connect'
  | 'disconnect'
  | 'execute'
  | 'cancel'
  | 'begin'
  | 'commit'
  | 'rollback'
  | 'inspectSchema'
  | 'inspectRoutine'
  | 'tableRows'
  | 'updateTableRows'
  | 'listSavedQueries'
  | 'saveQuery'
  | 'updateSavedQuery'
  | 'deleteSavedQuery'
  | 'listHistory'
  | 'clearHistory'

export type DatabaseBridgeContractAssertions = [
  Expect<Equal<Window['vincodeLab']['database'], DatabaseApi>>,
  Expect<Equal<VincodeLabBridge['database'], DatabaseApi>>,
  Expect<Equal<keyof DatabaseApi, DatabaseApiKey>>,
]

// @ts-expect-error Il DTO Database deve essere importato dal bridge, non dichiarato globalmente.
export type DatabaseContractMustNotBeGlobal = DatabaseConnection
