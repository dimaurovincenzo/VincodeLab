import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { BENCHMARK_VIEW_FAULT_EVENT, BenchmarkViewFaultProbe } from '@/components/benchmark-view-fault-probe'
import { ViewErrorBoundary } from '@/components/view-error-boundary'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: { benchmark: { injectFault: vi.fn(), probe: vi.fn(), shutdown: vi.fn() } } as unknown as Window['vincodeLab'],
  })
})

it('provoca un crash React locale soltanto in fault mode e recupera la vista senza esporre il dettaglio', async () => {
  const user = userEvent.setup()
  const refreshRecoveryState = vi.fn()
  render(<main><nav aria-label="Navigazione principale">Shell disponibile</nav><ViewErrorBoundary viewName="Editor" onRetry={refreshRecoveryState}><BenchmarkViewFaultProbe viewName="Editor" /><p>Contenuto Editor</p></ViewErrorBoundary></main>)

  window.dispatchEvent(new CustomEvent(BENCHMARK_VIEW_FAULT_EVENT, { detail: { viewName: 'Editor' } }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Editor non è disponibile')
  expect(alert).not.toHaveTextContent(/benchmark-react-secret|access_token|\/tmp\/vincodelab-private/iu)
  await waitFor(() => expect(alert).toHaveFocus())
  expect(screen.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
  expect(refreshRecoveryState).toHaveBeenCalledOnce()
  await waitFor(() => expect(screen.getByText('Contenuto Editor')).toBeVisible())
})
