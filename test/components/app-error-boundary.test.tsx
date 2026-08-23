import fs from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from '@/components/app-error-boundary'

let faultEnabled = false

function GlobalSurface() {
  if (faultEnabled) throw new Error('bootstrap fault')
  return <p>Superficie globale operativa</p>
}

describe('AppErrorBoundary globale', () => {
  beforeEach(() => {
    faultEnabled = false
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('avvolge App al bootstrap, fuori dai boundary delle singole viste', () => {
    const bootstrap = fs.readFileSync(path.join(process.cwd(), 'src/main.tsx'), 'utf8')

    expect(bootstrap).toMatch(/<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/)
  })

  it('mostra un riferimento correlabile, registra il fault e consente il recovery', async () => {
    const user = userEvent.setup()
    faultEnabled = true
    render(<AppErrorBoundary><GlobalSurface /></AppErrorBoundary>)

    const alert = await screen.findByRole('alert')
    const reference = within(alert).getByText(/^Riferimento ERR-/u).textContent ?? ''
    const errorId = reference.replace('Riferimento ', '')
    expect(errorId).toMatch(/^ERR-[A-F0-9]{6}$/u)
    expect(alert).toHaveFocus()

    const diagnosticCall = vi.mocked(console.error).mock.calls.find(([message]) => (
      typeof message === 'string' && message.includes('"event":"renderer_user_error"')
    ))
    expect(JSON.parse(String(diagnosticCall?.[0]))).toEqual({
      event: 'renderer_user_error',
      category: 'internal',
      component: 'renderer-app',
      correlationId: errorId,
      operation: 'render',
      severity: 'error',
    })

    await user.click(within(alert).getByRole('button', { name: 'Mostra dettagli' }))
    expect(within(alert).getByText(new RegExp(`Riferimento: ${errorId}`, 'u'))).toBeVisible()
    expect(within(alert).queryByText(/stack/u)).not.toBeInTheDocument()

    faultEnabled = false
    await user.click(within(alert).getByRole('button', { name: 'Riprova' }))

    expect(await screen.findByText('Superficie globale operativa')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
