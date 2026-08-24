import { afterEach, describe, expect, it } from 'vitest'
import type { VincodeLabBridge } from '@/bridge'
import { aiBridge } from '@/features/ai/api/ai.bridge'
import { terminalBridge } from '@/features/terminal'

const originalBridge = window.vincodeLab

function installBridge(bridge: VincodeLabBridge | undefined) {
  Object.defineProperty(window, 'vincodeLab', { configurable: true, value: bridge, writable: true })
}

afterEach(() => installBridge(originalBridge))

describe('feature bridge Terminale e AI', () => {
  it('risolve tutti i namespace soltanto al momento dell’uso', () => {
    const first = {
      contextMenu: { marker: 'first-context' },
      managedSsh: { marker: 'first-ssh' },
      pi: { marker: 'first-pi' },
      shellSessions: { marker: 'first-shell' },
      terminal: { marker: 'first-ai-terminal' },
      workspaceCommands: { marker: 'first-commands' },
    } as unknown as VincodeLabBridge
    const second = {
      contextMenu: { marker: 'second-context' },
      managedSsh: { marker: 'second-ssh' },
      pi: { marker: 'second-pi' },
      shellSessions: { marker: 'second-shell' },
      terminal: { marker: 'second-ai-terminal' },
      workspaceCommands: { marker: 'second-commands' },
    } as unknown as VincodeLabBridge

    installBridge(first)
    expect(terminalBridge.contextMenu).toBe(first.contextMenu)
    expect(terminalBridge.managedSsh).toBe(first.managedSsh)
    expect(terminalBridge.shellSessions).toBe(first.shellSessions)
    expect(terminalBridge.workspaceCommands).toBe(first.workspaceCommands)
    expect(aiBridge.pi).toBe(first.pi)
    expect(aiBridge.terminal).toBe(first.terminal)

    installBridge(second)
    expect(terminalBridge.contextMenu).toBe(second.contextMenu)
    expect(terminalBridge.managedSsh).toBe(second.managedSsh)
    expect(terminalBridge.shellSessions).toBe(second.shellSessions)
    expect(terminalBridge.workspaceCommands).toBe(second.workspaceCommands)
    expect(aiBridge.pi).toBe(second.pi)
    expect(aiBridge.terminal).toBe(second.terminal)
  })

  it('propaga il failure centrale quando il preload non è disponibile', () => {
    installBridge(undefined)

    expect(() => terminalBridge.shellSessions).toThrow('Il bridge Electron di VincodeLab non è disponibile.')
    expect(() => aiBridge.terminal).toThrow('Il bridge Electron di VincodeLab non è disponibile.')
  })
})
