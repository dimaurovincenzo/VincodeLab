// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer ambient types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Settings } from '@/features/settings'
import { NumberPreferenceInput } from '@/features/settings/components/number-preference-input'
import { publishAppPreferences, setAppPreferencesWorkspace } from '@/lib/app-preferences'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

const definition: AppPreferenceDefinition = {
  key: 'terminal.scrollback',
  label: 'Righe cronologia',
  section: 'terminal',
  type: 'number',
  default: 1_000,
  min: 100,
  max: 100_000,
  step: 100,
}

function preferenceSnapshot(globalValue: number): AppPreferencesSnapshot {
  return {
    schema: [definition],
    global: { [definition.key]: globalValue },
    explicitGlobal: { [definition.key]: globalValue },
    overrides: {},
    effective: { [definition.key]: globalValue },
    sources: { [definition.key]: 'global' },
    workspaceAvailable: true,
  }
}

function installSettingsBridge(initialPreferences: AppPreferencesSnapshot) {
  let currentPreferences = initialPreferences
  const setGlobal = vi.fn(async (_key: string, value: AppPreferenceValue) => {
    currentPreferences = preferenceSnapshot(Number(value))
    return currentPreferences
  })
  const setWorkspace = vi.fn(async () => { throw new Error('workspace write failed') })
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      preferences: {
        get: vi.fn(async () => currentPreferences),
        setGlobal,
        setWorkspace,
        clearWorkspace: vi.fn(),
        clearAllWorkspace: vi.fn(),
      },
      systemSkills: { list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
  return { setGlobal, setWorkspace }
}

describe('preferenza numerica', () => {
  it('mantiene un draft locale e salva una sola volta su blur', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn(async () => true)
    const onDraftChange = vi.fn()
    render(<NumberPreferenceInput definition={definition} disabled={false} value={1_000} onCommit={onCommit} onDraftChange={onDraftChange} />)
    const input = screen.getByRole('spinbutton', { name: 'Righe cronologia' })

    await user.clear(input)
    await user.type(input, '2500')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onDraftChange).toHaveBeenLastCalledWith('2500')
    await user.tab()

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(2_500)
    expect(onDraftChange).toHaveBeenLastCalledWith(null)
  })

  it('ripristina valori non validi senza persisterli', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn(async () => true)
    render(<NumberPreferenceInput definition={definition} disabled={false} value={1_000} onCommit={onCommit} />)
    const input = screen.getByRole('spinbutton', { name: 'Righe cronologia' })

    await user.clear(input)
    await user.type(input, '12')
    await user.tab()

    expect(onCommit).not.toHaveBeenCalled()
    expect(input).toHaveValue(1_000)
  })

  it('protegge il draft nel componente Settings durante Save, failure, Discard e unmount', async () => {
    const initialPreferences = preferenceSnapshot(1_000)
    const bridge = installSettingsBridge(initialPreferences)
    setAppPreferencesWorkspace('/tmp/settings-number-preference-guard')
    publishAppPreferences(initialPreferences)
    const guard = { current: null as WorkspaceChangeGuard | null }
    const onWorkspaceGuardChange = vi.fn((nextGuard: WorkspaceChangeGuard | null) => { guard.current = nextGuard })
    const rendered = render(<Settings
      appearance="system"
      onAppearanceChange={vi.fn()}
      onWorkspaceGuardChange={onWorkspaceGuardChange}
    />)

    const globalInput = await screen.findByRole('spinbutton', { name: 'Righe cronologia' })
    fireEvent.change(globalInput, { target: { value: '2500' } })
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    fireEvent.click(screen.getByText('Workspace aperto'))
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Righe cronologia' })).toHaveValue(1_000))
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await act(async () => { await guard.current?.saveAll() })
    expect(bridge.setGlobal).toHaveBeenCalledWith(definition.key, 2_500)
    expect(bridge.setWorkspace).not.toHaveBeenCalled()
    expect(guard.current?.hasUnsavedChanges()).toBe(false)

    const workspaceInput = screen.getByRole('spinbutton', { name: 'Righe cronologia' })
    fireEvent.change(workspaceInput, { target: { value: '3200' } })
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await expect(guard.current?.saveAll()).rejects.toThrow('Non è stato possibile salvare')
    expect(bridge.setWorkspace).toHaveBeenCalledWith(definition.key, 3_200)
    expect(workspaceInput).toHaveValue(3_200)
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await act(async () => { await guard.current?.discardAll() })
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Righe cronologia' })).toHaveValue(2_500))
    expect(guard.current?.hasUnsavedChanges()).toBe(false)

    rendered.unmount()
    expect(onWorkspaceGuardChange).toHaveBeenLastCalledWith(null)
    expect(guard.current).toBeNull()
  })
})
