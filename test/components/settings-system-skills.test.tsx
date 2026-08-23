// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in the isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from '@/components/settings'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { clearVolatileDrafts } from '@/lib/volatile-draft-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function projectSkill(id: string, content: string): ProjectSkill {
  return { id, name: id, description: `Skill ${id}`, valid: true, issues: [], content }
}

function installSettingsBridge(systemSkills: Window['vincodeLab']['systemSkills']) {
  const preferences: AppPreferencesSnapshot = {
    schema: [],
    global: {},
    explicitGlobal: {},
    overrides: {},
    effective: {},
    sources: {},
    workspaceAvailable: false,
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      preferences: {
        get: vi.fn(async () => preferences),
        setGlobal: vi.fn(),
        setWorkspace: vi.fn(),
        clearWorkspace: vi.fn(),
        clearAllWorkspace: vi.fn(),
      },
      systemSkills,
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

async function openSystemSkillsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
  return {
    optionA: await screen.findByRole('option', { name: /skill-a/i }),
    optionB: screen.getByRole('option', { name: /skill-b/i }),
  }
}

describe('editor delle Skill Pi nelle impostazioni', () => {
  beforeEach(() => clearVolatileDrafts())

  it('valida il nome prima della creazione e accetta il formato Pi supportato', async () => {
    const user = userEvent.setup()
    const create = vi.fn()
    installSettingsBridge({ list: vi.fn(async () => []), get: vi.fn(), create, update: vi.fn(), delete: vi.fn() })

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    const input = screen.getByRole('textbox', { name: 'Nome skill Pi' })
    const createButton = screen.getByRole('button', { name: 'Crea skill' })

    for (const invalidName of ['Redis', 'redis inspector', 'redis_inspector']) {
      await user.clear(input)
      await user.type(input, invalidName)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText(/Formato non valido/u)).toHaveTextContent(/Minuscole e numeri, separati da trattini/u)
      expect(createButton).toBeDisabled()
    }
    expect(create).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'redis-inspector')
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(/Formato non valido/u)).not.toBeInTheDocument()
    expect(createButton).toBeEnabled()
  })

  it('ripristina il contenuto locale dopo un remount della boundary senza persisterlo', async () => {
    const user = userEvent.setup()
    const skillA = projectSkill('skill-a', '# A')
    const systemSkills = {
      list: vi.fn(async () => [skillA]),
      get: vi.fn(async () => skillA),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    installSettingsBridge(systemSkills)

    const first = render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })
    await user.clear(editor)
    await user.type(editor, '# A volatile')
    first.unmount()

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    expect(await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })).toHaveValue('# A volatile')
    expect(systemSkills.update).not.toHaveBeenCalled()
  })

  it('non trasforma un draft pacchetto in una mutazione implicita durante la chiusura', async () => {
    const user = userEvent.setup()
    installSettingsBridge({ list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() })
    const guard = { current: null as WorkspaceChangeGuard | null }

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} onWorkspaceGuardChange={(nextGuard) => { guard.current = nextGuard }} />)
    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    const source = screen.getByRole('textbox', { name: 'Sorgente pacchetto Pi' })
    await user.type(source, 'fixture-package')
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await expect(guard.current?.saveAll()).rejects.toThrow('Completa oppure scarta')
    expect(window.vincodeLab.piSystem.install).not.toHaveBeenCalled()
    await act(async () => { await guard.current?.discardAll() })
    expect(source).toHaveValue('')
    expect(guard.current?.hasUnsavedChanges()).toBe(false)
  })

  it('ripristina dopo remount i draft globali di pacchetto e nuova skill e li scarta insieme', async () => {
    const user = userEvent.setup()
    installSettingsBridge({ list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() })

    const first = render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    await user.type(screen.getByRole('textbox', { name: 'Sorgente pacchetto Pi' }), 'fixture-package')
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.type(screen.getByRole('textbox', { name: 'Nome skill Pi' }), 'fixture-skill')
    first.unmount()

    const guard = { current: null as WorkspaceChangeGuard | null }
    render(<Settings appearance="system" onAppearanceChange={vi.fn()} onWorkspaceGuardChange={(nextGuard) => { guard.current = nextGuard }} />)
    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    expect(screen.getByRole('textbox', { name: 'Sorgente pacchetto Pi' })).toHaveValue('fixture-package')
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    expect(screen.getByRole('textbox', { name: 'Nome skill Pi' })).toHaveValue('fixture-skill')
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await act(async () => { await guard.current?.discardAll() })
    expect(screen.getByRole('textbox', { name: 'Nome skill Pi' })).toHaveValue('')
    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    expect(screen.getByRole('textbox', { name: 'Sorgente pacchetto Pi' })).toHaveValue('')
    expect(guard.current?.hasUnsavedChanges()).toBe(false)
  })

  it('espone una guardia che salva o scarta il draft senza perdere il contenuto', async () => {
    const user = userEvent.setup()
    const skillA = projectSkill('skill-a', '# A')
    const systemSkills = {
      list: vi.fn(async () => [skillA]),
      get: vi.fn(async () => skillA),
      create: vi.fn(),
      update: vi.fn(async (_skillId: string, content: string) => ({ ...skillA, content })),
      delete: vi.fn(),
    }
    installSettingsBridge(systemSkills)
    const guard = { current: null as WorkspaceChangeGuard | null }

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} onWorkspaceGuardChange={(nextGuard) => { guard.current = nextGuard }} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })
    await user.clear(editor)
    await user.type(editor, '# A salvata')
    expect(guard.current?.hasUnsavedChanges()).toBe(true)

    await act(async () => { await guard.current?.saveAll() })
    expect(systemSkills.update).toHaveBeenCalledWith('skill-a', '# A salvata')
    expect(guard.current?.hasUnsavedChanges()).toBe(false)

    await user.clear(editor)
    await user.type(editor, '# A da scartare')
    expect(guard.current?.hasUnsavedChanges()).toBe(true)
    await act(async () => { await guard.current?.discardAll() })
    expect(editor).toHaveValue('# A salvata')
    expect(guard.current?.hasUnsavedChanges()).toBe(false)
  })

  it('mantiene il draft quando il salvataggio richiesto dalla guardia fallisce', async () => {
    const user = userEvent.setup()
    const skillA = projectSkill('skill-a', '# A')
    const systemSkills = {
      list: vi.fn(async () => [skillA]),
      get: vi.fn(async () => skillA),
      create: vi.fn(),
      update: vi.fn(async () => { throw new Error('fixture failure') }),
      delete: vi.fn(),
    }
    installSettingsBridge(systemSkills)
    const guard = { current: null as WorkspaceChangeGuard | null }

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} onWorkspaceGuardChange={(nextGuard) => { guard.current = nextGuard }} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })
    await user.clear(editor)
    await user.type(editor, '# A ancora locale')

    await expect(guard.current?.saveAll()).rejects.toThrow('Non è stato possibile salvare')
    expect(editor).toHaveValue('# A ancora locale')
    expect(guard.current?.hasUnsavedChanges()).toBe(true)
  })

  it('chiede conferma e conserva il draft quando il cambio skill viene annullato', async () => {
    const user = userEvent.setup()
    const skillA = projectSkill('skill-a', '# A')
    const skillB = projectSkill('skill-b', '# B')
    const systemSkills = {
      list: vi.fn(async () => [skillA, skillB]),
      get: vi.fn(async (skillId: string) => skillId === skillA.id ? skillA : skillB),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    installSettingsBridge(systemSkills)

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    const { optionA, optionB } = await openSystemSkillsTab(user)
    await user.click(optionA)
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })
    await waitFor(() => expect(editor).toHaveValue('# A'))
    await user.clear(editor)
    await user.type(editor, '# A modificata')

    await user.click(optionB)
    const dialog = await screen.findByRole('dialog', { name: 'Modifiche non salvate' })
    expect(systemSkills.get).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('# A modificata')
    expect(optionA).toHaveAttribute('aria-selected', 'true')

    await user.click(within(dialog).getByRole('button', { name: 'Annulla' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modifiche non salvate' })).not.toBeInTheDocument())
    expect(editor).toHaveValue('# A modificata')
    expect(systemSkills.get).toHaveBeenCalledTimes(1)

    await user.click(optionB)
    const confirmDialog = await screen.findByRole('dialog', { name: 'Modifiche non salvate' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Scarta e apri' }))

    const nextEditor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-b' })
    await waitFor(() => expect(nextEditor).toHaveValue('# B'))
    expect(systemSkills.get).toHaveBeenNthCalledWith(2, 'skill-b')
    expect(optionB).toHaveAttribute('aria-selected', 'true')
  })

  it('ignora una lettura tardiva e mantiene contenuto e baseline della selezione più recente', async () => {
    const user = userEvent.setup()
    const skillA = projectSkill('skill-a', '# A')
    const skillB = projectSkill('skill-b', '# B')
    const pendingA = deferred<ProjectSkill>()
    const pendingB = deferred<ProjectSkill>()
    const systemSkills = {
      list: vi.fn(async () => [skillA, skillB]),
      get: vi.fn((skillId: string) => skillId === skillA.id ? pendingA.promise : pendingB.promise),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    }
    installSettingsBridge(systemSkills)

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    const { optionA, optionB } = await openSystemSkillsTab(user)
    await user.click(optionA)
    await user.click(optionB)
    expect(systemSkills.get).toHaveBeenNthCalledWith(1, 'skill-a')
    expect(systemSkills.get).toHaveBeenNthCalledWith(2, 'skill-b')

    await act(async () => pendingB.resolve(skillB))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-b' })
    await waitFor(() => expect(editor).toHaveValue('# B'))

    await act(async () => pendingA.resolve(skillA))
    expect(editor).toHaveValue('# B')
    expect(optionA).toHaveAttribute('aria-selected', 'false')
    expect(optionB).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Salva modifiche' })).toBeDisabled()
  })
})
