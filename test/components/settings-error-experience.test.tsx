// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in this isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Settings } from '@/features/settings'
import { toastStore } from '@/components/ui/toast-store'
import { setAppPreferencesWorkspace } from '@/lib/app-preferences'
import { clearVolatileDrafts } from '@/lib/volatile-draft-store'

const safePreferences: AppPreferencesSnapshot = {
  schema: [],
  global: {},
  explicitGlobal: {},
  overrides: {},
  effective: {},
  sources: {},
  workspaceAvailable: false,
}

function managedUpdate(): ManagedUpdate {
  return {
    activeVersion: '1.0.0',
    availableVersion: null,
    changelog: null,
    channel: 'stable',
    id: 'runtime:pi',
    kind: 'pi-runtime',
    lastCheckedAt: null,
    lastError: null,
    name: 'Runtime Pi',
    owner: null,
    policy: 'manual',
    ref: null,
    repository: null,
    restartRequired: false,
    rollbackVersion: null,
    sourceType: 'runtime',
    stagedVersion: null,
    status: 'idle',
  }
}

type BridgeOverrides = {
  piConfig?: Partial<Window['vincodeLab']['piConfig']>
  piSystem?: Partial<Window['vincodeLab']['piSystem']>
  systemSkills?: Partial<Window['vincodeLab']['systemSkills']>
  updates?: Partial<Window['vincodeLab']['updates']>
}

function installBridge(overrides: BridgeOverrides = {}) {
  const bridge = {
    preferences: {
      clearAllWorkspace: vi.fn(),
      clearWorkspace: vi.fn(),
      get: vi.fn(async () => safePreferences),
      setGlobal: vi.fn(),
      setWorkspace: vi.fn(),
    },
    systemSkills: {
      create: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
      list: vi.fn(async () => []),
      update: vi.fn(),
      ...overrides.systemSkills,
    },
    piSystem: {
      install: vi.fn(),
      list: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      remove: vi.fn(),
      status: vi.fn(async () => ({ executable: '/usr/bin/pi', version: '1.0.0' })),
      update: vi.fn(),
      ...overrides.piSystem,
    },
    piConfig: {
      close: vi.fn(async () => ({ closed: true as const })),
      onData: vi.fn(() => vi.fn()),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn(() => vi.fn()),
      resize: vi.fn(),
      start: vi.fn(),
      write: vi.fn(),
      ...overrides.piConfig,
    },
    updates: {
      check: vi.fn(),
      download: vi.fn(),
      downloadAll: vi.fn(),
      list: vi.fn(async () => []),
      rollback: vi.fn(),
      setPolicy: vi.fn(),
      ...overrides.updates,
    },
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: bridge as unknown as Window['vincodeLab'],
  })
  return bridge
}

function expectSafeSingleNotice(title: string) {
  const titleNode = screen.getByRole('heading', { name: title })
  const notice = titleNode.closest<HTMLElement>('[role="alert"], [role="status"]')
  expect(notice).not.toBeNull()
  const matchingSurfaces = [
    ...screen.queryAllByRole('alert'),
    ...screen.queryAllByRole('status'),
  ].filter((surface) => surface.textContent?.includes(title))
  expect(matchingSurfaces).toHaveLength(1)
  expect(notice).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
  expect(notice).not.toHaveTextContent(/EACCES|SUPER_SECRET|\/Users\/alice/u)
  expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)
  return notice!
}

describe('Error Experience delle Impostazioni Pi', () => {
  beforeEach(() => {
    clearVolatileDrafts()
    toastStore.remove()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    toastStore.remove()
  })

  it('chiude il refresh e recupera anche quando il bridge runtime lancia in modo sincrono', async () => {
    const user = userEvent.setup()
    const status = vi.fn()
      .mockImplementationOnce(() => { throw new Error('EACCES /Users/alice/runtime token=SUPER_SECRET') })
      .mockResolvedValueOnce({ executable: '/usr/bin/pi', version: '1.0.0' })
    installBridge({ piSystem: { status } })
    setAppPreferencesWorkspace('/tmp/settings-error-runtime-load')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Runtime Pi' }))

    const notice = await waitFor(() => expectSafeSingleNotice('Runtime Pi non disponibile'))
    expect(screen.getByRole('button', { name: 'Aggiorna' })).toBeEnabled()
    expect(screen.queryByText('Verifica Pi in corso…')).not.toBeInTheDocument()

    await user.click(within(notice).getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Runtime Pi non disponibile' })).not.toBeInTheDocument())
    expect(screen.getByText('1.0.0 · /usr/bin/pi')).toBeVisible()
  })

  it('conserva la pagina operativa e riapre la configurazione Pi dopo uno startup fallito', async () => {
    const user = userEvent.setup()
    const start = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/.pi token=SUPER_SECRET'))
      .mockResolvedValueOnce({ reused: false, started: true })
    installBridge({ piConfig: { start } })
    setAppPreferencesWorkspace('/tmp/settings-error-config')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Runtime Pi' }))
    await user.click(screen.getByRole('button', { name: 'Configura Pi' }))

    const alert = await waitFor(() => expectSafeSingleNotice('Configurazione Pi non disponibile'))
    expect(screen.getByRole('button', { name: 'Configura Pi' })).toBeEnabled()

    await user.click(within(alert).getByRole('button', { name: 'Apri configurazione' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configurazione Pi non disponibile' })).not.toBeInTheDocument())
    expect(await screen.findByLabelText('Terminale configurazione Pi')).toBeVisible()
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('presenta gli errori one-way della configurazione con correlation e recovery specifica', async () => {
    const user = userEvent.setup()
    let emitConfigError: ((event: PiConfigErrorEvent) => void) | null = null
    const onError = vi.fn((listener: (event: PiConfigErrorEvent) => void) => {
      emitConfigError = listener
      return vi.fn()
    })
    const start = vi.fn(async () => ({ reused: false, started: true }))
    const close = vi.fn(async () => ({ closed: true as const }))
    const resize = vi.fn()
    installBridge({ piConfig: { close, onError, resize, start } })
    setAppPreferencesWorkspace('/tmp/settings-error-config-one-way')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Runtime Pi' }))
    await user.click(screen.getByRole('button', { name: 'Configura Pi' }))
    expect(await screen.findByLabelText('Terminale configurazione Pi')).toBeVisible()

    await act(async () => {
      emitConfigError?.({
        error: { category: 'process', code: 'PI_CONFIG_INPUT_FAILED', correlationId: 'ERR-A1B2C3', message: 'input pty fallito token=privato', recoverable: true, severity: 'error' },
        operation: 'input',
        recovery: 'restart',
      })
      await Promise.resolve()
    })

    let notice = await screen.findByRole('alert')
    expect(within(notice).getByRole('heading', { name: 'Input configurazione Pi non inviato' })).toBeVisible()
    expect(notice).toHaveTextContent('Riferimento ERR-A1B2C3')
    expect(notice).not.toHaveTextContent(/token=privato/u)
    await user.click(within(notice).getByRole('button', { name: 'Riavvia configurazione' }))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(close).toHaveBeenCalledTimes(1)

    await act(async () => {
      emitConfigError?.({
        error: { category: 'configuration', code: 'PI_CONFIG_RESIZE_FAILED', correlationId: 'ERR-D4E5F6', message: 'resize pty fallito token=privato', recoverable: true, severity: 'warning' },
        operation: 'resize',
        recovery: 'resize',
      })
      await Promise.resolve()
    })

    notice = await screen.findByRole('status')
    expect(within(notice).getByRole('heading', { name: 'Terminale configurazione non ridimensionato' })).toBeVisible()
    expect(notice).toHaveTextContent('Riferimento ERR-D4E5F6')
    await user.click(within(notice).getByRole('button', { name: 'Riprova ridimensionamento' }))
    expect(resize).toHaveBeenCalledWith({ cols: 120, rows: 34 })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Terminale configurazione non ridimensionato' })).not.toBeInTheDocument())
  })

  it('possiede la rejection di chiusura configurazione durante lo smontaggio', async () => {
    const user = userEvent.setup()
    const close = vi.fn(async () => { throw new Error('close pty fallito token=privato') })
    installBridge({ piConfig: { close, start: vi.fn(async () => ({ reused: false, started: true })) } })
    setAppPreferencesWorkspace('/tmp/settings-error-config-cleanup')

    const { unmount } = render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Runtime Pi' }))
    await user.click(screen.getByRole('button', { name: 'Configura Pi' }))
    expect(await screen.findByLabelText('Terminale configurazione Pi')).toBeVisible()

    unmount()

    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(console.error).mock.calls.some(([value]) => (
      typeof value === 'string' && value.includes('close-pi-config-on-unmount')
    ))).toBe(true))
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('privato')
  })

  it('mantiene la sorgente del pacchetto, espone un solo recovery e completa il retry', async () => {
    const user = userEvent.setup()
    const install = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/private-package token=SUPER_SECRET'))
      .mockResolvedValueOnce({ installed: true })
    installBridge({ piSystem: { install } })
    setAppPreferencesWorkspace('/tmp/settings-error-package')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Pacchetti Pi' }))
    const source = screen.getByRole('textbox', { name: 'Sorgente pacchetto Pi' })
    await user.type(source, 'fixture-package')
    await user.click(screen.getByRole('button', { name: 'Installa' }))
    let dialog = await screen.findByRole('dialog', { name: 'Installa pacchetto Pi' })
    await user.click(within(dialog).getByRole('button', { name: 'Installa' }))

    const alert = await waitFor(() => expectSafeSingleNotice('Pacchetto Pi non modificato'))
    expect(source).toHaveValue('fixture-package')

    await user.click(within(alert).getByRole('button', { name: 'Riprova' }))
    dialog = await screen.findByRole('dialog', { name: 'Installa pacchetto Pi' })
    await user.click(within(dialog).getByRole('button', { name: 'Installa' }))

    await waitFor(() => expect(install).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(source).toHaveValue(''))
    expect(screen.queryByRole('heading', { name: 'Pacchetto Pi non modificato' })).not.toBeInTheDocument()
  })

  it('rende recuperabile un controllo aggiornamenti senza cambiare la versione attiva', async () => {
    const user = userEvent.setup()
    const check = vi.fn()
      .mockRejectedValueOnce(new Error('network token=SUPER_SECRET /Users/alice/update'))
      .mockResolvedValueOnce({ checked: true })
    const update = managedUpdate()
    installBridge({ updates: { check, list: vi.fn(async () => [update]) } })
    setAppPreferencesWorkspace('/tmp/settings-error-update')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Aggiornamenti' }))
    await user.click(await screen.findByRole('button', { name: /^Verifica$/u }))

    const alert = await waitFor(() => expectSafeSingleNotice('Aggiornamento non modificato'))
    expect(screen.getByText(/Attiva/)).toHaveTextContent('1.0.0')

    await user.click(within(alert).getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Aggiornamento non modificato' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Verifica$/u })).toBeEnabled()
  })

  it('mantiene il draft della skill e consente di riprovare il salvataggio dal campo', async () => {
    const user = userEvent.setup()
    const skill: ProjectSkill = { content: '# A', description: 'Skill A', id: 'skill-a', issues: [], name: 'skill-a', valid: true }
    const update = vi.fn()
      .mockRejectedValueOnce(new Error('EACCES /Users/alice/skill token=SUPER_SECRET'))
      .mockImplementationOnce(async (_skillId: string, content: string) => ({ ...skill, content }))
    installBridge({
      systemSkills: {
        get: vi.fn(async () => skill),
        list: vi.fn(async () => [skill]),
        update,
      },
    })
    setAppPreferencesWorkspace('/tmp/settings-error-skill')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto skill skill-a' })
    await user.clear(editor)
    await user.type(editor, '# A locale')
    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }))

    const fieldError = await screen.findByText(/Skill Pi non salvata/u)
    expect(fieldError).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/u)
    expect(fieldError).not.toHaveTextContent(/EACCES|SUPER_SECRET|\/Users\/alice/u)
    expect(editor).toHaveValue('# A locale')
    expect(editor).toHaveAttribute('aria-invalid', 'true')
    expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Riprova salvataggio' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText(/Skill Pi non salvata/u)).not.toBeInTheDocument())
    expect(editor).toHaveValue('# A locale')
    expect(update).toHaveBeenLastCalledWith('skill-a', '# A locale')
  })

  it('spiega una collisione del nome, conserva il draft e completa il retry senza toast duplicati', async () => {
    const user = userEvent.setup()
    const createdSkill: ProjectSkill = {
      content: '# redis-inspector',
      description: 'Skill redis-inspector',
      id: 'redis-inspector',
      issues: [],
      name: 'redis-inspector',
      valid: true,
    }
    const collision: PublicApplicationError = {
      category: 'conflict',
      code: 'SYSTEM_SKILL_ALREADY_EXISTS',
      correlationId: 'ERR-A1B2C3',
      message: 'Esiste già una skill Pi con questo nome. Scegli un nome diverso. [SYSTEM_SKILL_ALREADY_EXISTS] [ERR-A1B2C3]',
      recoverable: true,
      severity: 'warning',
    }
    const create = vi.fn()
      .mockRejectedValueOnce(collision)
      .mockResolvedValueOnce(createdSkill)
    installBridge({ systemSkills: { create } })
    setAppPreferencesWorkspace('/tmp/settings-error-skill-create')

    render(<Settings appearance="system" onAppearanceChange={vi.fn()} />)
    await user.click(screen.getByRole('tab', { name: 'Skill Pi' }))
    const input = screen.getByRole('textbox', { name: 'Nome skill Pi' })
    await user.type(input, 'redis-inspector')
    await user.click(screen.getByRole('button', { name: 'Crea skill' }))
    let dialog = await screen.findByRole('dialog', { name: 'Crea skill Pi' })
    await user.click(within(dialog).getByRole('button', { name: 'Crea' }))

    const fieldError = await screen.findByText(/Skill Pi non creata/u)
    expect(fieldError).toHaveTextContent('Esiste già una skill Pi con questo nome. Scegli un nome diverso.')
    expect(fieldError).toHaveTextContent('Riferimento ERR-A1B2C3')
    expect(input).toHaveValue('redis-inspector')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Riprova creazione' }))
    dialog = await screen.findByRole('dialog', { name: 'Crea skill Pi' })
    await user.click(within(dialog).getByRole('button', { name: 'Crea' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    expect(create).toHaveBeenLastCalledWith('redis-inspector')
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByText(/Skill Pi non creata/u)).not.toBeInTheDocument()
    expect(toastStore.getVisibleToasts().filter((toast) => toast.type === 'error')).toHaveLength(0)
  })
})
