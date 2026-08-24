import { getVincodeLabBridge } from '@/bridge'

export const settingsBridge = {
  get piConfig() { return getVincodeLabBridge().piConfig },
  get piSystem() { return getVincodeLabBridge().piSystem },
  get preferences() { return getVincodeLabBridge().preferences },
  get runtime() { return getVincodeLabBridge().runtime },
  get systemSkills() { return getVincodeLabBridge().systemSkills },
  get updates() { return getVincodeLabBridge().updates },
}
