import { getVincodeLabBridge } from '@/bridge'

/**
 * Native capabilities owned by the application shell.
 *
 * Keeping the lookup lazy preserves the existing preload lifecycle while
 * preventing shell components from depending directly on the global object.
 */
export const appBridge = {
  get appearance() { return getVincodeLabBridge().appearance },
  get appMenu() { return getVincodeLabBridge().appMenu },
  get contextMenu() { return getVincodeLabBridge().contextMenu },
  get files() { return getVincodeLabBridge().files },
  get lifecycle() { return getVincodeLabBridge().lifecycle },
  get workspace() { return getVincodeLabBridge().workspace },
}
