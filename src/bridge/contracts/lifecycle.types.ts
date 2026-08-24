export type LifecycleCloseReason = 'window' | 'quit'
export type LifecycleCloseDecision = 'proceed' | 'cancel'
export type LifecycleCloseRequest = { requestId: string; reason: LifecycleCloseReason }

export type LifecycleApi = {
  respondToClose: (requestId: string, decision: LifecycleCloseDecision) => void
  onCloseRequested: (listener: (request: LifecycleCloseRequest) => void) => () => void
}
