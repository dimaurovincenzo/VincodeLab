// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalDiagnosticsReport } from '@/bridge'
import { TerminalDiagnostics } from '@/features/ai'
import { TerminalAttachments } from '@/features/ai/components/terminal-attachments'
import { Toaster, toast } from '@/components/ui'

function diagnosticsReport(queuedBytes: number): TerminalDiagnosticsReport {
  return {
    version: 1,
    generatedAt: '2026-08-23T00:00:00.000Z',
    pipeline: {
      receivedBytes: queuedBytes,
      renderedBytes: queuedBytes,
      averageBlockBytes: queuedBytes,
      maxBlockBytes: queuedBytes,
      queuedBytes,
      peakQueuedBytes: queuedBytes,
      pauseCount: 0,
      pausedMs: 0,
    },
    renderer: {
      queuedBlocks: 0,
      ackP50Ms: 1,
      ackP95Ms: 2,
      ackP99Ms: 3,
      slowFrames: 0,
      restoreCount: 0,
      mode: 'standard',
    },
    paste: {
      started: 0,
      completed: 0,
      cancelled: 0,
      rejected: 0,
      acceptedBytes: 0,
      activeTransfers: 0,
      pendingBytes: 0,
    },
  }
}

function installTerminal(terminal: Record<string, unknown>) {
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: { terminal } as unknown as Window['vincodeLab'],
  })
}

describe('Error Experience delle utilità terminale', () => {
  beforeEach(() => {
    toast.remove()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('mantiene le ultime metriche e recupera una lettura diagnostica non riuscita', async () => {
    const user = userEvent.setup()
    const diagnostics = vi.fn()
      .mockResolvedValueOnce(diagnosticsReport(1024))
      .mockRejectedValueOnce(new Error('token=non-mostrare PTY diagnostics unavailable'))
      .mockResolvedValueOnce(diagnosticsReport(2048))
    installTerminal({ diagnostics, exportDiagnostics: vi.fn() })

    render(<TerminalDiagnostics />)
    await user.click(screen.getByRole('button', { name: 'Aggiorna' }))
    const currentQueue = screen.getByText('Coda corrente').parentElement
    await waitFor(() => expect(currentQueue).toHaveTextContent('1 kB'))

    await user.click(screen.getByRole('button', { name: 'Aggiorna' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Diagnostica del terminale non disponibile')).toBeInTheDocument()
    expect(within(failure).getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()
    expect(currentQueue).toHaveTextContent('1 kB')

    await user.click(within(failure).getByRole('button', { name: 'Acquisisci di nuovo' }))
    await waitFor(() => expect(diagnostics).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(currentQueue).toHaveTextContent('2 kB'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offre un nuovo tentativo locale quando il report non viene esportato', async () => {
    const user = userEvent.setup()
    const exportDiagnostics = vi.fn()
      .mockRejectedValueOnce(new Error('password=non-mostrare EACCES'))
      .mockResolvedValueOnce({ exported: true, filePath: '/tmp/terminal-report.json' })
    installTerminal({ diagnostics: vi.fn(), exportDiagnostics })

    render(<><TerminalDiagnostics /><Toaster /></>)
    await user.click(screen.getByRole('button', { name: 'Esporta report' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Report diagnostico non esportato')).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Esporta di nuovo' }))
    await waitFor(() => expect(exportDiagnostics).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Report diagnostico esportato.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deduplica il feedback e permette di scegliere di nuovo un allegato', async () => {
    const user = userEvent.setup()
    const chooseAttachments = vi.fn()
      .mockRejectedValueOnce(new Error('secret=non-mostrare chooser unavailable'))
      .mockResolvedValueOnce([{ absolutePath: '/tmp/nota.md', name: 'nota.md' }])
    installTerminal({ chooseAttachments, prepareDroppedAttachments: vi.fn() })

    render(<><TerminalAttachments onInsert={vi.fn(async () => true)} /><Toaster /></>)
    await user.click(screen.getByRole('button', { name: 'Allega file a Pi' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('File non allegato')).toBeInTheDocument()
    expect(within(failure).getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Scegli file' }))
    await waitFor(() => expect(chooseAttachments).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('nota.md')).toBeInTheDocument()
  })

  it('conserva gli allegati finché il Terminale AI non conferma l’inserimento', async () => {
    const user = userEvent.setup()
    const chooseAttachments = vi.fn().mockResolvedValue([{ absolutePath: '/tmp/nota.md', name: 'nota.md' }])
    const onInsert = vi.fn()
      .mockRejectedValueOnce(new Error('secret=non-mostrare AI_SESSION_NOT_RUNNING'))
      .mockResolvedValueOnce(true)
    installTerminal({ chooseAttachments, prepareDroppedAttachments: vi.fn() })

    render(<TerminalAttachments onInsert={onInsert} />)
    await user.click(screen.getByRole('button', { name: 'Allega file a Pi' }))
    expect(await screen.findByText('nota.md')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Inserisci' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Allegati non inseriti')).toBeInTheDocument()
    expect(within(failure).getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()
    expect(screen.getByText('nota.md')).toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Inserisci di nuovo' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('nota.md')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('conserva gli allegati quando il Terminale AI rifiuta l’inserimento senza eccezione', async () => {
    const user = userEvent.setup()
    const chooseAttachments = vi.fn().mockResolvedValue([{ absolutePath: '/tmp/contesto.md', name: 'contesto.md' }])
    const onInsert = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    installTerminal({ chooseAttachments, prepareDroppedAttachments: vi.fn() })

    render(<TerminalAttachments onInsert={onInsert} />)
    await user.click(screen.getByRole('button', { name: 'Allega file a Pi' }))
    expect(await screen.findByText('contesto.md')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Inserisci' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1))
    expect(screen.getByText('contesto.md')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Inserisci' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('contesto.md')).not.toBeInTheDocument())
  })
})
