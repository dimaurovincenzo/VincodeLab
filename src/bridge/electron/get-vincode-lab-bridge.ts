import type { VincodeLabBridge } from '../contracts/vincode-lab-bridge'

export function getVincodeLabBridge(): VincodeLabBridge {
  const bridge = optionalVincodeLabBridge()
  if (!bridge) {
    throw new Error('Il bridge Electron di VincodeLab non è disponibile.')
  }
  return bridge
}

export function optionalVincodeLabBridge(): VincodeLabBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return window.vincodeLab
}

export function bridgeNamespace<K extends keyof VincodeLabBridge>(namespace: K): VincodeLabBridge[K] {
  return getVincodeLabBridge()[namespace]
}
