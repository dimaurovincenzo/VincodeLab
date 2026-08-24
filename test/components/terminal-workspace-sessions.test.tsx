import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellSessionList, ShellSessionMetadata, VincodeLabBridge } from '@/bridge'

vi.mock('@/features/terminal/components/free-terminal', () => ({
  FreeTerminal: ({
    active,
    onStatusChange,
    sessionId,
  }: {
    active: boolean
    onStatusChange?: (sessionId: string, status: 'starting' | 'ready' | 'exited' | 'error') => void
    sessionId: string
  }) => <div data-active={String(active)} data-testid={`terminal-${sessionId}`}>
    Istanza {sessionId}
    <button type="button" onClick={() => onStatusChange?.(sessionId, 'error')}>Segna errore {sessionId}</button>
  </div>,
}))

vi.mock('@/features/remote-files', () => ({
  RemoteFiles: ({ active }: { active: boolean }) => <div data-active={String(active)} data-testid="remote-files">File remoti persistenti</div>,
}))

import { TerminalWorkspace, type TerminalWorkspaceActionRequest } from '@/features/terminal'

function session(ordinal: number, options: Partial<ShellSessionMetadata> = {}): ShellSessionMetadata {
  return {
    sessionId: `session-${String(ordinal).padStart(4, '0')}`,
    title: `Terminale ${ordinal}`,
    status: 'running',
    active: false,
    createdAt: ordinal,
    lastFocusedAt: ordinal,
    cols: 120,
    rows: 34,
    pid: 4_000 + ordinal,
    exitStatus: null,
    ...options,
  }
}

function installBridge(initialSessions: ShellSessionMetadata[], initialActiveSessionId: string | null = initialSessions[0]?.sessionId ?? null) {
  let availableSessions = [...initialSessions]
  const list = vi.fn(async (): Promise<ShellSessionList> => ({
    activeSessionId: initialActiveSessionId,
    sessions: availableSessions,
  }))
  const create = vi.fn(async () => {
    const created = session(availableSessions.length + 1, { active: true })
    availableSessions = [...availableSessions, created]
    return created
  })
  const focus = vi.fn(async (sessionId: string) => ({
    ...(availableSessions.find((candidate) => candidate.sessionId === sessionId) ?? session(99)),
    active: true,
  }))
  const close = vi.fn(async (sessionId: string) => {
    availableSessions = availableSessions.filter((candidate) => candidate.sessionId !== sessionId)
    return { closed: true, activeSessionId: availableSessions.at(-1)?.sessionId ?? null }
  })

  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      shellSessions: {
        list,
        create,
        focus,
        write: vi.fn(),
        resize: vi.fn(),
        restart: vi.fn(),
        close,
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
      workspaceCommands: { run: vi.fn(async () => ({ managedConnectionId: null })) },
    } as unknown as VincodeLabBridge,
  })

  return { close, create, focus, list }
}

function renderWorkspace(actionRequest?: TerminalWorkspaceActionRequest, strict = false) {
  const workspace = <TerminalWorkspace active actionRequest={actionRequest} workspace="/tmp/workspace" onOpenRemoteFile={vi.fn()} />
  return render(strict ? <StrictMode>{workspace}</StrictMode> : workspace)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('workspace multi-terminale', () => {
  it('crea una sessione iniziale soltanto quando il workspace non ne contiene', async () => {
    const bridge = installBridge([])

    renderWorkspace({ id: 1, action: 'new' }, true)

    expect(await screen.findByRole('tab', { name: 'Terminale 1, Pronto' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('terminal-session-0001')).toHaveAttribute('data-active', 'true')
    expect(bridge.list).toHaveBeenCalledTimes(1)
    expect(bridge.create).toHaveBeenCalledTimes(1)
  })

  it('ripristina soltanto numero e posizione attiva delle sessioni del workspace', async () => {
    const bridge = installBridge([])
    const onSessionChange = vi.fn()

    render(<TerminalWorkspace
      active
      initialState={{
        tab: 'shell',
        remoteView: 'server',
        selectedProfileCommandId: null,
        openSessionCount: 3,
        activeSessionOrdinal: 1,
      }}
      workspace="/tmp/workspace"
      onOpenRemoteFile={vi.fn()}
      onSessionChange={onSessionChange}
    />)

    expect(await screen.findByRole('tab', { name: 'Terminale 2, Pronto' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('terminal-session-0001')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-session-0003')).toBeInTheDocument()
    expect(bridge.create).toHaveBeenCalledTimes(3)
    expect(bridge.focus).toHaveBeenCalledWith('session-0002')
    await waitFor(() => expect(onSessionChange).toHaveBeenLastCalledWith({
      tab: 'shell',
      openSessionCount: 3,
      activeSessionOrdinal: 1,
    }))
  })

  it('mantiene montate le istanze xterm durante switch, creazione e fallback MRU dopo close', async () => {
    const user = userEvent.setup()
    const first = session(1, { active: true, lastFocusedAt: 20 })
    const second = session(2, { lastFocusedAt: 10 })
    const bridge = installBridge([first, second], first.sessionId)
    bridge.close.mockResolvedValueOnce({ closed: true, activeSessionId: second.sessionId })

    renderWorkspace()

    const firstNode = await screen.findByTestId(`terminal-${first.sessionId}`)
    const secondNode = screen.getByTestId(`terminal-${second.sessionId}`)
    await user.click(screen.getByRole('tab', { name: 'Terminale 2, Pronto' }))
    await waitFor(() => expect(bridge.focus).toHaveBeenLastCalledWith(second.sessionId))
    expect(screen.getByTestId(`terminal-${first.sessionId}`)).toBe(firstNode)
    expect(screen.getByTestId(`terminal-${second.sessionId}`)).toBe(secondNode)
    expect(firstNode.isConnected).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Terminale precedente' }))
    await waitFor(() => expect(bridge.focus).toHaveBeenLastCalledWith(first.sessionId))

    await user.click(screen.getByRole('button', { name: 'Nuovo terminale' }))
    expect(await screen.findByRole('tab', { name: 'Terminale 3, Pronto' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId(`terminal-${first.sessionId}`)).toBe(firstNode)
    expect(screen.getByTestId(`terminal-${second.sessionId}`)).toBe(secondNode)

    await user.click(screen.getByRole('button', { name: 'Chiudi terminale attivo' }))
    await waitFor(() => expect(bridge.close).toHaveBeenCalledWith('session-0003'))
    await waitFor(() => expect(screen.queryByTestId('terminal-session-0003')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Terminale 2, Pronto' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByTestId(`terminal-${first.sessionId}`)).toBe(firstNode)
    expect(screen.getByTestId(`terminal-${second.sessionId}`)).toBe(secondNode)
  })

  it('espone limite locale e stato per ciascuna sessione', async () => {
    const user = userEvent.setup()
    const sessions = Array.from({ length: 8 }, (_, index) => session(index + 1, {
      active: index === 0,
      status: index === 1 ? 'starting' : index === 2 ? 'exited' : 'running',
    }))
    const bridge = installBridge(sessions, sessions[0].sessionId)

    renderWorkspace()

    expect(await screen.findByText('Limite di 8 terminali raggiunto.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limite di 8 terminali raggiunto' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Terminale 2, Avvio in corso' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Terminale 3, Terminato' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `Segna errore ${sessions[0].sessionId}` }))
    expect(await screen.findByRole('tab', { name: 'Terminale 1, Errore' })).toBeInTheDocument()
    expect(bridge.create).not.toHaveBeenCalled()
  })

  it('consuma una sola volta le richieste action e permette il retry del bootstrap', async () => {
    const first = session(1, { active: true })
    const second = session(2)
    const bridge = installBridge([first, second], first.sessionId)
    bridge.list.mockRejectedValueOnce(new Error('Indice terminali non disponibile'))

    const view = renderWorkspace({ id: 1, action: 'next' })

    const bootstrapFailure = await screen.findByRole('alert')
    expect(bootstrapFailure).toHaveTextContent('Terminali non inizializzati')
    expect(bootstrapFailure).toHaveTextContent('Il workspace è rimasto aperto')
    expect(bootstrapFailure).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/)
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }))
    expect(await screen.findByRole('tab', { name: 'Terminale 1, Pronto' })).toBeInTheDocument()

    view.rerender(<TerminalWorkspace active actionRequest={{ id: 2, action: 'next' }} workspace="/tmp/workspace" onOpenRemoteFile={vi.fn()} />)
    await waitFor(() => expect(bridge.focus).toHaveBeenLastCalledWith(second.sessionId))
    const focusCalls = bridge.focus.mock.calls.length
    view.rerender(<TerminalWorkspace active actionRequest={{ id: 2, action: 'next' }} workspace="/tmp/workspace" onOpenRemoteFile={vi.fn()} />)
    await waitFor(() => expect(bridge.focus).toHaveBeenCalledTimes(focusCalls))
  })
})
