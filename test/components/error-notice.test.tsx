import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorNotice } from '@/components/ui'
import { normalizeUserError } from '@/lib/user-error'

describe('ErrorNotice', () => {
  it('usa la live region coerente, espone recovery e dettagli sanitizzati da tastiera', async () => {
    const user = userEvent.setup()
    const retry = vi.fn()
    const error = normalizeUserError(new Error('token=segreto /Users/maria/work/query.sql'), {
      category: 'database',
      component: 'database',
      operation: 'execute-query',
      title: 'Query non completata',
      description: 'Il testo della query è stato mantenuto.',
    })
    render(<ErrorNotice action={{ label: 'Riprova', onClick: retry }} error={error} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
    expect(within(alert).getByText('Il testo della query è stato mantenuto.')).toBeVisible()
    await user.tab()
    expect(within(alert).getByRole('button', { name: 'Riprova' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(retry).toHaveBeenCalledTimes(1)

    await user.click(within(alert).getByRole('button', { name: 'Mostra dettagli' }))
    const details = within(alert).getByText(/Categoria: database/u).textContent ?? ''
    expect(details).not.toContain('segreto')
    expect(details).not.toContain('/Users/maria')
  })

  it('annuncia gli avvisi non urgenti senza sottrarre il focus', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    const error = normalizeUserError(null, {
      category: 'configuration',
      severity: 'warning',
      title: 'Configurazione da completare',
      description: 'Apri le impostazioni prima di riprovare.',
    })

    render(<ErrorNotice error={error} />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('conserva la recovery quando l azione fallisce e registra un nuovo riferimento', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const error = normalizeUserError(null, {
      category: 'network',
      title: 'Connessione interrotta',
      description: 'Il contenuto è stato mantenuto.',
    })
    render(<ErrorNotice action={{ label: 'Riconnetti', onClick: async () => { throw new Error('token=private') } }} error={error} />)

    await user.click(screen.getByRole('button', { name: 'Riconnetti' }))

    const recoveryNotice = await screen.findByRole('alert')
    expect(within(recoveryNotice).getByRole('heading', { name: 'Connessione interrotta' })).toBeVisible()
    expect(recoveryNotice).toHaveTextContent('Il contenuto è stato mantenuto. Il tentativo “Riconnetti” non è stato completato; puoi riprovare.')
    expect(recoveryNotice).not.toHaveTextContent('Recupero non completato')
    const recoveryReference = within(recoveryNotice).getByText(/^Riferimento ERR-/u).textContent?.replace('Riferimento ', '') ?? ''
    expect(recoveryReference).not.toBe(error.correlationId)
    await user.click(within(recoveryNotice).getByRole('button', { name: 'Mostra dettagli' }))
    expect(within(recoveryNotice).getByText(new RegExp(`Riferimento: ${recoveryReference}`, 'u'))).toBeVisible()
    await user.click(within(recoveryNotice).getByRole('button', { name: 'Copia diagnostica' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`Riferimento: ${recoveryReference}`))
    expect(consoleError.mock.calls.some(([value]) => typeof value === 'string' && value.includes('renderer_user_error'))).toBe(true)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('private')
    consoleError.mockRestore()
  })
})
