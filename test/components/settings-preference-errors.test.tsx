// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from '@/features/settings'
import { toastStore } from '@/components/ui/toast-store'
import { setAppPreferencesWorkspace } from '@/lib/app-preferences'

const definition: AppPreferenceDefinition = {
  default: false,
  key: 'editor.wordWrap',
  label: 'A capo automatico',
  section: 'editor',
  type: 'boolean',
}

function preferenceSnapshot(globalValue: boolean, workspaceValue?: boolean): AppPreferencesSnapshot {
  const hasWorkspaceValue = workspaceValue !== undefined
  return {
    effective: { [definition.key]: workspaceValue ?? globalValue },
    explicitGlobal: { [definition.key]: globalValue },
    global: { [definition.key]: globalValue },
    overrides: hasWorkspaceValue ? { [definition.key]: workspaceValue } : {},
    schema: [definition],
    sources: { [definition.key]: hasWorkspaceValue ? 'workspace' : 'global' },
    workspaceAvailable: true,
  }
}

function installBridge({
  clearAllWorkspace = vi.fn(),
  clearWorkspace = vi.fn(),
  setGlobal = vi.fn(),
}: {
  clearAllWorkspace?: ReturnType<typeof vi.fn>
  clearWorkspace?: ReturnType<typeof vi.fn>
  setGlobal?: ReturnType<typeof vi.fn>
} = {}, initial = preferenceSnapshot(false)) {
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      preferences: {
        clearAllWorkspace,
        clearWorkspace,
        get: vi.fn(async () => initial),
        setGlobal,
        setWorkspace: vi.fn(),
      },
      systemSkills: { create: vi.fn(), delete: vi.fn(), get: vi.fn(), list: vi.fn(async () => []), update: vi.fn() },
      piSystem: {
        install: vi.fn(),
        list: vi.fn(async () => []),
        listSkills: vi.fn(async () => []),
        remove: vi.fn(),
        status: vi.fn(async () => ({ executable: '/usr/bin/pi', version: '1.0.0' })),
        update: vi.fn(),
      },
      piConfig: {
        close: vi.fn(async () => ({ closed: true as const })),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        resize: vi.fn(),
        start: vi.fn(),
        write: vi.fn(),
      },
      updates: { list: vi.fn(async () => []) },
    } as unknown as Window['vincodeLab'],
  })
}

function expectOnlyLocalFailure(title: string) {
  const failure = screen.getByText(new RegExp(title, 'u'))
  expect(failure).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
  expect(failure).not.toHaveTextContent(/EACCES|SUPER_SECRET|\/Users\/alice/u)
  expect(screen.getAllByText(new RegExp(title, 'u'))).toHaveLength(1)
  expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)
  return failure
}

describe('Error Experience delle preferenze', () => {
  beforeEach(() => {
    toastStore.remove()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    toastStore.remove()
  })

  it('mantiene il valore tentato dopo un save fallito e lo applica con Riprova', async () => {
    const user = userEvent.setup()
    const setGlobal = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/preferences token=SUPER_SECRET'))
      .mockResolvedValueOnce(preferenceSnapshot(true))
    installBridge({ setGlobal })
    setAppPreferencesWorkspace('/tmp/settings-preference-save-error')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    const checkbox = await screen.findByRole('checkbox', { name: definition.label })
    expect(checkbox).not.toBeChecked()
    await user.click(checkbox)

    expectOnlyLocalFailure('Impostazione non salvata')
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(setGlobal).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/Impostazione non salvata/u)).not.toBeInTheDocument())
    expect(checkbox).toBeChecked()
    expect(checkbox).toBeEnabled()
    expect(setGlobal).toHaveBeenLastCalledWith(definition.key, true)
  })

  it('mantiene la personalizzazione dopo un reset fallito e usa il retry locale', async () => {
    const user = userEvent.setup()
    const clearWorkspace = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/workspace token=SUPER_SECRET'))
      .mockResolvedValueOnce(preferenceSnapshot(false))
    installBridge({ clearWorkspace }, preferenceSnapshot(false, true))
    setAppPreferencesWorkspace('/tmp/settings-preference-reset-error')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(await screen.findByText('Workspace aperto'))
    const checkbox = screen.getByRole('checkbox', { name: definition.label })
    expect(checkbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Usa globale' }))

    expectOnlyLocalFailure('Personalizzazione non rimossa')
    expect(checkbox).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(clearWorkspace).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/Personalizzazione non rimossa/u)).not.toBeInTheDocument())
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Usa globale' })).not.toBeInTheDocument()
  })

  it('conserva tutte le personalizzazioni e richiede conferma anche per il recovery globale', async () => {
    const user = userEvent.setup()
    const clearAllWorkspace = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/workspace token=SUPER_SECRET'))
      .mockResolvedValueOnce(preferenceSnapshot(false))
    installBridge({ clearAllWorkspace }, preferenceSnapshot(false, true))
    setAppPreferencesWorkspace('/tmp/settings-preference-clear-all-error')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(await screen.findByText('Workspace aperto'))
    const checkbox = screen.getByRole('checkbox', { name: definition.label })
    await user.click(screen.getByRole('button', { name: 'Rimuovi tutte le personalizzazioni' }))
    let dialog = await screen.findByRole('dialog', { name: 'Rimuovere tutte le personalizzazioni?' })
    await user.click(within(dialog).getByRole('button', { name: 'Rimuovi personalizzazioni' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Personalizzazioni non rimosse')
    expect(alert).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
    expect(alert).not.toHaveTextContent(/EACCES|SUPER_SECRET|\/Users\/alice/u)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(checkbox).toBeChecked()
    expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)

    await user.click(within(alert).getByRole('button', { name: 'Ripristina' }))
    dialog = await screen.findByRole('dialog', { name: 'Rimuovere tutte le personalizzazioni?' })
    await user.click(within(dialog).getByRole('button', { name: 'Rimuovi personalizzazioni' }))

    await waitFor(() => expect(clearAllWorkspace).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(checkbox).not.toBeChecked()
  })
})
