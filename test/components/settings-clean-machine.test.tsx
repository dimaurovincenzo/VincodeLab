// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot, RuntimeCapabilitiesSnapshot } from '@/bridge'
import { Settings } from '@/features/settings'
import { setAppPreferencesWorkspace } from '@/lib/app-preferences'

const preferences: AppPreferencesSnapshot = {
  effective: {},
  explicitGlobal: {},
  global: {},
  overrides: {},
  schema: [],
  sources: {},
  workspaceAvailable: false,
}

function installCleanMachineBridge() {
  const list = vi.fn(async () => [])
  const listSkills = vi.fn(async () => [])
  const capabilities: RuntimeCapabilitiesSnapshot = {
    checkedAt: '2026-08-23T12:00:00.000Z',
    items: [
      { id: 'app-runtime', kind: 'included', label: 'Runtime VincodeLab', state: 'ready', detail: 'Electron e Node sono inclusi nell’app. Non è richiesta un’installazione Node/npm di sistema.' },
      { id: 'database-postgresql', kind: 'included', label: 'Driver PostgreSQL', state: 'ready', detail: 'Incluso nell’app: non serve installare client o comandi PostgreSQL sul computer.' },
      { id: 'pi-agent', kind: 'optional', label: 'Pi Coding Agent', state: 'missing', detail: 'Solo il Terminale AI resta disattivato; il resto continua a funzionare.' },
      { id: 'herdr', kind: 'optional', label: 'Herdr', state: 'missing', detail: 'Herdr non è stato rilevato. Il Terminale AI userà Pi diretto quando disponibile.' },
      { id: 'npm-system', kind: 'optional', label: 'npm di sistema', state: 'missing', detail: 'Non serve per avviare VincodeLab.' },
    ],
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      preferences: {
        clearAllWorkspace: vi.fn(),
        clearWorkspace: vi.fn(),
        get: vi.fn(async () => preferences),
        setGlobal: vi.fn(),
        setWorkspace: vi.fn(),
      },
      runtime: { capabilities: vi.fn(async () => capabilities) },
      systemSkills: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), list: vi.fn(async () => []), update: vi.fn() },
      piSystem: {
        install: vi.fn(),
        list,
        listSkills,
        remove: vi.fn(),
        status: vi.fn(async () => ({ state: 'missing' as const, code: 'PI_NOT_INSTALLED' as const, executable: null, version: null })),
        update: vi.fn(),
      },
      piConfig: {
        close: vi.fn(async () => ({ closed: true as const })),
        onData: vi.fn(() => vi.fn()),
        onError: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        resize: vi.fn(),
        start: vi.fn(),
        write: vi.fn(),
      },
      updates: { list: vi.fn(async () => []) },
    } as unknown as Window['vincodeLab'],
  })
  return { list, listSkills }
}

describe('Impostazioni su una macchina pulita', () => {
  it('tratta Pi assente come stato atteso, evita richieste duplicate e mantiene il resto operativo', async () => {
    const user = userEvent.setup()
    const bridge = installCleanMachineBridge()
    setAppPreferencesWorkspace('/tmp/vincodelab-clean-machine-pi')
    render(<Settings appearance="system" onAppearanceChange={vi.fn()} openRuntimeRequest={1} />)

    expect(await screen.findByText('Pi Coding Agent non rilevato.')).toBeVisible()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('fallback Pi diretto restano disattivati')
    expect(status).toHaveTextContent('Se Herdr è pronto, il Terminale AI può ancora aprire la fleet condivisa')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configura Pi' })).toBeDisabled()
    expect(bridge.list).not.toHaveBeenCalled()
    expect(bridge.listSkills).not.toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    expect(screen.getByText(/Node e npm non sono necessari per avviare VincodeLab/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Installa' })).toBeDisabled()
  })

  it('spiega quali runtime sono inclusi e quali strumenti sono soltanto opzionali', async () => {
    const user = userEvent.setup()
    installCleanMachineBridge()
    setAppPreferencesWorkspace('/tmp/vincodelab-clean-machine-capabilities')
    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)

    await user.click(screen.getByRole('tab', { name: 'Compatibilità' }))
    const included = await screen.findByRole('region', { name: 'Inclusi in VincodeLab' })
    expect(within(included).getByText('Runtime VincodeLab')).toBeVisible()
    expect(within(included).getByText('Driver PostgreSQL')).toBeVisible()
    expect(included).toHaveTextContent('non serve installare client o comandi PostgreSQL')

    const optional = screen.getByRole('region', { name: 'Strumenti opzionali' })
    expect(optional).toHaveTextContent('Pi Coding Agent')
    expect(optional).toHaveTextContent('Herdr')
    expect(optional).toHaveTextContent('npm di sistema')
    expect(optional).toHaveTextContent('Non installato')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
