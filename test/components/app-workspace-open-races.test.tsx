// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in the isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />
// oxlint-disable-next-line typescript/triple-slash-reference -- make Vite asset modules visible when App is imported by the test project.
/// <reference types="vite/client" />

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AiTerminalRestartOptions,
  AiTerminalRestartResult,
  AppPreferencesSnapshot,
  PublicApplicationError,
  RecentWorkspace,
  TerminalExitStatus,
  TerminalResumeSnapshot,
  WorkspaceOpenResult,
  WorkspaceSessionSnapshot,
  WorkspaceSessionWriteSnapshot,
} from '@/bridge'
import { createDefaultWorkspaceSessionState } from '@/features/workspace/model/workspace-session'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

const editorGuardHarness = vi.hoisted(() => ({
  discardAll: vi.fn<() => Promise<void>>(),
  saveAll: vi.fn<() => Promise<void>>(),
}))
const databaseGuardHarness = vi.hoisted(() => ({
  discardAll: vi.fn<() => Promise<void>>(),
  saveAll: vi.fn<() => Promise<void>>(),
}))
const xtermHarness = vi.hoisted(() => ({
  clearCalls: 0,
  constructions: 0,
  disposals: 0,
  writes: [] as string[],
}))

vi.mock('@/lib/xterm-theme', () => ({
  observeXtermTheme: () => () => undefined,
  readXtermTheme: () => ({}),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

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
    cols = 100
    options: Record<string, unknown>
    rows = 30

    constructor(options: Record<string, unknown>) {
      this.options = options
      xtermHarness.constructions += 1
    }

    clear() { xtermHarness.clearCalls += 1 }
    dispose() { xtermHarness.disposals += 1 }
    focus() {}
    getSelection() { return '' }
    hasSelection() { return false }
    loadAddon() {}
    onData() { return { dispose() {} } }
    onScroll() { return { dispose() {} } }
    open() {}
    scrollToBottom() {}
    write(data: string, done?: () => void) {
      xtermHarness.writes.push(data)
      done?.()
    }
  },
}))

vi.mock('@/features/settings', () => ({
  Settings: () => <section aria-label="Impostazioni"><h1>Impostazioni VincodeLab</h1></section>,
}))

vi.mock('@/features/editor', async () => {
  const React = await import('react')
  return {
    ProjectEditor({ onWorkspaceGuardChange }: { onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void }) {
      const dirty = React.useRef(false)
      const [content, setContent] = React.useState('Editor salvato')

      React.useEffect(() => {
        const guard: WorkspaceChangeGuard = {
          hasUnsavedChanges: () => dirty.current,
          saveAll: async () => {
            await editorGuardHarness.saveAll()
            dirty.current = false
            setContent('Editor salvato')
          },
          discardAll: async () => {
            await editorGuardHarness.discardAll()
            dirty.current = false
            setContent('Editor salvato')
          },
        }
        onWorkspaceGuardChange?.(guard)
        return () => onWorkspaceGuardChange?.(null)
      }, [onWorkspaceGuardChange])

      return <div>
        <p>{content}</p>
        <button type="button" onClick={() => {
          dirty.current = true
          setContent('Editor modificato')
        }}>Modifica editor</button>
      </div>
    },
  }
})

vi.mock('@/features/database', async () => {
  const React = await import('react')
  return {
    DatabaseWorkspace({ onWorkspaceGuardChange }: { onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void }) {
      const dirty = React.useRef(false)
      const [content, setContent] = React.useState('Database pulito')

      React.useEffect(() => {
        const guard: WorkspaceChangeGuard = {
          hasUnsavedChanges: () => dirty.current,
          saveAll: async () => {
            await databaseGuardHarness.saveAll()
            dirty.current = false
            setContent('Database pulito')
          },
          discardAll: async () => {
            await databaseGuardHarness.discardAll()
            dirty.current = false
            setContent('Database pulito')
          },
        }
        onWorkspaceGuardChange?.(guard)
        return () => onWorkspaceGuardChange?.(null)
      }, [onWorkspaceGuardChange])

      return <div>
        <p>{content}</p>
        <button type="button" onClick={() => {
          dirty.current = true
          setContent('Database modificato')
        }}>Modifica database</button>
      </div>
    },
  }
})

import App from '@/app/App'
import { toast } from '@/components/ui'
import { toastStore } from '@/components/ui/toast-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function publicApplicationError(
  code: string,
  category: PublicApplicationError['category'],
  message: string,
  correlationId = 'ERR-B1C2D3',
): PublicApplicationError {
  return {
    category,
    code,
    correlationId,
    message: `${message} [${code}] [${correlationId}]`,
    recoverable: category !== 'cancelled',
    severity: category === 'cancelled' ? 'info' : category === 'configuration' || category === 'conflict' ? 'warning' : 'error',
  }
}

type WorkspaceBridgeOptions = {
  activeWorkspace?: string | null
  activeWorkspaceResult?: WorkspaceOpenResult | null
  getActive?: () => Promise<WorkspaceOpenResult | null>
  open: () => Promise<WorkspaceOpenResult | null>
  openRecent: (workspacePath: string) => Promise<WorkspaceOpenResult>
  piReload?: () => Promise<{ reloaded: true }>
  piRestart?: (options?: AiTerminalRestartOptions) => Promise<AiTerminalRestartResult>
  recents?: RecentWorkspace[]
  reveal?: () => Promise<{ revealed: true }>
  saveWorkspaceSession?: (snapshot: WorkspaceSessionWriteSnapshot) => Promise<WorkspaceSessionSnapshot>
  terminalResume?: () => Promise<TerminalResumeSnapshot>
  workspaceSession?: WorkspaceSessionSnapshot
}

function installBridge({ activeWorkspace = null, activeWorkspaceResult, getActive, open, openRecent, piReload, piRestart, recents = [], reveal, saveWorkspaceSession, terminalResume, workspaceSession }: WorkspaceBridgeOptions) {
  let closeRequested: ((request: LifecycleCloseRequest) => void) | null = null
  let menuCommand: ((command: AppMenuCommand) => void) | null = null
  let terminalExited: ((status: TerminalExitStatus) => void) | null = null
  let workspaceOpened: ((result: WorkspaceOpenResult | null) => void) | null = null
  const preferenceSnapshot: AppPreferencesSnapshot = {
    schema: [],
    global: {},
    explicitGlobal: {},
    overrides: {},
    effective: {},
    sources: {},
    workspaceAvailable: false,
  }
  const sessionState = createDefaultWorkspaceSessionState()
  const bridge = {
    lifecycle: {
      respondToClose: vi.fn(),
      onCloseRequested: vi.fn((listener: (request: LifecycleCloseRequest) => void) => {
        closeRequested = listener
        return () => { closeRequested = null }
      }),
    },
    appMenu: {
      setContext: vi.fn(),
      onCommand: vi.fn((listener: (command: AppMenuCommand) => void) => {
        menuCommand = listener
        return () => { menuCommand = null }
      }),
    },
    appearance: {
      get: vi.fn(async () => 'system' as const),
      set: vi.fn(async (appearance: 'system' | 'light' | 'dark') => appearance),
    },
    contextMenu: { open: vi.fn(async () => ({ opened: true as const })) },
    files: {
      index: vi.fn(),
      list: vi.fn(),
      prepareAttachment: vi.fn(),
    },
    pi: {
      reload: vi.fn(piReload ?? (async () => ({ reloaded: true as const }))),
      restart: vi.fn(piRestart ?? (async () => ({ restarted: true as const, runtime: 'pi' as const, piAvailable: true }))),
    },
    preferences: {
      get: vi.fn(async () => preferenceSnapshot),
    },
    terminal: {
      ack: vi.fn(),
      cancelPaste: vi.fn<Window['vincodeLab']['terminal']['cancelPaste']>(async () => ({ cancelled: true, sentBytes: 0, totalBytes: 0 })),
      chooseAttachments: vi.fn<Window['vincodeLab']['terminal']['chooseAttachments']>(async () => []),
      onError: vi.fn(() => vi.fn()),
      onExit: vi.fn((listener: (status: TerminalExitStatus) => void) => {
        terminalExited = listener
        return () => { terminalExited = null }
      }),
      onOutput: vi.fn(() => vi.fn()),
      onStreamState: vi.fn(() => vi.fn()),
      ready: vi.fn(),
      reportRendererMetrics: vi.fn(),
      resize: vi.fn(),
      resume: vi.fn(terminalResume ?? (async () => ({
        runtime: 'pi' as const,
        piAvailable: true,
        sessionId: 'session-test',
        snapshot: { data: '', firstSequence: 0, watermark: 0, bytes: 0 },
        status: 'running' as const,
      }))),
      prepareDroppedAttachments: vi.fn<Window['vincodeLab']['terminal']['prepareDroppedAttachments']>(async () => []),
      startPaste: vi.fn<Window['vincodeLab']['terminal']['startPaste']>(async ({ totalBytes }) => ({ accepted: true as const, transferId: 'paste-test', totalBytes })),
      writeInput: vi.fn<Window['vincodeLab']['terminal']['writeInput']>(async (data) => ({ accepted: true as const, bytes: new TextEncoder().encode(data).byteLength })),
      writeKey: vi.fn(),
      writePasteChunk: vi.fn<Window['vincodeLab']['terminal']['writePasteChunk']>(async ({ data }) => {
        const totalBytes = new TextEncoder().encode(data).byteLength
        return { accepted: true as const, complete: true, sentBytes: totalBytes, totalBytes }
      }),
    },
    workspace: {
      getActive: vi.fn(getActive ?? (async () => activeWorkspaceResult !== undefined ? activeWorkspaceResult : activeWorkspace ? { path: activeWorkspace } : null)),
      instanceStatus: vi.fn(),
      listRecent: vi.fn(async () => recents),
      onOpened: vi.fn((listener: (result: WorkspaceOpenResult | null) => void) => {
        workspaceOpened = listener
        return () => { workspaceOpened = null }
      }),
      open: vi.fn(open),
      openInNewInstance: vi.fn(),
      openRecent: vi.fn(openRecent),
      reveal: vi.fn(reveal ?? (async () => ({ revealed: true as const }))),
    },
    workspaceSession: {
      get: vi.fn(async () => workspaceSession ?? ({ version: 2 as const, state: sessionState, updatedAt: null })),
      save: vi.fn(saveWorkspaceSession ?? (async (snapshot: WorkspaceSessionWriteSnapshot) => ({ ...snapshot, updatedAt: 1 }))),
    },
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: bridge as unknown as Window['vincodeLab'],
  })
  return {
    bridge,
    dispatchCloseRequested(request: LifecycleCloseRequest) {
      if (!closeRequested) throw new Error('Listener lifecycle non registrato.')
      closeRequested(request)
    },
    dispatchMenuCommand(command: AppMenuCommand) {
      if (!menuCommand) throw new Error('Listener menu non registrato.')
      menuCommand(command)
    },
    dispatchTerminalExit(status: TerminalExitStatus) {
      if (!terminalExited) throw new Error('Listener exit Pi non registrato.')
      terminalExited(status)
    },
    dispatchWorkspaceOpened(result: WorkspaceOpenResult | null) {
      if (!workspaceOpened) throw new Error('Listener workspace non registrato.')
      workspaceOpened(result)
    },
  }
}

beforeEach(() => {
  xtermHarness.clearCalls = 0
  xtermHarness.constructions = 0
  xtermHarness.disposals = 0
  xtermHarness.writes = []
  databaseGuardHarness.discardAll.mockReset().mockResolvedValue(undefined)
  databaseGuardHarness.saveAll.mockReset().mockResolvedValue(undefined)
  editorGuardHarness.discardAll.mockReset().mockResolvedValue(undefined)
  editorGuardHarness.saveAll.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
})

async function renderActiveWorkspace(options: Partial<Pick<WorkspaceBridgeOptions, 'piReload' | 'piRestart' | 'reveal' | 'saveWorkspaceSession' | 'terminalResume' | 'workspaceSession'>> = {}) {
  const workspacePath = '/tmp/workspace-lifecycle'
  const controls = installBridge({
    activeWorkspace: workspacePath,
    open: vi.fn(async () => null),
    openRecent: vi.fn(async () => ({ path: workspacePath })),
    ...options,
  })
  render(<App />)
  await screen.findByLabelText(`Terminale AI: ${workspacePath}`)
  await waitFor(() => expect(controls.bridge.workspaceSession.get).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(controls.bridge.terminal.resume).toHaveBeenCalledTimes(1))
  return controls
}

async function makeEditorDirty(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Editor' }))
  await user.click(await screen.findByRole('button', { name: 'Modifica editor' }))
  expect(screen.getByText('Editor modificato')).toBeInTheDocument()
}

async function makeDatabaseDirty(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Database' }))
  await user.click(await screen.findByRole('button', { name: 'Modifica database' }))
  expect(screen.getByText('Database modificato')).toBeInTheDocument()
}

afterEach(() => {
  toast.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('apertura workspace nel renderer', () => {
  it('mantiene la stessa istanza delle viste operative dopo la navigazione reale della shell', async () => {
    const user = userEvent.setup()
    await renderActiveWorkspace()

    await user.click(screen.getByRole('tab', { name: 'Editor' }))
    const editorView = (await screen.findByText('Editor salvato')).parentElement
    expect(editorView).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Modifica editor' }))

    await user.click(screen.getByRole('tab', { name: 'Database' }))
    const databaseView = (await screen.findByText('Database pulito')).parentElement
    expect(databaseView).not.toBeNull()

    await user.click(screen.getByRole('tab', { name: 'AI' }))
    await user.click(screen.getByRole('tab', { name: 'Editor' }))
    expect(screen.getByText('Editor modificato').parentElement).toBe(editorView)

    await user.click(screen.getByRole('tab', { name: 'Database' }))
    expect(screen.getByText('Database pulito').parentElement).toBe(databaseView)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.disposals).toBe(0)
  })

  it('rende visibile e recuperabile il mancato ripristino del workspace precedente', async () => {
    installBridge({
      getActive: async () => { throw new Error('Session store offline /Users/alice/private token=restore-secret') },
      open: vi.fn(async () => null),
      openRecent: vi.fn(),
    })

    render(<App />)

    const heading = await screen.findByRole('heading', { name: 'Workspace precedente non ripristinato' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('La Home resta disponibile e nessun file è stato modificato. Scegli una cartella per continuare.')).toBeInTheDocument()
    expect(screen.getByText(/Riferimento ERR-[A-F0-9]{6}/u)).toBeInTheDocument()
    expect(within(heading.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Scegli cartella' })).toBeEnabled()
    expect(screen.queryByText(/alice|restore-secret/iu)).not.toBeInTheDocument()
  })

  it('mostra un recupero locale e correlato quando il layout salvato era corrotto', async () => {
    const user = userEvent.setup()
    await renderActiveWorkspace({
      workspaceSession: {
        recovery: { correlationId: 'ERR-A1B2C3', kind: 'corrupt' },
        state: createDefaultWorkspaceSessionState(),
        updatedAt: null,
        version: 2,
      },
    })

    expect(await screen.findByRole('heading', { name: 'Layout del workspace ripristinato' })).toBeInTheDocument()
    expect(screen.getByText(/File e dati sono rimasti al sicuro/u)).toBeInTheDocument()
    expect(screen.getByText('Riferimento ERR-A1B2C3')).toBeInTheDocument()
    expect(screen.queryByText(/json|stack|payload/iu)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continua' }))
    expect(screen.queryByRole('heading', { name: 'Layout del workspace ripristinato' })).not.toBeInTheDocument()
  })

  it('applica soltanto la richiesta più recente quando A e B terminano fuori ordine', async () => {
    const user = userEvent.setup()
    const pendingA = deferred<WorkspaceOpenResult>()
    const pendingB = deferred<WorkspaceOpenResult | null>()
    const recentA = { path: '/tmp/workspace-a', lastOpenedAt: 100 }
    const controls = installBridge({
      open: () => pendingB.promise,
      openRecent: () => pendingA.promise,
      recents: [recentA],
    })

    render(<App />)
    await user.click(await screen.findByRole('button', { name: /workspace-a/i }))
    expect(controls.bridge.workspace.openRecent).toHaveBeenCalledWith(recentA.path)

    act(() => controls.dispatchMenuCommand('workbench.commandPalette'))
    const palette = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await user.type(palette, 'Apri cartella')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(controls.bridge.workspace.open).toHaveBeenCalledTimes(1))

    await act(async () => pendingB.resolve({ error: 'Errore più recente B' }))
    const retry = await screen.findByRole('button', { name: 'Riprova apertura' })
    expect(retry).toBeEnabled()
    expect(screen.getByText('Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')).toBeInTheDocument()
    expect(screen.getByText(/^Riferimento ERR-/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apri cartella…' })).toBeEnabled()

    await act(async () => pendingA.resolve({ path: recentA.path }))
    expect(screen.queryByLabelText(`Terminale AI: ${recentA.path}`)).not.toBeInTheDocument()
    expect(screen.getByText('Il workspace non è stato aperto. Il workspace precedente è rimasto disponibile.')).toBeInTheDocument()
    expect(retry).toBeEnabled()
  })

  it('ripristina la Home dopo un reject e consente alla stessa richiesta di riuscire al retry', async () => {
    const user = userEvent.setup()
    const firstAttempt = deferred<WorkspaceOpenResult | null>()
    const secondAttempt = deferred<WorkspaceOpenResult | null>()
    const controls = installBridge({
      open: vi.fn()
        .mockReturnValueOnce(firstAttempt.promise)
        .mockReturnValueOnce(secondAttempt.promise),
      openRecent: vi.fn(),
    })

    render(<App />)
    const choose = await screen.findByRole('button', { name: 'Apri cartella…' })
    await user.click(choose)
    expect(choose).toBeDisabled()

    await act(async () => firstAttempt.reject(new Error('Bridge workspace temporaneamente offline')))
    const retry = await screen.findByRole('button', { name: 'Riprova apertura' })
    expect(screen.getByText('Il servizio workspace non ha completato la richiesta. Il workspace precedente è rimasto aperto.')).toBeInTheDocument()
    expect(screen.getByText(/^Riferimento ERR-/u)).toBeInTheDocument()
    expect(choose).toBeEnabled()
    expect(retry).toBeEnabled()

    await user.click(retry)
    expect(controls.bridge.workspace.open).toHaveBeenCalledTimes(2)
    await act(async () => secondAttempt.resolve({ path: '/tmp/workspace-recuperato' }))

    expect(await screen.findByLabelText('Terminale AI: /tmp/workspace-recuperato')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Riprova apertura' })).not.toBeInTheDocument()
    expect(screen.getByText('Pi diretto pronto')).toBeInTheDocument()
  })

  it('instrada il comando nativo workspace.open attraverso la guardia delle modifiche', async () => {
    const user = userEvent.setup()
    const controls = await renderActiveWorkspace()
    await makeEditorDirty(user)

    act(() => controls.dispatchMenuCommand('workspace.open'))

    expect(await screen.findByRole('heading', { name: 'Vuoi cambiare workspace?' })).toBeInTheDocument()
    expect(controls.bridge.workspace.open).not.toHaveBeenCalled()
  })

  it('mostra un failure Finder deduplicato e consente il retry senza perdere il workspace', async () => {
    const user = userEvent.setup()
    const reveal = vi.fn()
      .mockRejectedValueOnce(new Error('private /Users/alice/work [WORKSPACE_REVEAL_FAILED] [ERR-A1B2C3]'))
      .mockRejectedValueOnce(new Error('private /Users/alice/work [WORKSPACE_REVEAL_FAILED] [ERR-D4E5F6]'))
      .mockResolvedValueOnce({ revealed: true as const })
    const controls = await renderActiveWorkspace({ reveal })

    act(() => {
      controls.dispatchMenuCommand('workspace.reveal')
      controls.dispatchMenuCommand('workspace.reveal')
    })

    const failure = await screen.findByRole('alert', { name: 'Workspace non mostrato nel Finder' })
    await waitFor(() => expect(controls.bridge.workspace.reveal).toHaveBeenCalledTimes(2))
    expect(toastStore.getCount()).toBe(1)
    expect(toastStore.getVisibleToasts()[0]?.meta?.errorExperience).toEqual({ occurrences: 2 })
    expect(within(failure).getByRole('button', { name: 'Riprova' })).toBeEnabled()
    expect(screen.queryByText(/alice|private/iu)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')).toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(controls.bridge.workspace.reveal).toHaveBeenCalledTimes(3))
    expect(toastStore.getCount()).toBe(1)
    expect(screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')).toBeInTheDocument()
  })
})

describe('Error Experience della sessione AI', () => {
  it('presenta Herdr come client condiviso, limita le azioni ambigue e offre Pi diretto solo quando disponibile', async () => {
    const snapshot: TerminalResumeSnapshot = {
      runtime: 'herdr',
      piAvailable: true,
      sessionId: 'herdr-session-test',
      snapshot: { data: 'fleet Herdr', firstSequence: 0, watermark: 0, bytes: 11 },
      status: 'running',
    }
    const controls = await renderActiveWorkspace({ terminalResume: async () => snapshot })
    const user = userEvent.setup()

    expect(screen.getByRole('status')).toHaveTextContent('Herdr · sessione condivisa · seleziona o avvia un pane Pi')
    expect(screen.getByText('Contesto di avvio: /tmp/workspace-lifecycle')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Esegui /reload nel pane Pi desiderato in Herdr' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Ricollega il client Herdr (la fleet resta attiva)' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Allega file a Pi' })).not.toBeInTheDocument()

    act(() => controls.dispatchTerminalExit({ exitCode: 1, signal: 0, runtime: 'herdr', piAvailable: true }))
    const notice = await screen.findByRole('alert')
    expect(within(notice).getByRole('heading', { name: 'Client Herdr terminato' })).toBeVisible()
    expect(within(notice).getByRole('button', { name: 'Ricollega Herdr' })).toBeEnabled()
    await user.click(within(notice).getByRole('button', { name: 'Avvia Pi diretto' }))
    await waitFor(() => expect(controls.bridge.pi.restart).toHaveBeenCalledWith({ runtime: 'pi' }))
  })

  it('non propone Pi diretto quando Herdr è disponibile ma Pi locale manca', async () => {
    const snapshot: TerminalResumeSnapshot = {
      runtime: 'herdr',
      piAvailable: false,
      sessionId: 'herdr-only-session-test',
      snapshot: { data: '', firstSequence: 0, watermark: 0, bytes: 0 },
      status: 'running',
    }
    const controls = await renderActiveWorkspace({ terminalResume: async () => snapshot })

    expect(screen.getByRole('status')).toHaveTextContent('Herdr · sessione condivisa · Pi locale non rilevato')
    act(() => controls.dispatchTerminalExit({ exitCode: 1, signal: 0, runtime: 'herdr', piAvailable: false }))
    const notice = await screen.findByRole('alert')
    expect(within(notice).queryByRole('button', { name: 'Avvia Pi diretto' })).not.toBeInTheDocument()
    expect(within(notice).getByRole('button', { name: 'Apri impostazioni' })).toBeEnabled()
  })

  it('mantiene xterm e apre le Impostazioni quando l avvio richiede configurazione', async () => {
    const workspacePath = '/tmp/ai-config'
    const errorIncident = publicApplicationError(
      'AI_PROVIDER_CONFIG_MISSING',
      'configuration',
      'La configurazione del provider AI deve essere completata.',
      'ERR-A1B2C3',
    )
    const controls = installBridge({
      activeWorkspaceResult: {
        path: workspacePath,
        error: errorIncident.message,
        errorIncident,
      },
      open: vi.fn(async () => null),
      openRecent: vi.fn(async () => ({ path: workspacePath })),
    })
    const user = userEvent.setup()
    const view = render(<App />)

    const terminalView = await screen.findByLabelText(`Terminale AI: ${workspacePath}`)
    await waitFor(() => expect(controls.bridge.terminal.resume).toHaveBeenCalledTimes(1))
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')
    expect(xtermHost).not.toBeNull()
    expect(await screen.findByRole('heading', { name: 'Configurazione AI da completare' })).toBeVisible()
    expect(screen.getByText('Riferimento ERR-A1B2C3')).toBeVisible()
    expect(screen.queryByText(/Codice: AI_PROVIDER_CONFIG_MISSING/u)).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'Configurazione AI da completare' })).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Apri impostazioni' }))
    expect(await screen.findByRole('heading', { name: 'Impostazioni VincodeLab' })).toBeVisible()
    expect(document.body.contains(xtermHost)).toBe(true)

    await user.click(screen.getByRole('tab', { name: 'AI' }))
    expect(view.container.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(screen.getByRole('heading', { name: 'Configurazione AI da completare' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Riprova avvio' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Configurazione AI da completare' })).not.toBeInTheDocument())
    expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
  })

  it.each([
    {
      code: 'AI_PROVIDER_RATE_LIMIT',
      category: 'network' as const,
      expectedTitle: 'Limite del provider AI raggiunto',
      message: 'provider HTTP 429',
    },
    {
      code: 'AI_PROVIDER_FAILURE',
      category: 'process' as const,
      expectedTitle: 'Provider AI non disponibile',
      message: 'provider non disponibile',
    },
    {
      code: 'AI_REQUEST_CANCELLED',
      category: 'cancelled' as const,
      expectedTitle: 'Operazione AI annullata',
      message: 'richiesta cancellata',
    },
  ])('classifica $code durante il reload senza toast duplicati né rimontare xterm', async ({ category, code, expectedTitle, message }) => {
    const controls = await renderActiveWorkspace()
    const user = userEvent.setup()
    const terminalView = screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')
    controls.bridge.pi.reload
      .mockRejectedValueOnce(publicApplicationError(code, category, message))
      .mockRejectedValueOnce(publicApplicationError(code, category, message))
      .mockResolvedValueOnce({ reloaded: true })

    await user.click(screen.getByRole('button', { name: 'Ricarica risorse Pi' }))

    expect(await screen.findByRole('heading', { name: expectedTitle })).toBeVisible()
    expect(screen.getAllByRole('heading', { name: expectedTitle })).toHaveLength(1)
    expect(screen.getByText('Riferimento ERR-B1C2D3')).toBeVisible()
    expect(screen.queryByText(new RegExp(`Codice: ${code}`, 'u'))).not.toBeInTheDocument()
    expect(screen.getByText(/La sessione corrente e l’output già disponibile sono rimasti invariati/u)).toBeVisible()
    expect(toastStore.getCount()).toBe(0)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Riprova' })).toBeEnabled())
    expect(screen.getAllByRole('heading', { name: expectedTitle })).toHaveLength(1)
    expect(screen.getByText('Riferimento ERR-B1C2D3')).toBeVisible()
    expect(toastStore.getCount()).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: expectedTitle })).not.toBeInTheDocument())
    expect(controls.bridge.pi.reload).toHaveBeenCalledTimes(3)
    expect(terminalView.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
  })

  it('distingue il timeout del riavvio e conserva output e istanza xterm durante il retry', async () => {
    const controls = await renderActiveWorkspace()
    const user = userEvent.setup()
    const terminalView = screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')
    controls.bridge.pi.restart
      .mockRejectedValueOnce(new Error('restart timed out [AI_RESTART_TIMEOUT] [ERR-C1D2E3]'))
      .mockResolvedValueOnce({ restarted: true, runtime: 'pi', piAvailable: true })

    await user.click(screen.getByRole('button', { name: 'Riavvia sessione Pi' }))

    expect(await screen.findByRole('heading', { name: 'Sessione AI senza risposta' })).toBeVisible()
    expect(screen.getByText(/L’output precedente è rimasto disponibile/u)).toBeVisible()
    expect(screen.queryByText(/restart timed out/u)).not.toBeInTheDocument()
    expect(xtermHarness.clearCalls).toBe(0)
    const notice = screen.getByRole('alert')
    await user.click(within(notice).getByRole('button', { name: 'Riavvia' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sessione AI senza risposta' })).not.toBeInTheDocument())
    expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(2)
    expect(terminalView.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
  })

  it('se il riavvio riesce ma il resume fallisce ritenta soltanto il collegamento output', async () => {
    const snapshot: TerminalResumeSnapshot = {
      runtime: 'pi',
      sessionId: 'session-test',
      snapshot: { data: 'output conservato', firstSequence: 0, watermark: 0, bytes: 16 },
      status: 'running',
    }
    const resume = vi.fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('resume offline [AI_OUTPUT_NETWORK] [ERR-D1E2F3]'))
      .mockResolvedValueOnce({ ...snapshot, sessionId: 'session-restarted' })
    const controls = await renderActiveWorkspace({ terminalResume: resume })
    const user = userEvent.setup()
    const terminalView = screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')

    await user.click(screen.getByRole('button', { name: 'Riavvia sessione Pi' }))

    expect(await screen.findByRole('heading', { name: 'Sessione riavviata, output non collegato' })).toBeVisible()
    expect(screen.getByText(/La sessione è stata riavviata e l’output precedente è rimasto visibile/u)).toBeVisible()
    expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(2)
    expect(xtermHarness.clearCalls).toBe(0)

    await user.click(screen.getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sessione riavviata, output non collegato' })).not.toBeInTheDocument())
    expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(3)
    expect(terminalView.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
  })

  it('conserva la sessione visiva dopo un crash senza mostrare signal o exit code nel messaggio principale', async () => {
    const controls = await renderActiveWorkspace()
    const user = userEvent.setup()
    const terminalView = screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')

    act(() => controls.dispatchTerminalExit({ exitCode: 137, signal: 9 }))

    expect(await screen.findByRole('heading', { name: 'Sessione AI interrotta' })).toBeVisible()
    expect(screen.getByText(/L’output già ricevuto è rimasto disponibile/u)).toBeVisible()
    expect(screen.queryByText(/PTY signal 9/u)).not.toBeInTheDocument()
    expect(screen.getByText('Errore Terminale AI')).toBeVisible()
    expect(xtermHarness.clearCalls).toBe(0)

    const notice = screen.getByRole('alert')
    await user.click(within(notice).getByRole('button', { name: 'Riavvia' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Sessione AI interrotta' })).not.toBeInTheDocument())
    expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(1)
    expect(terminalView.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
  })

  it('recupera lo storico iniziale ritentando solo resume sulla stessa istanza xterm', async () => {
    const snapshot: TerminalResumeSnapshot = {
      runtime: 'pi',
      sessionId: 'session-restored',
      snapshot: { data: 'storico recuperato', firstSequence: 0, watermark: 0, bytes: 18 },
      status: 'running',
    }
    const resume = vi.fn()
      .mockRejectedValueOnce(new Error('resume non disponibile [AI_OUTPUT_UNAVAILABLE] [ERR-E1F2A3]'))
      .mockResolvedValueOnce(snapshot)
    const controls = await renderActiveWorkspace({ terminalResume: resume })
    const user = userEvent.setup()
    const terminalView = screen.getByLabelText('Terminale AI: /tmp/workspace-lifecycle')
    const xtermHost = terminalView.querySelector('[data-xterm-host="ai"]')

    expect(await screen.findByRole('heading', { name: 'Storico della sessione AI non disponibile' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Riprova' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Storico della sessione AI non disponibile' })).not.toBeInTheDocument())
    expect(resume).toHaveBeenCalledTimes(2)
    expect(controls.bridge.pi.restart).not.toHaveBeenCalled()
    expect(terminalView.querySelector('[data-xterm-host="ai"]')).toBe(xtermHost)
    expect(xtermHarness.constructions).toBe(1)
    expect(xtermHarness.clearCalls).toBe(0)
    expect(xtermHarness.writes).toContain('storico recuperato')
  })
})

describe('chiusura protetta nel renderer', () => {
  it.each<LifecycleCloseReason>(['window', 'quit'])('attende il flush della sessione prima di accettare una chiusura pulita (%s)', async (reason) => {
    const user = userEvent.setup()
    const pendingSave = deferred<WorkspaceSessionSnapshot>()
    let submittedSnapshot: WorkspaceSessionWriteSnapshot | null = null
    const controls = await renderActiveWorkspace({
      saveWorkspaceSession: (snapshot) => {
        submittedSnapshot = snapshot
        return pendingSave.promise
      },
    })

    await user.click(screen.getByRole('tab', { name: 'Editor' }))
    act(() => controls.dispatchCloseRequested({ requestId: `clean-${reason}`, reason }))

    await waitFor(() => expect(controls.bridge.workspaceSession.save).toHaveBeenCalledTimes(1))
    expect(controls.bridge.lifecycle.respondToClose).not.toHaveBeenCalled()
    expect(submittedSnapshot).not.toBeNull()

    await act(async () => pendingSave.resolve({ ...submittedSnapshot!, updatedAt: 2 }))
    await waitFor(() => expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith(`clean-${reason}`, 'proceed'))
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('annulla una chiusura dirty, ignora i duplicati e non sostituisce il dialogo con richieste stale', async () => {
    const user = userEvent.setup()
    const controls = await renderActiveWorkspace()
    await makeEditorDirty(user)

    act(() => {
      controls.dispatchCloseRequested({ requestId: 'dirty-window', reason: 'window' })
      controls.dispatchCloseRequested({ requestId: 'dirty-window', reason: 'window' })
      controls.dispatchCloseRequested({ requestId: 'stale-quit', reason: 'quit' })
    })

    expect(await screen.findByRole('heading', { name: 'Vuoi chiudere la finestra?' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vuoi uscire da VincodeLab?' })).not.toBeInTheDocument()
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith('stale-quit', 'cancel')

    await user.click(screen.getByRole('button', { name: 'Annulla' }))
    await waitFor(() => expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith('dirty-window', 'cancel'))
    expect(screen.getByText('Editor modificato')).toBeInTheDocument()

    act(() => controls.dispatchCloseRequested({ requestId: 'dirty-window', reason: 'window' }))
    expect(controls.bridge.lifecycle.respondToClose.mock.calls.filter(([requestId]) => requestId === 'dirty-window')).toHaveLength(1)
    expect(controls.bridge.lifecycle.respondToClose.mock.calls.filter(([requestId]) => requestId === 'stale-quit')).toHaveLength(1)
  })

  it('mantiene il draft, risponde cancel e non duplica l’errore locale quando il salvataggio fallisce', async () => {
    const user = userEvent.setup()
    editorGuardHarness.saveAll.mockRejectedValueOnce(new Error('Scrittura editor fallita'))
    const controls = await renderActiveWorkspace()
    await makeEditorDirty(user)

    act(() => controls.dispatchCloseRequested({ requestId: 'save-failure', reason: 'window' }))
    await user.click(await screen.findByRole('button', { name: 'Salva e chiudi' }))

    await waitFor(() => expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith('save-failure', 'cancel'))
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledTimes(1)
    expect(editorGuardHarness.saveAll).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Editor modificato')).toBeInTheDocument()
    expect(screen.queryByText('Chiusura annullata: salvataggio non riuscito')).not.toBeInTheDocument()
  })

  it.each([
    { action: 'save', button: 'Salva e chiudi' },
    { action: 'discard', button: 'Scarta e chiudi' },
  ] as const)('risponde proceed una sola volta dopo $action riuscito', async ({ action, button }) => {
    const user = userEvent.setup()
    const controls = await renderActiveWorkspace()
    await makeEditorDirty(user)

    act(() => controls.dispatchCloseRequested({ requestId: `success-${action}`, reason: 'window' }))
    await user.click(await screen.findByRole('button', { name: button }))

    await waitFor(() => expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith(`success-${action}`, 'proceed'))
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledTimes(1)
    expect(editorGuardHarness[action === 'save' ? 'saveAll' : 'discardAll']).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Editor salvato')).toBeInTheDocument()

    act(() => controls.dispatchCloseRequested({ requestId: `success-${action}`, reason: 'window' }))
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledTimes(1)
  })

  it('mantiene locale e recuperabile un incolla rifiutato dalla sessione AI', async () => {
    const user = userEvent.setup()
    const controls = await renderActiveWorkspace()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(async () => 'contenuto riservato da non mostrare') },
    })
    controls.bridge.terminal.startPaste.mockResolvedValueOnce({ accepted: false, reason: 'not-running', totalBytes: 42, limit: 5 * 1024 * 1024 })

    await user.click(screen.getByRole('button', { name: 'Incolla nel terminale' }))
    const dialog = await screen.findByRole('dialog', { name: 'Incolla nel Terminale AI' })
    expect(within(dialog).getByRole('heading', { name: 'Sessione AI non disponibile' })).toBeInTheDocument()
    expect(within(dialog).getByText(/Riferimento ERR-[A-F0-9]{6}/u)).toBeInTheDocument()
    expect(screen.queryByText(/contenuto riservato/iu)).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Riavvia sessione' }))
    await waitFor(() => expect(controls.bridge.pi.restart).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog', { name: 'Incolla nel Terminale AI' })).not.toBeInTheDocument()
  })

  it('rimuove gli allegati solo dopo l’acknowledgement del Terminale AI', async () => {
    const user = userEvent.setup()
    const controls = await renderActiveWorkspace()
    controls.bridge.terminal.chooseAttachments.mockResolvedValueOnce([{ absolutePath: '/tmp/contesto.md', name: 'contesto.md' }])
    controls.bridge.terminal.writeInput
      .mockRejectedValueOnce(new Error('token=non-mostrare AI_SESSION_NOT_RUNNING'))
      .mockResolvedValueOnce({ accepted: true, bytes: 18 })

    await user.click(screen.getByRole('button', { name: 'Allega file a Pi' }))
    expect(await screen.findByText('contesto.md')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Inserisci' }))

    const failure = await screen.findByRole('alert')
    expect(within(failure).getByRole('heading', { name: 'Allegati non inseriti' })).toBeInTheDocument()
    expect(screen.getByText('contesto.md')).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/iu)).not.toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Inserisci di nuovo' }))
    await waitFor(() => expect(controls.bridge.terminal.writeInput).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('contesto.md')).not.toBeInTheDocument())
  })
})

describe('integrazione guardia Database in App', () => {
  it('protegge il cambio workspace con Cancel e consente il retry dopo un Save fallito', async () => {
    const user = userEvent.setup()
    databaseGuardHarness.saveAll.mockRejectedValueOnce(new Error('Transazione Database ancora attiva'))
    const controls = await renderActiveWorkspace()
    await makeDatabaseDirty(user)

    act(() => controls.dispatchMenuCommand('workspace.open'))
    await user.click(await screen.findByRole('button', { name: 'Annulla' }))
    expect(controls.bridge.workspace.open).not.toHaveBeenCalled()
    expect(databaseGuardHarness.saveAll).not.toHaveBeenCalled()
    expect(screen.getByText('Database modificato')).toBeInTheDocument()

    act(() => controls.dispatchMenuCommand('workspace.open'))
    await user.click(await screen.findByRole('button', { name: 'Salva e cambia' }))
    await waitFor(() => expect(databaseGuardHarness.saveAll).toHaveBeenCalledTimes(1))
    expect(controls.bridge.workspace.open).not.toHaveBeenCalled()
    expect(screen.getByText('Database modificato')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Vuoi cambiare workspace?' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salva e cambia' }))
    await waitFor(() => expect(databaseGuardHarness.saveAll).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(controls.bridge.workspace.open).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Database pulito')).toBeInTheDocument()
  })

  it('mantiene il Database su close Cancel e attende Discard prima del proceed al quit', async () => {
    const user = userEvent.setup()
    const discard = deferred<void>()
    databaseGuardHarness.discardAll.mockReturnValueOnce(discard.promise)
    const controls = await renderActiveWorkspace()
    await makeDatabaseDirty(user)

    act(() => controls.dispatchCloseRequested({ requestId: 'database-window', reason: 'window' }))
    await user.click(await screen.findByRole('button', { name: 'Annulla' }))
    expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith('database-window', 'cancel')
    expect(databaseGuardHarness.discardAll).not.toHaveBeenCalled()
    expect(screen.getByText('Database modificato')).toBeInTheDocument()

    act(() => controls.dispatchCloseRequested({ requestId: 'database-quit', reason: 'quit' }))
    await user.click(await screen.findByRole('button', { name: 'Scarta ed esci' }))
    await waitFor(() => expect(databaseGuardHarness.discardAll).toHaveBeenCalledTimes(1))
    expect(controls.bridge.lifecycle.respondToClose).not.toHaveBeenCalledWith('database-quit', 'proceed')

    await act(async () => discard.resolve())
    await waitFor(() => expect(controls.bridge.lifecycle.respondToClose).toHaveBeenCalledWith('database-quit', 'proceed'))
    expect(controls.bridge.lifecycle.respondToClose.mock.calls.filter(([requestId]) => requestId === 'database-quit')).toHaveLength(1)
    expect(screen.getByText('Database pulito')).toBeInTheDocument()
  })
})
