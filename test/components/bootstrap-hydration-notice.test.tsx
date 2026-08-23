// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BootstrapHydrationNotice } from '@/components/bootstrap-hydration-notice'
import { normalizeUserError } from '@/lib/user-error'
import { clearVolatileDrafts, writeVolatileDraft } from '@/lib/volatile-draft-store'

describe('BootstrapHydrationNotice', () => {
  it('resta visibile fino alla chiusura esplicita ed espone diagnostica copiabile', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn<(value: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const error = normalizeUserError(new Error('token=privato /Users/maria/draft.json'), {
      category: 'persistence',
      component: 'renderer-bootstrap',
      operation: 'hydrate-drafts',
      severity: 'warning',
      title: 'Alcune bozze non sono state ripristinate',
      description: 'Le bozze valide restano disponibili.',
    })

    render(<BootstrapHydrationNotice error={error} />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(`Riferimento ${error.correlationId}`)
    expect(notice).not.toHaveTextContent(/privato|\/Users\/maria/u)

    await user.click(within(notice).getByRole('button', { name: 'Mostra dettagli' }))
    await user.click(within(notice).getByRole('button', { name: 'Copia diagnostica' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain(`Riferimento: ${error.correlationId}`)
    expect(writeText.mock.calls[0][0]).not.toMatch(/privato|\/Users\/maria/u)

    await user.click(within(notice).getByRole('button', { name: 'Chiudi avviso' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('ritenta la reidratazione e rimuove l’avviso soltanto dopo un esito sano', async () => {
    const error = normalizeUserError(new DOMException('Draft hydration timeout', 'TimeoutError'), {
      category: 'persistence',
      component: 'renderer-bootstrap',
      operation: 'hydrate-drafts',
      severity: 'warning',
      title: 'Bozze temporanee non ripristinate',
      description: 'I file salvati non sono stati modificati.',
    })
    const onRetry = vi.fn(async () => null)
    const user = userEvent.setup()

    render(<BootstrapHydrationNotice error={error} onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: 'Riprova ripristino' }))

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('mantiene locale la bozza e ripristina la protezione acknowledged senza esporne identita o contenuto', async () => {
    clearVolatileDrafts()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('write fallita token=privato CONTENUTO_PRIVATO'))
      .mockResolvedValueOnce({ stored: true })
    Object.defineProperty(window, 'vincodeLab', {
      configurable: true,
      value: {
        volatileDrafts: {
          discard: vi.fn(async () => ({ discarded: true })),
          list: vi.fn(async () => []),
          write,
        },
      } as unknown as Window['vincodeLab'],
    })
    const user = userEvent.setup()
    render(<BootstrapHydrationNotice error={null} />)

    act(() => writeVolatileDraft({
      resource: 'risorsa-privata',
      scope: 'project-editor',
      workspace: '/Users/maria/workspace-privato',
    }, 'CONTENUTO_PRIVATO', 'baseline-privata'))

    const notice = await screen.findByRole('status')
    expect(within(notice).getByRole('heading', { name: 'Protezione delle bozze temporaneamente degradata' })).toBeVisible()
    expect(notice).toHaveTextContent('Le bozze restano disponibili in memoria')
    expect(notice).not.toHaveTextContent(/CONTENUTO_PRIVATO|risorsa-privata|workspace-privato|token=privato/u)
    await user.click(within(notice).getByRole('button', { name: 'Mostra dettagli' }))
    expect(notice).not.toHaveTextContent(/CONTENUTO_PRIVATO|risorsa-privata|workspace-privato|token=privato/u)

    await user.click(within(notice).getByRole('button', { name: 'Ripristina protezione' }))

    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Protezione delle bozze temporaneamente degradata' })).not.toBeInTheDocument())
    clearVolatileDrafts()
  })
})
