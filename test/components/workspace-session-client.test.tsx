import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_WORKSPACE_SESSION_BYTES,
  createDefaultWorkspaceSessionState,
  createWorkspaceSessionClient,
  normalizeWorkspaceSessionState,
  type WorkspaceSessionStorage,
} from '@/lib/workspace-session'

function storedSnapshot(state = createDefaultWorkspaceSessionState(), updatedAt: number | null = 1): WorkspaceSessionSnapshot {
  return { version: 2, state, updatedAt }
}

function legacyTerminalState(): WorkspaceSessionState {
  const state = createDefaultWorkspaceSessionState() as unknown as { terminal: Record<string, unknown> }
  delete state.terminal.openSessionCount
  delete state.terminal.activeSessionOrdinal
  return state as unknown as WorkspaceSessionState
}

const SESSION_SECTION_KEYS = ['navigation', 'editor', 'terminal', 'github', 'database', 'redis', 'panels', 'focus'] as const

function populatedWorkspaceSessionState(): WorkspaceSessionState {
  return {
    navigation: { section: 'github', aiTab: 'skills' },
    editor: {
      openFiles: [
        { source: 'workspace', id: 'src/App.tsx', mode: 'source' },
        { source: 'remote', id: 'remote-file-1', mode: 'preview' },
      ],
      activeFile: { source: 'workspace', id: 'src/App.tsx', mode: 'source' },
      expandedDirectoryIds: ['src'],
      fileViews: [
        { source: 'workspace', id: 'src/App.tsx', mode: 'source', selection: { anchor: 12, head: 18 }, scroll: { top: 140, left: 4 } },
        { source: 'remote', id: 'remote-file-1', mode: 'preview', selection: { anchor: 3, head: 3 }, scroll: { top: 20, left: 0 } },
      ],
    },
    terminal: {
      tab: 'remote',
      remoteView: 'local',
      selectedProfileCommandId: 'profile-1',
      openSessionCount: 2,
      activeSessionOrdinal: 1,
    },
    github: {
      tab: 'projects',
      selectedDiffPath: 'src/App.tsx',
      selectedProjectNumber: 42,
      issueStateFilter: 'all',
      scroll: { changes: 11, graph: 22, issues: 33, projects: 44 },
    },
    database: {
      selectedConnectionId: 'connection-1',
      sidebarTab: 'queries',
      view: 'data',
      expandedSchemaIds: ['public', 'public.users'],
      selectedTableName: 'users',
      activeSavedQueryId: 'query-1',
      scroll: { explorer: 55, editor: 66, results: 77 },
    },
    redis: {
      selectedConnectionId: 'redis-connection-1',
      databaseIndex: 2,
      view: 'search',
      typeFilter: 'hash',
      inspectorTab: 'metadata',
    },
    panels: {
      editorExplorer: 280,
      terminalCommands: 300,
      remoteConnections: 260,
      databaseSidebar: 320,
      githubProjectPicker: 240,
    },
    focus: { view: 'editor', target: 'editor.code' },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function memoryStorage(initial = storedSnapshot(createDefaultWorkspaceSessionState(), null)) {
  let snapshot = initial
  const get = vi.fn(async () => snapshot)
  const save = vi.fn(async (input: WorkspaceSessionWriteSnapshot) => {
    snapshot = { ...input, updatedAt: Date.now() }
    return snapshot
  })
  return { api: { get, save } satisfies WorkspaceSessionStorage, get, save }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('WorkspaceSessionClient', () => {
  it('annulla restore precedenti per generazione e non applica risposte fuori ordine', async () => {
    const firstRead = deferred<WorkspaceSessionSnapshot>()
    const secondRead = deferred<WorkspaceSessionSnapshot>()
    const get = vi.fn()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)
    const storage: WorkspaceSessionStorage = {
      get,
      save: vi.fn(async (input) => ({ ...input, updatedAt: 1 })),
    }
    const client = createWorkspaceSessionClient({ storage })

    const firstLoad = client.load()
    const secondLoad = client.load()
    const secondState = createDefaultWorkspaceSessionState()
    secondState.navigation.section = 'database'
    secondRead.resolve(storedSnapshot(secondState, 20))

    await expect(secondLoad).resolves.toMatchObject({ applied: true, source: 'stored', generation: 2 })
    expect(client.getSnapshot().state.navigation.section).toBe('database')

    const staleState = createDefaultWorkspaceSessionState()
    staleState.navigation.section = 'editor'
    firstRead.resolve(storedSnapshot(staleState, 10))
    await expect(firstLoad).resolves.toMatchObject({ applied: false, source: 'cancelled', generation: 1 })
    expect(client.getSnapshot().state.navigation.section).toBe('database')
    client.dispose()
  })

  it('protegge una modifica locale effettuata mentre il restore è in corso', async () => {
    const read = deferred<WorkspaceSessionSnapshot>()
    const storage: WorkspaceSessionStorage = {
      get: vi.fn(() => read.promise),
      save: vi.fn(async (input) => ({ ...input, updatedAt: 1 })),
    }
    const client = createWorkspaceSessionClient({ storage })

    const load = client.load()
    client.patch((state) => ({
      ...state,
      navigation: { ...state.navigation, section: 'terminal' },
    }))
    const restored = createDefaultWorkspaceSessionState()
    restored.navigation.section = 'github'
    read.resolve(storedSnapshot(restored, 5))

    await expect(load).resolves.toMatchObject({ applied: false, source: 'superseded' })
    expect(client.getSnapshot().state.navigation.section).toBe('terminal')
    expect(client.getSnapshot().dirty).toBe(true)
    client.dispose()
  })

  it('usa default sicuri quando get fallisce', async () => {
    const onError = vi.fn()
    const failedStorage: WorkspaceSessionStorage = {
      get: vi.fn(async () => { throw new Error('offline') }),
      save: vi.fn(async (input) => ({ ...input, updatedAt: 1 })),
    }
    const failedClient = createWorkspaceSessionClient({ storage: failedStorage, onError })
    await expect(failedClient.load()).resolves.toMatchObject({ applied: true, source: 'fallback' })
    expect(failedClient.getSnapshot().state).toEqual(createDefaultWorkspaceSessionState())
    expect(failedClient.getSnapshot().dirty).toBe(false)
    expect(onError).toHaveBeenCalledOnce()
    failedClient.dispose()
  })

  it('propaga un recupero correlato quando il main ha isolato uno snapshot corrotto', async () => {
    const onError = vi.fn()
    const storage = memoryStorage({
      ...storedSnapshot(createDefaultWorkspaceSessionState(), null),
      recovery: { correlationId: 'ERR-A1B2C3', kind: 'corrupt' },
    })
    const client = createWorkspaceSessionClient({ storage: storage.api, onError })

    await expect(client.load()).resolves.toMatchObject({
      applied: true,
      recovery: { correlationId: 'ERR-A1B2C3', kind: 'corrupt' },
      source: 'default',
    })
    expect(client.getSnapshot().state).toEqual(createDefaultWorkspaceSessionState())
    expect(onError).not.toHaveBeenCalled()
    client.dispose()
  })

  it('mantiene il fallback totale per una versione snapshot sconosciuta', async () => {
    const onError = vi.fn()
    const futureSnapshot = {
      version: 3,
      state: populatedWorkspaceSessionState(),
      updatedAt: 99,
    } as unknown as WorkspaceSessionSnapshot
    const storage = memoryStorage(futureSnapshot)
    const client = createWorkspaceSessionClient({ storage: storage.api, onError })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'fallback' })
    expect(client.getSnapshot().state).toEqual(createDefaultWorkspaceSessionState())
    expect(onError).toHaveBeenCalledOnce()
    client.dispose()
  })

  it('accetta snapshot v1 terminale legacy e normalizza soltanto i nuovi metadati mancanti', async () => {
    const legacyState = legacyTerminalState()
    const storage = memoryStorage(storedSnapshot(legacyState, 12))
    const client = createWorkspaceSessionClient({ storage: storage.api })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'stored' })
    expect(client.getSnapshot().state.terminal).toEqual({
      tab: 'shell',
      remoteView: 'server',
      selectedProfileCommandId: null,
      openSessionCount: 0,
      activeSessionOrdinal: null,
    })
    expect(normalizeWorkspaceSessionState(legacyState)?.terminal).toMatchObject({
      openSessionCount: 0,
      activeSessionOrdinal: null,
    })
    client.dispose()
  })

  it('accetta i riferimenti Editor v1 senza modalità sorgente o anteprima', async () => {
    const legacyState = populatedWorkspaceSessionState()
    for (const file of legacyState.editor.openFiles) delete file.mode
    if (legacyState.editor.activeFile) delete legacyState.editor.activeFile.mode
    for (const view of legacyState.editor.fileViews) delete view.mode
    const storage = memoryStorage(storedSnapshot(legacyState, 13))
    const client = createWorkspaceSessionClient({ storage: storage.api })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'stored' })
    expect(client.getSnapshot().state.editor).toEqual(legacyState.editor)
    client.dispose()
  })

  it.each([
    ['navigation', '{"section":"editor"'],
    ['editor', { openFiles: 'not-an-array' }],
    ['terminal', ['shell']],
    ['github', { tab: 'future-tab' }],
    ['database', null],
    ['panels', { editorExplorer: Number.NaN }],
    ['focus', { view: 'editor', target: 'missing-target' }],
  ] satisfies Array<[typeof SESSION_SECTION_KEYS[number], unknown]>)('isola una shape corrotta in %s', async (section, malformedSection) => {
    const storedState = populatedWorkspaceSessionState()
    ;(storedState as unknown as Record<string, unknown>)[section] = malformedSection
    const storage = memoryStorage(storedSnapshot(storedState, 50))
    const client = createWorkspaceSessionClient({ storage: storage.api })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'stored' })
    const restored = client.getSnapshot().state
    const baseline = populatedWorkspaceSessionState()
    const defaults = createDefaultWorkspaceSessionState()
    for (const key of SESSION_SECTION_KEYS) {
      expect(restored[key], `${section} non deve cancellare ${key}`).toEqual(
        key === section ? defaults[key] : baseline[key],
      )
    }
    client.dispose()
  })

  it('isola l’editor quando il file attivo non è più presente tra i file aperti', async () => {
    const storedState = populatedWorkspaceSessionState()
    storedState.editor.activeFile = { source: 'workspace', id: 'src/missing.ts' }
    const storage = memoryStorage(storedSnapshot(storedState, 60))
    const client = createWorkspaceSessionClient({ storage: storage.api })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'stored' })
    expect(client.getSnapshot().state.editor).toEqual(createDefaultWorkspaceSessionState().editor)
    expect(client.getSnapshot().state.github).toEqual(populatedWorkspaceSessionState().github)
    expect(client.getSnapshot().state.database).toEqual(populatedWorkspaceSessionState().database)
    client.dispose()
  })

  it('ignora proprietà future compatibili a ogni livello senza perdere lo snapshot v1', async () => {
    const expected = populatedWorkspaceSessionState()
    const storedState = structuredClone(expected) as unknown as Record<string, unknown>
    storedState.futureWorkspaceFeature = { enabled: true }
    const navigation = storedState.navigation as Record<string, unknown>
    navigation.futureTabGroup = 'review'
    const editor = storedState.editor as Record<string, unknown>
    editor.previewState = { token: 'non deve raggiungere lo stato' }
    const openFiles = editor.openFiles as Array<Record<string, unknown>>
    openFiles[0]!.language = 'typescript'
    const fileViews = editor.fileViews as Array<Record<string, unknown>>
    ;(fileViews[0]!.selection as Record<string, unknown>).affinity = 'forward'
    const database = storedState.database as Record<string, unknown>
    database.results = [{ token: 'non deve raggiungere lo stato' }]
    const snapshot = {
      ...storedSnapshot(storedState as unknown as WorkspaceSessionState, 70),
      futureMetadata: { writer: 'v1-next' },
    } as unknown as WorkspaceSessionSnapshot
    const storage = memoryStorage(snapshot)
    const client = createWorkspaceSessionClient({ storage: storage.api })

    await expect(client.load()).resolves.toMatchObject({ applied: true, source: 'stored' })
    expect(client.getSnapshot().state).toEqual(expected)
    client.dispose()
  })

  it('coalesca patch entro 400 ms e salva soltanto la revisione più recente', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    const client = createWorkspaceSessionClient({ storage: storage.api, debounceMs: 400 })

    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'editor' } }))
    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'github' } }))
    client.patch((state) => ({ ...state, panels: { ...state.panels, editorExplorer: 344 } }))

    await vi.advanceTimersByTimeAsync(399)
    expect(storage.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()

    expect(storage.save).toHaveBeenCalledOnce()
    expect(storage.save.mock.calls[0]?.[0].state.navigation.section).toBe('github')
    expect(storage.save.mock.calls[0]?.[0].state.panels.editorExplorer).toBe(344)
    expect(client.getSnapshot().dirty).toBe(false)
    client.dispose()
  })

  it('serializza flush concorrenti e una risposta vecchia non sovrascrive lo stato nuovo', async () => {
    const writes: Array<{
      input: WorkspaceSessionWriteSnapshot
      result: ReturnType<typeof deferred<WorkspaceSessionSnapshot>>
    }> = []
    let activeWrites = 0
    let maximumActiveWrites = 0
    const storage: WorkspaceSessionStorage = {
      get: vi.fn(async () => storedSnapshot()),
      save: vi.fn((input) => {
        activeWrites += 1
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
        const result = deferred<WorkspaceSessionSnapshot>()
        writes.push({ input, result })
        return result.promise.finally(() => { activeWrites -= 1 })
      }),
    }
    const client = createWorkspaceSessionClient({ storage })

    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'editor' } }))
    const firstFlush = client.flush()
    expect(client.flush()).toBe(firstFlush)
    await vi.waitFor(() => expect(writes).toHaveLength(1))

    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'database' } }))
    const secondFlush = client.flush()
    expect(writes).toHaveLength(1)

    writes[0]?.result.resolve({ ...writes[0].input, updatedAt: 10 })
    await firstFlush
    expect(client.getSnapshot().state.navigation.section).toBe('database')
    expect(client.getSnapshot().dirty).toBe(true)
    await vi.waitFor(() => expect(writes).toHaveLength(2))

    writes[1]?.result.resolve({ ...writes[1].input, updatedAt: 20 })
    await secondFlush
    expect(maximumActiveWrites).toBe(1)
    expect(writes.map(({ input }) => input.state.navigation.section)).toEqual(['editor', 'database'])
    expect(client.getSnapshot()).toMatchObject({ dirty: false, saving: false, updatedAt: 20 })
    client.dispose()
  })

  it('flush esplicito anticipa il debounce, consente retry e dispose cancella write non avviate', async () => {
    vi.useFakeTimers()
    let attempt = 0
    const save = vi.fn(async (input: WorkspaceSessionWriteSnapshot) => {
      attempt += 1
      if (attempt === 1) throw new Error('temporaneamente non disponibile')
      return { ...input, updatedAt: attempt }
    })
    const storage: WorkspaceSessionStorage = { get: vi.fn(async () => storedSnapshot()), save }
    const client = createWorkspaceSessionClient({ storage })
    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'settings' } }))

    await expect(client.flush()).rejects.toThrow('temporaneamente non disponibile')
    expect(client.getSnapshot().dirty).toBe(true)
    await expect(client.flush()).resolves.toMatchObject({ updatedAt: 2 })
    expect(client.getSnapshot().dirty).toBe(false)

    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    client.patch((state) => ({ ...state, navigation: { ...state.navigation, section: 'ai' } }))
    client.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(() => client.replace(createDefaultWorkspaceSessionState())).toThrow(/chiuso/)
  })

  it('rispecchia allowlist e limiti senza accettare contenuti o identificatori effimeri', () => {
    const storage = memoryStorage()
    const client = createWorkspaceSessionClient({ storage: storage.api })
    const forbidden: Array<[keyof WorkspaceSessionState, string, unknown]> = [
      ['editor', 'dirtyText', 'contenuto non salvato'],
      ['terminal', 'output', 'TOKEN=segreto'],
      ['terminal', 'sessionId', 'sessione-effimera'],
      ['terminal', 'cwd', '/workspace/segreto'],
      ['terminal', 'title', 'deploy produzione'],
      ['database', 'sql', 'SELECT password FROM utenti'],
      ['database', 'results', [{ password: 'segreta' }]],
      ['database', 'transactionActive', true],
    ]

    for (const [section, key, value] of forbidden) {
      const state = createDefaultWorkspaceSessionState()
      ;(state[section] as unknown as Record<string, unknown>)[key] = value
      expect(normalizeWorkspaceSessionState(state), `${section}.${key}`).toBeNull()
      expect(() => client.replace(state), `${section}.${key}`).toThrow(/non valido/)
    }

    const secretRoot = createDefaultWorkspaceSessionState() as WorkspaceSessionState & { secrets: { token: string } }
    secretRoot.secrets = { token: 'non consentito' }
    expect(() => client.replace(secretRoot)).toThrow(/non valido/)

    const maximumTerminalMetadata = createDefaultWorkspaceSessionState()
    maximumTerminalMetadata.terminal.openSessionCount = 8
    maximumTerminalMetadata.terminal.activeSessionOrdinal = 7
    expect(normalizeWorkspaceSessionState(maximumTerminalMetadata)?.terminal).toMatchObject({
      openSessionCount: 8,
      activeSessionOrdinal: 7,
    })

    for (const [field, value] of [
      ['openSessionCount', -1],
      ['openSessionCount', 9],
      ['openSessionCount', 1.5],
      ['activeSessionOrdinal', -1],
      ['activeSessionOrdinal', 8],
      ['activeSessionOrdinal', 2.5],
    ] as const) {
      const invalidTerminal = createDefaultWorkspaceSessionState()
      ;(invalidTerminal.terminal as unknown as Record<string, unknown>)[field] = value
      expect(normalizeWorkspaceSessionState(invalidTerminal), `terminal.${field}=${value}`).toBeNull()
      expect(() => client.replace(invalidTerminal), `terminal.${field}=${value}`).toThrow(/non valido/)
    }

    const oversized = createDefaultWorkspaceSessionState()
    oversized.editor.expandedDirectoryIds = Array.from(
      { length: 1_000 },
      (_, index) => `packages/package-${index}/${'directory'.repeat(40)}`,
    )
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(MAX_WORKSPACE_SESSION_BYTES)
    expect(() => client.replace(oversized)).toThrow(/troppo grande/)
    expect(storage.save).not.toHaveBeenCalled()
    client.dispose()
  })
})
