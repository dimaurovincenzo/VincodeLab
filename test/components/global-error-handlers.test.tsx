import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installGlobalErrorHandlers } from '@/lib/global-error-handlers'
import { toastStore } from '@/components/ui/toast-store'

afterEach(() => {
  toastStore.remove()
  vi.restoreAllMocks()
})

describe('ultima rete di sicurezza renderer', () => {
  it('trasforma una rejection non gestita in diagnostica sicura, toast deduplicato e recovery', () => {
    const reload = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dispose = installGlobalErrorHandlers({ reload })

    act(() => {
      const first = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent
      Object.defineProperty(first, 'reason', { value: new Error('token=private /Users/maria/work') })
      window.dispatchEvent(first)
      const second = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent
      Object.defineProperty(second, 'reason', { value: new Error('token=private /Users/maria/work') })
      window.dispatchEvent(second)
      expect(first.defaultPrevented).toBe(true)
    })

    expect(toastStore.getCount()).toBe(1)
    const item = toastStore.getVisibleToasts()[0]
    expect(item.title).toBe('Operazione asincrona non completata')
    expect(item.meta?.errorExperience).toEqual({ occurrences: 2 })
    expect(item.description).not.toContain('private')
    item.action?.onClick()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private')
    dispose()
  })

  it('registra le cancellazioni senza mostrare un errore all utente', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const dispose = installGlobalErrorHandlers()
    const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new DOMException('Aborted', 'AbortError') })

    act(() => { window.dispatchEvent(event) })

    expect(event.defaultPrevented).toBe(true)
    expect(toastStore.getCount()).toBe(0)
    dispose()
  })
})
