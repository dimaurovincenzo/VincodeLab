// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection, DatabaseRoutine } from '@/bridge'

const formatSqlMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/database/services/sql-format', () => ({
  createSqlFormatChange: formatSqlMock,
}))

import { DatabaseWorkspace } from '@/features/database'

const initialSql = 'SELECT 1 AS risultato'

function installVincodeLab(connection: DatabaseConnection = {
    id: 'sqlite-local',
    name: 'Database locale',
    driver: 'sqlite',
    sqlitePath: '/tmp/database.sqlite',
    hasPassword: false,
  }) {
  const updateConnection = vi.fn(async () => connection)

  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      database: {
        listConnections: vi.fn(async () => [connection]),
        updateConnection,
        connect: vi.fn(async () => ({ connected: true as const })),
        listSavedQueries: vi.fn(async () => []),
        listHistory: vi.fn(async () => []),
        inspectSchema: vi.fn(async () => ({ tables: [], routines: [] })),
        inspectRoutine: vi.fn(async (_connectionId: string, routineName: string, kind: DatabaseRoutine['kind']) => ({ name: routineName, kind, definition: null })),
      },
      preferences: {
        get: vi.fn(async () => ({
          schema: [],
          global: {},
          explicitGlobal: {},
          overrides: {},
          effective: {},
          sources: {},
          workspaceAvailable: true,
        })),
      },
    } as unknown as Window['vincodeLab'],
  })
  return { updateConnection }
}

describe('formattazione SQL del workspace Database', () => {
  beforeEach(() => {
    formatSqlMock.mockReset()
    installVincodeLab()
  })

  it('scarta il risultato differito quando il documento viene modificato durante la formattazione', async () => {
    let resolveFormat!: (change: { from: number; to: number; insert: string; anchor: number; head: number }) => void
    formatSqlMock.mockReturnValueOnce(new Promise((resolve) => { resolveFormat = resolve }))
    const user = userEvent.setup()
    const { container } = render(<DatabaseWorkspace workspace="/tmp/database-format-test" />)

    const formatButton = await screen.findByRole('button', { name: 'Formatta' })
    await waitFor(() => expect(formatButton).toBeEnabled())
    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.cm-editor')
      expect(element).not.toBeNull()
      return element!
    })
    const view = EditorView.findFromDOM(editorElement)
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    expect(view.state.doc.toString()).toBe(initialSql)

    await user.click(formatButton)
    await waitFor(() => expect(formatSqlMock).toHaveBeenCalledWith(initialSql, { from: 0, to: 0 }, 'sqlite'))

    const recentSql = 'SELECT 2 AS modifica_recente'
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: recentSql } })
    })

    resolveFormat({
      from: 0,
      to: initialSql.length,
      insert: 'SELECT\n  1 AS risultato',
      anchor: 0,
      head: 0,
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Formatta' })).toBeEnabled())
    expect(view.state.doc.toString()).toBe(recentSql)
  })

  it('non riceve la password salvata e invia un campo vuoto per conservarla in modifica', async () => {
    const { updateConnection } = installVincodeLab({
      id: 'remote-production',
      name: 'Produzione',
      driver: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'app',
      user: 'developer',
      hasPassword: true,
    })
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace="/tmp/database-secret-test" />)

    await user.click(await screen.findByRole('button', { name: 'Modifica Produzione' }))
    const password = screen.getByLabelText('Password')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('placeholder', 'Lascia vuoto per mantenere la password')
    expect(password).not.toBeRequired()

    await user.click(screen.getByRole('button', { name: 'Salva modifiche' }))
    await waitFor(() => expect(updateConnection).toHaveBeenCalledWith('remote-production', expect.objectContaining({ password: '' })))
  })
})
