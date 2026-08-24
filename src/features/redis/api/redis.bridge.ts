import { getVincodeLabBridge } from '@/bridge'

export const redisBridge = {
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get redis() { return getVincodeLabBridge().redis },
}
