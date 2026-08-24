import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitBridge } from '@/features/git'
import { githubBridge } from '@/features/github'

const originalBridge = window.vincodeLab

function installBridge(bridge: Window['vincodeLab'] | undefined) {
  Object.defineProperty(window, 'vincodeLab', { configurable: true, value: bridge, writable: true })
}

function testBridge(marker: string) {
  const gitStatus = vi.fn(async () => `${marker}:git`)
  const data = vi.fn(async () => `${marker}:github`)
  const contextMenu = { onAction: vi.fn(() => () => undefined) }

  return {
    bridge: { contextMenu, github: { data, gitStatus } } as unknown as Window['vincodeLab'],
    contextMenu,
    data,
    gitStatus,
  }
}

afterEach(() => installBridge(originalBridge))

describe('adapter Git e GitHub del renderer', () => {
  it('risolvono in modo differito i rispettivi comandi dall’istanza bridge corrente', async () => {
    const first = testBridge('first')
    const second = testBridge('second')

    installBridge(first.bridge)
    await expect(gitBridge.gitStatus()).resolves.toBe('first:git')
    await expect(githubBridge.data()).resolves.toBe('first:github')
    expect(gitBridge.contextMenu).toBe(first.contextMenu)

    installBridge(second.bridge)
    await expect(gitBridge.gitStatus()).resolves.toBe('second:git')
    await expect(githubBridge.data()).resolves.toBe('second:github')
    expect(gitBridge.contextMenu).toBe(second.contextMenu)

    expect(first.gitStatus).toHaveBeenCalledTimes(1)
    expect(first.data).toHaveBeenCalledTimes(1)
    expect(second.gitStatus).toHaveBeenCalledTimes(1)
    expect(second.data).toHaveBeenCalledTimes(1)
  })
})
