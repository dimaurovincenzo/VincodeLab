import { afterEach, describe, expect, it } from 'vitest'
import { remoteFilesBridge } from '@/features/remote-files'

const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'vincodeLab')

function installBridge(bridge: unknown) {
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: bridge as Window['vincodeLab'],
  })
}

afterEach(() => {
  if (originalBridgeDescriptor) Object.defineProperty(window, 'vincodeLab', originalBridgeDescriptor)
  else Reflect.deleteProperty(window, 'vincodeLab')
})

describe('Remote Files bridge', () => {
  it('risolve ogni namespace al momento dell’accesso', () => {
    const first = {
      contextMenu: { generation: 'first-context-menu' },
      managedSsh: { generation: 'first-managed-ssh' },
      remoteFiles: { generation: 'first-remote-files' },
      workspaceCommands: { generation: 'first-workspace-commands' },
    }
    const second = {
      contextMenu: { generation: 'second-context-menu' },
      managedSsh: { generation: 'second-managed-ssh' },
      remoteFiles: { generation: 'second-remote-files' },
      workspaceCommands: { generation: 'second-workspace-commands' },
    }

    installBridge(first)
    expect(remoteFilesBridge.contextMenu).toBe(first.contextMenu)
    expect(remoteFilesBridge.managedSsh).toBe(first.managedSsh)
    expect(remoteFilesBridge.remoteFiles).toBe(first.remoteFiles)
    expect(remoteFilesBridge.workspaceCommands).toBe(first.workspaceCommands)

    installBridge(second)
    expect(remoteFilesBridge.contextMenu).toBe(second.contextMenu)
    expect(remoteFilesBridge.managedSsh).toBe(second.managedSsh)
    expect(remoteFilesBridge.remoteFiles).toBe(second.remoteFiles)
    expect(remoteFilesBridge.workspaceCommands).toBe(second.workspaceCommands)
  })
})
