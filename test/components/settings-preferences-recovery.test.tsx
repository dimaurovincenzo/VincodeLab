// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Settings } from '@/features/settings'
import { setAppPreferencesWorkspace } from '@/lib/app-preferences'

function validPreferences(): AppPreferencesSnapshot {
  const key = 'editor.fontSize'
  return {
    schema: [{ key, section: 'editor', label: 'Dimensione testo', type: 'number', default: 13, min: 10, max: 24, step: 1 }],
    global: { [key]: 17 },
    explicitGlobal: { [key]: 17 },
    overrides: {},
    effective: { [key]: 17 },
    sources: { [key]: 'global' },
    workspaceAvailable: true,
  }
}

function installBridge(getPreferences: () => Promise<AppPreferencesSnapshot>) {
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      preferences: {
        get: getPreferences,
        setGlobal: vi.fn(),
        setWorkspace: vi.fn(),
        clearWorkspace: vi.fn(),
        clearAllWorkspace: vi.fn(),
      },
      systemSkills: {
        list: vi.fn(async () => []),
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      piSystem: {
        status: vi.fn(async () => ({ executable: '/usr/bin/pi', version: '1.0.0' })),
        list: vi.fn(async () => []),
        listSkills: vi.fn(async () => []),
        install: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      },
      piConfig: {
        start: vi.fn(),
        close: vi.fn(async () => ({ closed: true as const })),
        write: vi.fn(),
        resize: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
      },
      updates: { list: vi.fn(async () => []) },
    } as unknown as Window['vincodeLab'],
  })
}

describe('recupero preferenze nelle Impostazioni', () => {
  it('sostituisce il loading fallito con un retry azionabile e ripristina i valori', async () => {
    const user = userEvent.setup()
    const getPreferences = vi.fn()
      .mockRejectedValueOnce(new Error('lettura non disponibile'))
      .mockResolvedValueOnce(validPreferences())
    installBridge(getPreferences)
    setAppPreferencesWorkspace('/tmp/settings-preferences-recovery')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Preferenze non disponibili')
    expect(alert).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText('Caricamento preferenze…')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Riprova preferenze' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await screen.findByRole('spinbutton', { name: 'Dimensione testo' })).toHaveValue(17)
    expect(getPreferences).toHaveBeenCalledTimes(2)
  })

  it('mantiene utilizzabili i valori sicuri quando il main ripristina preferenze corrotte', async () => {
    const user = userEvent.setup()
    const recovered = {
      ...validPreferences(),
      recovery: {
        kind: 'corrupt' as const,
        correlationId: 'ERR-A1B2C3',
        globalCount: 1,
        workspaceCount: 0,
      },
    }
    const getPreferences = vi.fn()
      .mockResolvedValueOnce(recovered)
      .mockResolvedValueOnce(validPreferences())
    installBridge(getPreferences)
    setAppPreferencesWorkspace('/tmp/settings-preferences-corrupt')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Preferenze non aggiornate')
    expect(alert).toHaveTextContent('ERR-A1B2C3')
    expect(await screen.findByRole('spinbutton', { name: 'Dimensione testo' })).toHaveValue(17)

    await user.click(screen.getByRole('button', { name: 'Riprova preferenze' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(getPreferences).toHaveBeenCalledTimes(2)
  })
})
