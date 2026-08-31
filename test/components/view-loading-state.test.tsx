import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState } from '@/components/empty-state'
import { ViewLoadingState } from '@/components/view-loading-state'

describe('stati condivisi delle viste', () => {
  it('annuncia il caricamento lazy senza esporre una regione muta', () => {
    render(<ViewLoadingState label="Database" description="Preparazione strumenti dati." />)

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Caricamento Database…')
    expect(status).toHaveTextContent('Preparazione strumenti dati.')
    expect(screen.getByLabelText('Caricamento Database')).toBeInTheDocument()
  })

  it('consente allo stato vuoto di presentare la prossima azione', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(<EmptyState action={<button type="button" onClick={onCreate}>Nuova connessione</button>} description="Configura una connessione." icon={<span>DB</span>} title="Nessuna connessione" />)

    await user.click(screen.getByRole('button', { name: 'Nuova connessione' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
})
