// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PiRuntimeStatus } from '@/bridge'
import { useSettingsRefresh } from '@/features/settings/hooks/use-settings-refresh'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('Settings refresh controller', () => {
  it('ignora uno snapshot precedente che termina dopo il refresh più recente', async () => {
    const firstStatus = deferred<PiRuntimeStatus>()
    const secondStatus = deferred<PiRuntimeStatus>()
    const status = vi.fn()
      .mockImplementationOnce(() => firstStatus.promise)
      .mockImplementationOnce(() => secondStatus.promise)
    Object.defineProperty(window, 'vincodeLab', {
      configurable: true,
      value: {
        piSystem: {
          list: vi.fn(async () => []),
          listSkills: vi.fn(async () => []),
          status,
        },
        runtime: { capabilities: vi.fn(async () => ({ checkedAt: '2026-08-24T00:00:00.000Z', items: [] })) },
        systemSkills: { list: vi.fn(async () => []) },
        updates: { list: vi.fn(async () => []) },
      } as unknown as Window['vincodeLab'],
    })

    const { result } = renderHook(() => useSettingsRefresh())
    await waitFor(() => expect(status).toHaveBeenCalledTimes(1))

    let latestRefresh!: Promise<void>
    act(() => { latestRefresh = result.current.refresh() })
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondStatus.resolve({ state: 'ready', executable: '/new/pi', version: '2.0.0' })
      await latestRefresh
    })
    expect(result.current.status).toMatchObject({ executable: '/new/pi', version: '2.0.0' })

    await act(async () => {
      firstStatus.resolve({ state: 'ready', executable: '/old/pi', version: '1.0.0' })
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.status).toMatchObject({ executable: '/new/pi', version: '2.0.0' }))
  })
})
