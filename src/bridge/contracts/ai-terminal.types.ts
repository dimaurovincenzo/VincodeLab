export type AiTerminalRuntime = 'herdr' | 'pi'

export type AiTerminalFallbackReason =
  | 'missing'
  | 'not-executable'
  | 'timeout'
  | 'invalid-version-output'
  | 'preflight-failed'
  | 'spawn-failed'
  | 'early-exit'
  | 'nested-herdr'
  | 'disabled'

export type AiTerminalRuntimeState = {
  runtime: AiTerminalRuntime
  fallbackReason?: AiTerminalFallbackReason
  piAvailable?: boolean
}

export type AiTerminalReloadResult =
  | { reloaded: true; runtime: 'pi' }
  | { reloaded: false; runtime: 'herdr'; reason: 'active-pane-ambiguous' }

export type AiTerminalRestartOptions = { runtime: 'pi' }

export type AiTerminalRestartResult = {
  restarted: true
  runtime: AiTerminalRuntime
  fallbackReason?: AiTerminalFallbackReason
  piAvailable?: boolean
}

export type PiApi = {
  reload: () => Promise<AiTerminalReloadResult>
  restart: (options?: AiTerminalRestartOptions) => Promise<AiTerminalRestartResult>
}
