import type { VincodeLabBridge } from './bridge'

declare global {
  interface Window {
    vincodeLab: VincodeLabBridge
  }
}

export {}
