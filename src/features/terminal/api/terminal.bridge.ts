import { getVincodeLabBridge } from '@/bridge'

export const terminalBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get managedSsh() { return getVincodeLabBridge().managedSsh },
  get shellSessions() { return getVincodeLabBridge().shellSessions },
  get workspaceCommands() { return getVincodeLabBridge().workspaceCommands },
}
