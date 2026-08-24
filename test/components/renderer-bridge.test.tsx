import { afterEach, describe, expect, it } from 'vitest'
import { bridgeNamespace, getVincodeLabBridge, optionalVincodeLabBridge } from '@/bridge'

const originalBridge = window.vincodeLab

function installBridge(bridge: Window['vincodeLab'] | undefined) {
  Object.defineProperty(window, 'vincodeLab', { configurable: true, value: bridge, writable: true })
}

afterEach(() => installBridge(originalBridge))

describe('renderer bridge', () => {
  it('risolve il preload in modo differito e usa sempre l’istanza corrente', () => {
    const first = { files: { marker: 'first' } } as unknown as Window['vincodeLab']
    const second = { files: { marker: 'second' } } as unknown as Window['vincodeLab']

    installBridge(first)
    expect(getVincodeLabBridge()).toBe(first)
    expect(bridgeNamespace('files')).toBe(first.files)

    installBridge(second)
    expect(getVincodeLabBridge()).toBe(second)
    expect(bridgeNamespace('files')).toBe(second.files)
  })

  it('distingue il bridge opzionale da quello richiesto', () => {
    installBridge(undefined)

    expect(optionalVincodeLabBridge()).toBeUndefined()
    expect(() => getVincodeLabBridge()).toThrow('Il bridge Electron di VincodeLab non è disponibile.')
  })
})
