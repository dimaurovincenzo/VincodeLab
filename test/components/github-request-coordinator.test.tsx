import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useRequestCoordinator } from '@/features/github/hooks/use-request-coordinator'

describe('coordinatore richieste GitHub', () => {
  it('accetta soltanto l’ultima generazione e invalida esplicitamente le risposte in volo', () => {
    const { result } = renderHook(() => useRequestCoordinator())
    let first = 0
    let second = 0

    act(() => {
      first = result.current.begin()
      second = result.current.begin()
    })

    expect(result.current.isCurrent(first)).toBe(false)
    expect(result.current.isCurrent(second)).toBe(true)

    act(() => { result.current.invalidate() })

    expect(result.current.isCurrent(second)).toBe(false)
  })

  it('mantiene stabili le operazioni tra render per non riavviare polling ed effetti', () => {
    const { rerender, result } = renderHook(() => useRequestCoordinator())
    const initial = result.current

    rerender()

    expect(result.current).toBe(initial)
  })
})
