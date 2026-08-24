import { getVincodeLabBridge } from '@/bridge'

export const databaseBridge = {
  get database() { return getVincodeLabBridge().database },
}
