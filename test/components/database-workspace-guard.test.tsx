// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in the isolated component test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseWorkspace } from '@/features/database'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

const connection: DatabaseConnection = {
  id: 'database-guard',
  name: 'Database Guard',
  driver: 'sqlite',
  sqlitePath: '/tmp/database-guard.sqlite',
  hasPassword: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function captureGuard() {
  let guard: WorkspaceChangeGuard | null = null
  return {
    onChange: vi.fn((next: WorkspaceChangeGuard | null) => { guard = next }),
    current() {
      if (!guard) throw new Error('Guardia Database non registrata.')
      return guard
    },
  }
}

function installDatabase(overrides: Partial<Window['vincodeLab']['database']> = {}) {
  const database = {
    listConnections: vi.fn(async () => [connection]),
    createConnection: vi.fn(async (input: DatabaseConnectionInput) => ({ ...connection, ...input, id: 'database-created', hasPassword: Boolean(input.password) })),
    updateConnection: vi.fn(async (_id: string, input: DatabaseConnectionInput) => ({ ...connection, ...input })),
    deleteConnection: vi.fn(),
    execute: vi.fn(async () => ({ columns: ['risultato'], rows: [{ risultato: 1 }], affectedRows: null, durationMs: 1, hasMore: false, resultBytes: 16 })),
    cancel: vi.fn(async () => ({ cancelled: true, mutative: false })),
    begin: vi.fn(async () => ({ active: true as const })),
    commit: vi.fn(async () => ({ active: false as const })),
    rollback: vi.fn(async () => ({ active: false as const })),
    inspectSchema: vi.fn(async () => ({ tables: [], routines: [] })),
    tableRows: vi.fn(),
    updateTableRows: vi.fn(),
    listSavedQueries: vi.fn(async () => []),
    saveQuery: vi.fn(async (input: { connectionId: string; name: string; sql: string }) => ({ id: 'query-saved', ...input, updatedAt: 1 })),
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
      preferences: {
        get: vi.fn(async () => ({ schema: [], global: {}, explicitGlobal: {}, overrides: {}, effective: {}, sources: {}, workspaceAvailable: true })),
      },
    } as unknown as Window['vincodeLab'],
  })
  return database
}

async function renderGuardedDatabase(capture = captureGuard()) {
  const result = render(<DatabaseWorkspace workspace="/tmp/database-guard" onWorkspaceGuardChange={capture.onChange} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Connetti' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Esegui' })).toBeEnabled())
  await waitFor(() => expect(capture.onChange).toHaveBeenCalledWith(expect.objectContaining({ hasUnsavedChanges: expect.any(Function) })))
  return { capture, ...result }
}

function sqlEditor(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.cm-editor')
  if (!element) throw new Error('Editor SQL non trovato.')
  const view = EditorView.findFromDOM(element)
  if (!view) throw new Error('EditorView SQL non trovata.')
  return view
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})

describe('guardia lavoro Database', () => {
  it('salva SQL rispetto alla baseline, conserva il draft al failure e recupera al retry', async () => {
    const saveQuery = vi.fn()
      .mockRejectedValueOnce(new Error('Archivio query non disponibile'))
      .mockResolvedValueOnce({ id: 'query-recovered', connectionId: connection.id, name: 'Query recuperata', sql: 'SELECT 2', updatedAt: 2 })
    const database = installDatabase({ saveQuery })
    const { capture, container, unmount } = await renderGuardedDatabase()
    const view = sqlEditor(container)

    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'SELECT 2' } }))
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await act(async () => { await expect(capture.current().saveAll()).rejects.toThrow('Archivio query non disponibile') })
    expect(view.state.doc.toString()).toBe('SELECT 2')
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await act(async () => { await capture.current().saveAll() })
    expect(database.saveQuery).toHaveBeenCalledTimes(2)
    expect(database.saveQuery).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: connection.id, sql: 'SELECT 2' }))
    expect(capture.current().hasUnsavedChanges()).toBe(false)

    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'SELECT 3' } }))
    await act(async () => { await capture.current().discardAll() })
    expect(view.state.doc.toString()).toBe('SELECT 2')
    expect(capture.current().hasUnsavedChanges()).toBe(false)

    unmount()
    expect(capture.onChange).toHaveBeenLastCalledWith(null)
  })

  it('preserva la bozza connessione dopo un salvataggio fallito e la chiude solo al retry riuscito', async () => {
    const updateConnection = vi.fn()
      .mockRejectedValueOnce(new Error('Connessione non scritta'))
      .mockResolvedValueOnce({ ...connection, name: 'Database modificato' })
    installDatabase({ updateConnection })
    const user = userEvent.setup()
    const { capture } = await renderGuardedDatabase()

    await user.click(screen.getByRole('button', { name: 'Modifica Database Guard' }))
    const name = screen.getByLabelText('Nome connessione')
    await user.clear(name)
    await user.type(name, 'Database modificato')
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await act(async () => { await expect(capture.current().saveAll()).rejects.toThrow('Connessione non scritta') })
    expect(screen.getByLabelText('Nome connessione')).toHaveValue('Database modificato')
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await act(async () => { await capture.current().saveAll() })
    expect(updateConnection).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog', { name: 'Modifica connessione' })).not.toBeInTheDocument()
    expect(capture.current().hasUnsavedChanges()).toBe(false)
  })

  it('rifiuta Save per griglia/transazione senza commit implicito e Discard recupera solo dopo rollback riuscito', async () => {
    const rollback = vi.fn()
      .mockRejectedValueOnce(new Error('Rollback temporaneamente fallito'))
      .mockResolvedValueOnce({ active: false as const })
    const database = installDatabase({
      inspectSchema: vi.fn(async () => ({
        tables: [{ name: 'users', primaryKey: ['id'], columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKeyPosition: 1, editable: false },
          { name: 'name', type: 'text', nullable: false, editable: true },
        ] }],
        routines: [],
      })),
      tableRows: vi.fn(async () => ({
        table: { name: 'users', primaryKey: ['id'], columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKeyPosition: 1, editable: false },
          { name: 'name', type: 'text', nullable: false, editable: true },
        ] },
        rows: [{ id: 1, name: 'Ada' }],
        offset: 0,
        hasMore: false,
        durationMs: 1,
        resultBytes: 16,
      })),
      rollback,
    })
    const user = userEvent.setup()
    const { capture } = await renderGuardedDatabase()

    await user.click(screen.getByRole('button', { name: 'Inizia' }))
    expect(await screen.findByText('Transazione attiva')).toBeInTheDocument()
    await expect(capture.current().saveAll()).rejects.toThrow('transazione Database attiva')
    expect(database.commit).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('treeitem', { name: 'users' }))
    await screen.findByRole('region', { name: 'Dati tabella users' })
    await user.click(screen.getByText('Ada'))
    const cell = await screen.findByRole('textbox', { name: 'name, riga 1' })
    await user.clear(cell)
    await user.type(cell, 'Grace{Enter}')
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await expect(capture.current().saveAll()).rejects.toThrow('griglia')
    expect(database.updateTableRows).not.toHaveBeenCalled()
    expect(database.commit).not.toHaveBeenCalled()

    await act(async () => { await expect(capture.current().discardAll()).rejects.toThrow('Rollback temporaneamente fallito') })
    expect(screen.getByText('Grace')).toBeInTheDocument()
    expect(capture.current().hasUnsavedChanges()).toBe(true)

    await act(async () => { await capture.current().discardAll() })
    expect(rollback).toHaveBeenCalledTimes(2)
    expect(database.commit).not.toHaveBeenCalled()
    await waitFor(() => expect(capture.current().hasUnsavedChanges()).toBe(false))
  })

  it('cancella la query prima del rollback e non applica né ripete operazioni mutative', async () => {
    const execution = deferred<DatabaseQueryResult>()
    const order: string[] = []
    const cancel = vi.fn(async () => { order.push('cancel'); return { cancelled: true, mutative: false } })
    const rollback = vi.fn(async () => { order.push('rollback'); return { active: false as const } })
    const execute = vi.fn<Window['vincodeLab']['database']['execute']>(() => execution.promise)
    const database = installDatabase({ execute, cancel, rollback })
    const user = userEvent.setup()
    const { capture } = await renderGuardedDatabase()

    await user.click(screen.getByRole('button', { name: 'Inizia' }))
    await user.click(screen.getByRole('button', { name: 'Esegui' }))
    await screen.findByRole('button', { name: 'Annulla' })

    await act(async () => { await capture.current().discardAll() })
    expect(order).toEqual(['cancel', 'rollback'])
    expect(cancel).toHaveBeenCalledWith(execute.mock.calls[0]![2].operationId)
    expect(database.commit).not.toHaveBeenCalled()
    expect(database.updateTableRows).not.toHaveBeenCalled()
    expect(capture.current().hasUnsavedChanges()).toBe(false)

    await act(async () => execution.resolve({ columns: ['late'], rows: [{ late: true }], affectedRows: null, durationMs: 1, hasMore: false, resultBytes: 16 }))
    expect(screen.queryByText('late')).not.toBeInTheDocument()
  })
})
