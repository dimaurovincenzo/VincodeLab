// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseWorkspace } from '@/features/database'

const connections: DatabaseConnection[] = [
  { id: 'database-a', name: 'Database A', driver: 'sqlite', sqlitePath: '/tmp/a.sqlite', hasPassword: false },
  { id: 'database-b', name: 'Database B', driver: 'sqlite', sqlitePath: '/tmp/b.sqlite', hasPassword: false },
]

function preferencesSnapshot() {
  return {
    schema: [], global: {}, explicitGlobal: {}, overrides: {}, effective: {}, sources: {}, workspaceAvailable: true,
  }
}

function installDatabase(overrides: Partial<Window['vincodeLab']['database']> = {}) {
  const database = {
    listConnections: vi.fn(async () => connections),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    connect: vi.fn(async () => ({ connected: true as const })),
    disconnect: vi.fn(async () => ({ disconnected: true as const })),
    execute: vi.fn(async () => ({ columns: ['risultato'], rows: [{ risultato: 1 }], affectedRows: null, durationMs: 1, hasMore: false, resultBytes: 16 })),
    cancel: vi.fn(async () => ({ cancelled: false, mutative: false })),
    begin: vi.fn(async () => ({ active: true as const })),
    commit: vi.fn(async () => ({ active: false as const })),
    rollback: vi.fn(async () => ({ active: false as const })),
    inspectSchema: vi.fn(async () => ({ tables: [], routines: [] })),
    inspectRoutine: vi.fn(async (_connectionId: string, routineName: string, kind: DatabaseRoutine['kind']) => ({ name: routineName, kind, definition: null })),
    tableRows: vi.fn(),
    updateTableRows: vi.fn(),
    listSavedQueries: vi.fn(async () => []),
    saveQuery: vi.fn(),
    updateSavedQuery: vi.fn(),
    deleteSavedQuery: vi.fn(),
    listHistory: vi.fn(async () => []),
    clearHistory: vi.fn(),
    ...overrides,
  } as unknown as Window['vincodeLab']['database']
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      database,
      preferences: { get: vi.fn(async () => preferencesSnapshot()) },
    } as unknown as Window['vincodeLab'],
  })
  return database
}

function sqlEditor(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.cm-editor')
  if (!element) throw new Error('Editor SQL non trovato.')
  const view = EditorView.findFromDOM(element)
  if (!view) throw new Error('EditorView SQL non trovata.')
  return view
}

async function connectDatabase(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Connetti' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esegui' })).toBeEnabled())
}

describe('recovery del workspace Database', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  it('svuota subito le risorse della connessione precedente e blocca azioni finché il retry riesce', async () => {
    let databaseBAvailable = false
    const listSavedQueries = vi.fn(async (connectionId: string) => {
      if (connectionId === 'database-a') return [{ id: 'query-a', connectionId, name: 'Query A', sql: 'DELETE FROM production', updatedAt: Date.now() }]
      return []
    })
    installDatabase({
      listSavedQueries,
      listHistory: vi.fn(async (connectionId: string) => {
        void connectionId
        return []
      }),
      connect: vi.fn(async (connectionId: string) => {
        if (connectionId === 'database-b' && !databaseBAvailable) throw new Error('database B non raggiungibile')
        return { connected: true as const }
      }),
    })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-recovery" />)

    await screen.findByRole('button', { name: 'Connetti' })
    expect(window.vincodeLab.database.inspectSchema).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('tab', { name: /Query/ }))
    expect(await screen.findByRole('button', { name: 'Query A' })).toBeVisible()
    const selector = screen.getByRole('combobox', { name: 'Connessione database attiva' })
    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: /Database B/ }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Query A' })).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.vincodeLab.database.inspectSchema).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Connetti' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Connessione database non pronta')
    expect(screen.getByRole('button', { name: 'Esegui' })).toBeDisabled()

    databaseBAvailable = true
    await user.click(screen.getByRole('button', { name: 'Riprova connessione' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Esegui' })).toBeEnabled())
    expect(listSavedQueries).toHaveBeenCalledWith('database-b')
  })

  it('non apre il database all’ingresso e carica automaticamente tutte le pagine dopo Connetti', async () => {
    const inspectSchema = vi.fn()
      .mockResolvedValueOnce({
        tables: [{ name: 'prima_tabella', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: true,
        nextOffset: 40,
        totalResources: 2,
      })
      .mockResolvedValueOnce({
        tables: [{ name: 'ultima_tabella', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: false,
        nextOffset: null,
        totalResources: 2,
      })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), inspectSchema })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-progressive-schema" />)

    await screen.findByRole('button', { name: 'Connetti' })
    expect(inspectSchema).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Connetti' }))
    expect(await screen.findByRole('treeitem', { name: 'prima_tabella' })).toBeVisible()
    expect(await screen.findByRole('treeitem', { name: 'ultima_tabella' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'prima_tabella' })).toBeVisible()
    expect(inspectSchema).toHaveBeenNthCalledWith(1, 'database-a', { offset: 0, limit: 40 })
    expect(inspectSchema).toHaveBeenLastCalledWith('database-a', { offset: 40, limit: 40 })
    expect(inspectSchema).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Schema completo')).toBeVisible()
    expect(screen.getByText('2 / 2 risorse')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Carica altre risorse' })).not.toBeInTheDocument()
  })

  it('carica colonne e chiave primaria soltanto quando viene aperta una tabella', async () => {
    const tableRows = vi.fn(async () => ({
      table: {
        name: 'public.wide_table',
        columns: [{ name: 'payload_marker', type: 'text', nullable: false, primaryKeyPosition: 1, editable: true }],
        primaryKey: ['payload_marker'],
      },
      rows: [{ payload_marker: 'demo' }],
      offset: 0,
      hasMore: false,
      durationMs: 1,
      resultBytes: 16,
    }))
    installDatabase({
      listConnections: vi.fn(async () => [connections[0]]),
      inspectSchema: vi.fn(async () => ({
        tables: [{ name: 'public.wide_table', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: false,
      })),
      tableRows,
    })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-lazy-table-columns" />)

    await connectDatabase(user)
    expect(tableRows).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'public: espandi o comprimi' }))
    await user.click(await screen.findByRole('treeitem', { name: 'wide_table' }))
    await waitFor(() => expect(tableRows).toHaveBeenCalledWith('database-a', 'public.wide_table', { filter: '', limit: 500 }))

    await user.type(screen.getByRole('textbox', { name: 'Cerca nello schema' }), 'payload_marker')
    expect(await screen.findByRole('treeitem', { name: 'wide_table' })).toBeVisible()
  })

  it('espone Disconnetti dopo la connessione e chiude davvero la sessione mantenendo il profilo selezionato', async () => {
    const database = installDatabase({ listConnections: vi.fn(async () => [connections[0]]) })
    const user = userEvent.setup()
    const { container } = render(<DatabaseWorkspace workspace="/tmp/database-explicit-disconnect" />)

    await connectDatabase(user)
    const view = sqlEditor(container)
    const draft = 'SELECT * FROM dati_importanti'
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: draft } }))
    await user.click(screen.getByRole('button', { name: 'Disconnetti' }))

    await waitFor(() => expect(database.disconnect).toHaveBeenCalledWith('database-a'))
    expect(await screen.findByRole('button', { name: 'Connetti' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Esegui' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Connessione database attiva' })).toBeEnabled()
    expect(screen.getByText('“Database A” è selezionata ma non connessa.')).toBeVisible()
    expect(sqlEditor(container).state.doc.toString()).toBe(draft)
  })

  it('interrompe il caricamento progressivo quando l’utente si disconnette e ignora le pagine tardive', async () => {
    let resolveSecondPage!: (page: DatabaseSchemaPage) => void
    const secondPage = new Promise<DatabaseSchemaPage>((resolve) => { resolveSecondPage = resolve })
    const inspectSchema = vi.fn()
      .mockResolvedValueOnce({
        tables: [{ name: 'prima_tabella', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: true,
        nextOffset: 40,
        totalResources: 2,
      })
      .mockReturnValueOnce(secondPage)
    const database = installDatabase({ listConnections: vi.fn(async () => [connections[0]]), inspectSchema })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-disconnect-during-schema" />)

    await user.click(await screen.findByRole('button', { name: 'Connetti' }))
    expect(await screen.findByRole('treeitem', { name: 'prima_tabella' })).toBeVisible()
    expect(screen.queryByText('Connessione al database')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnetti' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Disconnetti' }))

    await waitFor(() => expect(database.disconnect).toHaveBeenCalledWith('database-a'))
    expect(await screen.findByRole('button', { name: 'Connetti' })).toBeVisible()

    await act(async () => {
      resolveSecondPage({
        tables: [{ name: 'pagina_tardiva', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: false,
        nextOffset: null,
        totalResources: 2,
      })
      await secondPage
    })

    expect(screen.queryByRole('treeitem', { name: 'pagina_tardiva' })).not.toBeInTheDocument()
    expect(screen.getByText('“Database A” è selezionata ma non connessa.')).toBeVisible()
  })

  it('mantiene una recovery di disconnessione senza riabilitare query o cambio profilo', async () => {
    const disconnect = vi.fn()
      .mockRejectedValueOnce(new Error('cleanup non confermato'))
      .mockResolvedValueOnce({ disconnected: true as const })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), disconnect })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-disconnect-recovery" />)

    await connectDatabase(user)
    await user.click(screen.getByRole('button', { name: 'Disconnetti' }))

    expect(await screen.findByRole('heading', { name: 'Disconnessione database non confermata' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Esegui' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Connessione database attiva' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disconnetti' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Riprova disconnessione' }))

    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: 'Connetti' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Connessione database attiva' })).toBeEnabled()
  })

  it('riprende dal punto interrotto e completa automaticamente le risorse rimanenti', async () => {
    const inspectSchema = vi.fn()
      .mockResolvedValueOnce({
        tables: [{ name: 'prima_tabella', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: true,
        nextOffset: 40,
        totalResources: 2,
      })
      .mockRejectedValueOnce(new Error('connessione interrotta durante il catalogo'))
      .mockResolvedValueOnce({
        tables: [{ name: 'ultima_tabella', columns: [], primaryKey: [] }],
        routines: [],
        hasMore: false,
        nextOffset: null,
        totalResources: 2,
      })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), inspectSchema })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-resume-schema" />)

    await user.click(await screen.findByRole('button', { name: 'Connetti' }))
    expect(await screen.findByRole('heading', { name: 'Caricamento schema interrotto' })).toBeVisible()
    expect(screen.getByRole('treeitem', { name: 'prima_tabella' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Riprova caricamento' }))

    expect(await screen.findByRole('treeitem', { name: 'ultima_tabella' })).toBeVisible()
    expect(inspectSchema).toHaveBeenNthCalledWith(3, 'database-a', { offset: 40, limit: 40 })
    expect(screen.getByText('Schema completo')).toBeVisible()
    expect(screen.getByText('2 / 2 risorse')).toBeVisible()
  })

  it('mantiene la connessione utilizzabile quando il catalogo è troppo grande per essere materializzato', async () => {
    const inspectSchema = vi.fn(async () => {
      throw Object.assign(new Error('catalogo oltre budget'), { code: 'DATABASE_RESULT_TOO_LARGE' })
    })
    const database = installDatabase({ listConnections: vi.fn(async () => [connections[0]]), inspectSchema })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-large-catalog" />)

    expect(database.connect).not.toHaveBeenCalled()
    expect(inspectSchema).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Connetti' }))

    expect(await screen.findByRole('heading', { name: 'Schema database non caricato' })).toBeVisible()
    expect(screen.getByText(/La connessione è attiva/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Esegui' })).toBeEnabled()
    expect(database.connect).toHaveBeenCalledWith('database-a')
    expect(database.connect).toHaveBeenCalledTimes(2)
  })

  it('carica la definizione di una routine soltanto quando l’utente la apre', async () => {
    const inspectRoutine = vi.fn(async () => ({
      name: 'public.refresh_cache',
      kind: 'procedure' as const,
      definition: 'CREATE PROCEDURE public.refresh_cache() LANGUAGE SQL AS $$ SELECT 1 $$;',
      definitionTruncated: true,
    }))
    installDatabase({
      listConnections: vi.fn(async () => [connections[0]]),
      inspectSchema: vi.fn(async () => ({
        tables: [],
        routines: [{ name: 'public.refresh_cache', kind: 'procedure' as const, definition: null }],
      })),
      inspectRoutine,
    })
    const user = userEvent.setup()
    const { container } = render(<DatabaseWorkspace workspace="/tmp/database-lazy-routine" />)

    expect(inspectRoutine).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Connetti' }))
    expect(inspectRoutine).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Procedure archiviate: espandi o comprimi' }))
    await user.click(await screen.findByRole('treeitem', { name: 'public.refresh_cache' }))

    await waitFor(() => expect(inspectRoutine).toHaveBeenCalledWith('database-a', 'public.refresh_cache', 'procedure'))
    await waitFor(() => expect(sqlEditor(container).state.doc.toString()).toContain('Definizione parziale'))
    expect(sqlEditor(container).state.doc.toString()).toContain('CREATE PROCEDURE')
  })

  it('propaga cancel al backend e consente una nuova query senza rimontare la vista', async () => {
    let rejectFirst!: (error: Error) => void
    const firstExecution = new Promise<DatabaseQueryResult>((_resolve, reject) => { rejectFirst = reject })
    const execute = vi.fn()
      .mockReturnValueOnce(firstExecution)
      .mockResolvedValueOnce({ columns: ['risultato'], rows: [{ risultato: 2 }], affectedRows: null, durationMs: 1, hasMore: false, resultBytes: 16 })
    const cancel = vi.fn(async () => {
      rejectFirst(new DOMException('annullata', 'AbortError'))
      return { cancelled: true, mutative: false }
    })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), execute, cancel })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-cancel" />)

    await connectDatabase(user)
    const run = await screen.findByRole('button', { name: 'Esegui' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    const cancelButton = await screen.findByRole('button', { name: 'Annulla' })
    const operationId = execute.mock.calls[0][2].operationId as string
    expect(operationId).toMatch(/^[0-9a-f-]{36}$/iu)

    await user.click(cancelButton)
    await waitFor(() => expect(run).toBeEnabled())
    expect(cancel).toHaveBeenCalledWith(operationId)

    await user.click(run)
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Editor SQL')).toBeInTheDocument()
  })

  it('mantiene la query attiva e offre un nuovo annullamento quando il primo tentativo fallisce', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let rejectExecution!: (error: Error) => void
    const execution = new Promise<DatabaseQueryResult>((_resolve, reject) => { rejectExecution = reject })
    const execute = vi.fn(() => execution)
    let cancelAttempts = 0
    const cancel = vi.fn(async () => {
      cancelAttempts += 1
      if (cancelAttempts === 1) throw new Error('token=non-mostrare annullamento non disponibile')
      rejectExecution(new DOMException('annullata', 'AbortError'))
      return { cancelled: true, mutative: false }
    })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), execute, cancel })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-cancel-retry" />)

    await connectDatabase(user)
    const run = await screen.findByRole('button', { name: 'Esegui' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await user.click(await screen.findByRole('button', { name: 'Annulla' }))

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent('Query non annullata')
    expect(failure).toHaveTextContent(/Riferimento ERR-[A-F0-9]{6}/)
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()
    expect(run).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Annulla di nuovo' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(run).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Editor SQL')).toBeInTheDocument()
  })

  it('possiede la rejection di cancel quando la vista viene smontata con una query attiva', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const execute = vi.fn(() => new Promise<DatabaseQueryResult>(() => undefined))
    const cancel = vi.fn(async () => { throw new Error('cancel cleanup fallito token=privato') })
    installDatabase({ listConnections: vi.fn(async () => [connections[0]]), execute, cancel })
    const user = userEvent.setup()
    const { unmount } = render(<DatabaseWorkspace workspace="/tmp/database-cancel-cleanup" />)

    await connectDatabase(user)
    const run = await screen.findByRole('button', { name: 'Esegui' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    unmount()

    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(consoleError.mock.calls.some(([value]) => (
      typeof value === 'string' && value.includes('cancel-query-on-unmount')
    ))).toBe(true))
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('privato')
  })

  it('mantiene riuscita una query mutativa quando fallisce la cronologia e riprova soltanto il refresh', async () => {
    const historyEntry: DatabaseHistoryEntry = {
      id: 'history-delete',
      connectionId: 'database-a',
      sql: 'DELETE FROM users WHERE id = 7',
      durationMs: 2,
      affectedRows: 1,
      executedAt: Date.now(),
    }
    const listHistory = vi.fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('cronologia temporaneamente non disponibile'))
      .mockResolvedValueOnce([historyEntry])
    const execute = vi.fn(async () => ({ columns: ['risultato'], rows: [{ risultato: 'eliminato' }], affectedRows: 1, durationMs: 2, hasMore: false, resultBytes: 24 }))
    const database = installDatabase({ listConnections: vi.fn(async () => [connections[0]]), execute, listHistory })
    const user = userEvent.setup()
    const { container } = render(<DatabaseWorkspace workspace="/tmp/database-history-recovery" />)

    await connectDatabase(user)
    const run = await screen.findByRole('button', { name: 'Esegui' })
    await waitFor(() => expect(run).toBeEnabled())
    act(() => {
      const view = sqlEditor(container)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: historyEntry.sql } })
    })

    await user.click(run)
    await user.click(await screen.findByRole('button', { name: 'Esegui query' }))

    expect(await screen.findByRole('heading', { name: 'Query completata, cronologia non aggiornata' })).toBeVisible()
    expect(screen.getByText(/1 righe · 2 ms · 1 coinvolte/)).toBeVisible()
    expect(screen.queryByText(/Query non eseguita/)).not.toBeInTheDocument()
    expect(database.execute).toHaveBeenCalledTimes(1)
    expect(database.listHistory).toHaveBeenCalledTimes(2)

    await user.click(screen.getByRole('button', { name: 'Aggiorna cronologia' }))

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Query completata, cronologia non aggiornata' })).not.toBeInTheDocument())
    expect(database.execute).toHaveBeenCalledTimes(1)
    expect(database.listHistory).toHaveBeenCalledTimes(3)
    await user.click(screen.getByRole('tab', { name: /Cronologia 1/ }))
    expect(await screen.findByRole('button', { name: historyEntry.sql })).toBeVisible()
  })

  it('non invita a rieseguire una query quando il backend non salva la cronologia', async () => {
    const execute = vi.fn(async () => ({
      columns: ['risultato'], rows: [{ risultato: 'eliminato' }], affectedRows: 1,
      durationMs: 2, hasMore: false, historyRecorded: false, resultBytes: 24,
    }))
    const database = installDatabase({ listConnections: vi.fn(async () => [connections[0]]), execute })
    const user = userEvent.setup()
    const { container } = render(<DatabaseWorkspace workspace="/tmp/database-history-write" />)

    await connectDatabase(user)
    const run = await screen.findByRole('button', { name: 'Esegui' })
    await waitFor(() => expect(run).toBeEnabled())
    act(() => {
      const view = sqlEditor(container)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'DELETE FROM users WHERE id = 8' } })
    })
    await user.click(run)
    await user.click(await screen.findByRole('button', { name: 'Esegui query' }))

    expect(await screen.findByRole('heading', { name: 'Query completata, cronologia non salvata' })).toBeVisible()
    expect(screen.getByText(/Non rieseguire la query/u)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copia query' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Riprova/u })).not.toBeInTheDocument()
    expect(database.execute).toHaveBeenCalledTimes(1)
  })
})
