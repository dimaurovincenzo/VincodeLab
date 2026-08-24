// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VincodeLabBridge } from '@/bridge'
import { FreeTerminal } from '@/features/terminal'

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    clearDecorations() {}
    findNext() { return false }
    findPrevious() { return false }
  },
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    buffer = { active: { baseY: 0, viewportY: 0 } }
    cols = 80
    options: Record<string, unknown> = {}
    rows = 24
    clear() {}
    dispose() {}
    focus() {}
    getSelection() { return 'selezione intatta' }
    hasSelection() { return true }
    loadAddon() {}
    onData() { return { dispose() {} } }
    onScroll() { return { dispose() {} } }
    open() {}
    scrollToBottom() {}
    write(_data: string, done?: () => void) { done?.() }
  },
}))
vi.mock('@/lib/xterm-theme', () => ({
  observeXtermTheme: () => () => undefined,
  readXtermTheme: () => ({}),
}))

function installBridge() {
  const shellSessions = {
    ack: vi.fn(),
    disconnect: vi.fn(),
    onData: vi.fn(() => () => undefined),
    onError: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    ready: vi.fn(),
    resize: vi.fn(),
    restart: vi.fn(async () => ({ id: 'shell-1', status: 'running' as const })),
    resume: vi.fn(async () => ({
      attachmentId: 'attachment-1',
      blocks: [],
      droppedBytes: 0,
      generation: 1,
      status: 'running' as const,
      truncated: false,
    })),
    write: vi.fn(),
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      managedSsh: { list: vi.fn(async () => []), onStatus: vi.fn(() => () => undefined) },
      shellSessions,
      workspaceCommands: { list: vi.fn(async () => ({ categories: [] })) },
    } as unknown as VincodeLabBridge,
  })
  return shellSessions
}

function renderTerminal() {
  return render(<FreeTerminal
    active
    profileComposerRequest={0}
    sessionId="shell-1"
    workspace="/workspace/clipboard"
    onManagedConnection={vi.fn()}
  />)
}

describe('recovery clipboard del Terminale', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('mantiene la selezione e recupera una copia negata', async () => {
    const user = userEvent.setup()
    installBridge()
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('token=privato clipboard denied'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(), writeText },
    })
    renderTerminal()

    await user.click(await screen.findByRole('button', { name: 'Copia selezione' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Selezione non copiata')).toBeVisible()
    expect(failure).toHaveTextContent('La selezione resta disponibile')
    expect(failure).not.toHaveTextContent(/token|privato|denied/iu)

    await user.click(within(failure).getByRole('button', { name: 'Riprova copia' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mantiene la sessione e recupera un incolla negato', async () => {
    const user = userEvent.setup()
    const shellSessions = installBridge()
    const readText = vi.fn()
      .mockRejectedValueOnce(new Error('password=privata clipboard denied'))
      .mockResolvedValueOnce('echo recovery')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText, writeText: vi.fn() },
    })
    renderTerminal()

    await user.click(await screen.findByRole('button', { name: 'Incolla nel terminale' }))
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Testo non incollato')).toBeVisible()
    expect(failure).toHaveTextContent('La sessione del terminale è rimasta attiva')
    expect(failure).not.toHaveTextContent(/password|privata|denied/iu)

    await user.click(within(failure).getByRole('button', { name: 'Riprova incolla' }))
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(2))
    expect(shellSessions.write).toHaveBeenCalledWith('shell-1', 'echo recovery')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
