export { workspaceBridge } from './api/workspace.bridge'
export { WorkspaceSwitcher } from './components/workspace-switcher'
export {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_DEBOUNCE_MS,
  WORKSPACE_SESSION_VERSION,
  WorkspaceSessionClient,
  createDefaultWorkspaceSessionState,
  createWorkspaceSessionClient,
  normalizeWorkspaceSessionState,
} from './model/workspace-session'
export type {
  WorkspaceSessionClientOptions,
  WorkspaceSessionClientSnapshot,
  WorkspaceSessionClientState,
  WorkspaceSessionLoadResult,
  WorkspaceSessionLoadSource,
  WorkspaceSessionRecovery,
  WorkspaceSessionStorage,
  WorkspaceSessionUpdater,
} from './model/workspace-session'
