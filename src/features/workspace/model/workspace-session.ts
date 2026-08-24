/**
 * API pubblica della persistenza della sessione workspace.
 *
 * Il formato persistito e i simboli esportati restano centralizzati qui; gli
 * owner interni separano contratto, normalizzazione e policy di storage.
 */
export {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_DEBOUNCE_MS,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
} from './workspace-session.types'
export { normalizeWorkspaceSessionState } from './workspace-session-normalization'
export { WorkspaceSessionClient, createWorkspaceSessionClient } from './workspace-session-client'

export type {
  WorkspaceSessionClientOptions,
  WorkspaceSessionClientSnapshot,
  WorkspaceSessionClientState,
  WorkspaceSessionLoadResult,
  WorkspaceSessionLoadSource,
  WorkspaceSessionRecovery,
  WorkspaceSessionStorage,
  WorkspaceSessionUpdater,
} from './workspace-session.types'
