import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PiSession } from '@/bridge'
import { AiSessionSidebar } from '@/features/ai/components/ai-session-sidebar'

function session(sessionId: string, title: string, activity: PiSession['activity'], active = false): PiSession {
  return { sessionId, title, activity, active, status: 'running', createdAt: 1, lastFocusedAt: 1, pid: 10, exitStatus: null }
}

function controller() {
  const sessions = [session('session-one', 'Agente 1', 'working', true), session('session-two', 'Analisi Redis', 'working')]
  return {
    activeSession: sessions[0],
    activeSessionId: 'session-one',
    closeSession: vi.fn(async () => ({ closed: true as const, activeSessionId: 'session-two' })),
    createSession: vi.fn(async () => sessions[1]),
    focusSession: vi.fn(async (sessionId: string) => sessions.find((item) => item.sessionId === sessionId) ?? null),
    pending: false,
    renameSession: vi.fn(async (sessionId: string, title: string) => ({ ...(sessions.find((item) => item.sessionId === sessionId) ?? sessions[0]), title })),
    restartSession: vi.fn(async (sessionId: string) => ({ restarted: true as const, sessionId })),
    retryAiOutput: vi.fn(async () => undefined),
    sessions,
    workingCount: 2,
  }
}

describe('sidebar agenti Pi', () => {
  it('mostra stato e concorrenza, cambia agente e crea una nuova sessione', async () => {
    const value = controller()
    const user = userEvent.setup()
    render(<AiSessionSidebar controller={value} />)

    expect(screen.getByText('2 agenti stanno modificando lo stesso workspace. Coordina i task per evitare conflitti.')).toBeVisible()
    expect(screen.getAllByText('In lavorazione')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /^Analisi Redis\s*In lavorazione$/u }))
    expect(value.focusSession).toHaveBeenCalledWith('session-two')
    await user.click(screen.getByRole('button', { name: 'Avvia un nuovo agente Pi' }))
    expect(value.createSession).toHaveBeenCalledTimes(1)
  })

  it('rinomina con dialog accessibile e conferma la chiusura', async () => {
    const value = controller()
    const user = userEvent.setup()
    render(<AiSessionSidebar controller={value} />)

    await user.click(screen.getByRole('button', { name: 'Rinomina Agente 1' }))
    const input = screen.getByRole('textbox', { name: 'Nome sessione' })
    await user.clear(input)
    await user.type(input, 'Refactor editor')
    await user.click(screen.getByRole('button', { name: 'Rinomina' }))
    expect(value.renameSession).toHaveBeenCalledWith('session-one', 'Refactor editor')

    await user.click(screen.getByRole('button', { name: 'Chiudi Analisi Redis' }))
    expect(screen.getByRole('heading', { name: 'Chiudi Analisi Redis' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Chiudi agente' }))
    expect(value.closeSession).toHaveBeenCalledWith('session-two')
  })
})
