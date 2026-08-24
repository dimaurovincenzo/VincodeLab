import { getVincodeLabBridge } from '@/bridge'

export const workspaceBridge = {
  get workspace() { return getVincodeLabBridge().workspace },
}
