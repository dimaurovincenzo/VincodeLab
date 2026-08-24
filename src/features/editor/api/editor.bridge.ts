import { getVincodeLabBridge } from '@/bridge'

export const editorBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get files() { return getVincodeLabBridge().files },
  get github() { return getVincodeLabBridge().github },
  get managedSsh() { return getVincodeLabBridge().managedSsh },
  get remoteFiles() { return getVincodeLabBridge().remoteFiles },
}
