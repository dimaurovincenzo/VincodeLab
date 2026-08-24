import { getVincodeLabBridge } from '@/bridge'

export const aiBridge = {
  get instructions() { return getVincodeLabBridge().instructions },
  get pi() { return getVincodeLabBridge().pi },
  get skills() { return getVincodeLabBridge().skills },
  get terminal() { return getVincodeLabBridge().terminal },
  get workspace() { return getVincodeLabBridge().workspace },
}
