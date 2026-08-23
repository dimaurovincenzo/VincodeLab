// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseWorkspace } from '@/components/database-workspace'

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
    execute: vi.fn(async () => ({ columns: ['risultato'], rows: [{ risultato: 1 }], affectedRows: null, durationMs: 1, hasMore: false, resultBytes: 16 })),
    cancel: vi.fn(async () => ({ cancelled: false, mutative: false })),
    begin: vi.fn(async () => ({ active: true as const })),
    commit: vi.fn(async () => ({ active: false as const })),
    rollback: vi.fn(async () => ({ active: false as const })),
    inspectSchema: vi.fn(async () => ({ tables: [], routines: [] })),
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

describe('recovery del workspace Database', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  it('svuota subito le risorse della connessione precedente e blocca azioni finché il retry riesce', async () => {
    let databaseBAvailable = false
    const listSavedQueries = vi.fn(async (connectionId: string) => {
      if (connectionId === 'database-a') return [{ id: 'query-a', connectionId, name: 'Query A', sql: 'DELETE FROM production', updatedAt: Date.now() }]
      if (!databaseBAvailable) throw new Error('database B non raggiungibile')
      return []
    })
    installDatabase({
      listSavedQueries,
      listHistory: vi.fn(async (connectionId: string) => {
        if (connectionId === 'database-b' && !databaseBAvailable) throw new Error('database B non raggiungibile')
        return []
      }),
      inspectSchema: vi.fn(async (connectionId: string) => {
        if (connectionId === 'database-b' && !databaseBAvailable) throw new Error('database B non raggiungibile')
        return { tables: [], routines: [] }
      }),
    })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-recovery" />)

    await user.click(await screen.findByRole('tab', { name: /Query/ }))
    expect(await screen.findByRole('button', { name: 'Query A' })).toBeVisible()
    const selector = screen.getByRole('combobox', { name: 'Connessione database attiva' })
    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: /Database B/ }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Query A' })).not.toBeInTheDocument())
    expect(await screen.findByRole('alert')).toHaveTextContent('Connessione database non pronta')
    expect(screen.getByRole('button', { name: 'Esegui' })).toBeDisabled()

    databaseBAvailable = true
    await user.click(screen.getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Esegui' })).toBeEnabled())
    expect(listSavedQueries).toHaveBeenCalledWith('database-b')
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
