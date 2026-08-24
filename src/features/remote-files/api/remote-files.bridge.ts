import { getVincodeLabBridge } from '@/bridge'

export const remoteFilesBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get managedSsh() { return getVincodeLabBridge().managedSsh },
  get remoteFiles() { return getVincodeLabBridge().remoteFiles },
  get workspaceCommands() { return getVincodeLabBridge().workspaceCommands },
}
