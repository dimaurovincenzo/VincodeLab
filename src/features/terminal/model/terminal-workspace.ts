export type TerminalWorkspaceAction = 'focus' | 'next' | 'previous' | 'new' | 'close'

export type TerminalWorkspaceActionRequest = {
  id: number
  action: TerminalWorkspaceAction
}
