import { getVincodeLabBridge } from '@/bridge'

export const aiBridge = {
  get pi() { return getVincodeLabBridge().pi },
  get terminal() { return getVincodeLabBridge().terminal },
}
