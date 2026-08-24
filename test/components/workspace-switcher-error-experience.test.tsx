// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { VincodeLabBridge, WorkspaceInstanceStatus } from '@/bridge'
import { WorkspaceSwitcher } from '@/features/workspace'

const availableStatus: WorkspaceInstanceStatus = {
  activeCount: 1,
  canOpenNew: true,
  maxInstances: 2,
  workspaceOpenElsewhere: false,
}

describe('Error Experience del Workspace Switcher', () => {
  it('mantiene il failure nel popover, verifica di nuovo e recupera l apertura in una nuova finestra', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const instanceStatus = vi.fn()
      .mockRejectedValueOnce(new Error('instance registry non disponibile token=privato'))
      .mockResolvedValue(availableStatus)
    const onOpenNew = vi.fn()
      .mockRejectedValueOnce(new Error('launch fallito token=privato'))
      .mockResolvedValueOnce(true)
    Object.defineProperty(window, 'vincodeLab', {
      configurable: true,
      value: { workspace: { instanceStatus } } as unknown as VincodeLabBridge,
    })

    render(<WorkspaceSwitcher
      appIconUrl="/icon.png"
      currentPath="/tmp/corrente"
      onChooseDirectory={vi.fn()}
      onOpenHere={vi.fn()}
      onOpenNew={onOpenNew}
      recents={[
        { lastOpenedAt: 2, path: '/tmp/corrente' },
        { lastOpenedAt: 1, path: '/tmp/altro' },
      ]}
    />)

    await user.click(screen.getByRole('button', { name: /VincodeLab/u }))

    let notice = await screen.findByRole('status')
    expect(within(notice).getByRole('heading', { name: 'Stato delle finestre non disponibile' })).toBeVisible()
    expect(notice).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
    expect(notice).not.toHaveTextContent(/token=privato/u)

    await user.click(within(notice).getByRole('button', { name: 'Riprova verifica' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Stato delle finestre non disponibile' })).not.toBeInTheDocument())

    const otherRow = screen.getByText('altro').closest('article')
    expect(otherRow).not.toBeNull()
    const openNewButton = within(otherRow!).getByRole('button', { name: 'Nuova finestra' })
    expect(openNewButton).toBeEnabled()
    await user.click(openNewButton)

    notice = await screen.findByRole('alert')
    expect(within(notice).getByRole('heading', { name: 'Workspace non aperto in una nuova finestra' })).toBeVisible()
    expect(notice).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
    expect(notice).not.toHaveTextContent(/token=privato/u)

    await user.click(within(notice).getByRole('button', { name: 'Riprova apertura' }))
    await waitFor(() => expect(onOpenNew).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Workspace non aperto in una nuova finestra' })).not.toBeInTheDocument())
  })
})
