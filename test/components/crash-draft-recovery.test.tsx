// oxlint-disable-next-line typescript/triple-slash-reference -- include renderer bridge types in the isolated component tests.
/// <reference path="../../src/vincode-lab.d.ts" />

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseTableGrid, type DatabaseTableDraftGuard } from '@/components/database-table-grid'
import { DatabaseWorkspace } from '@/components/database-workspace'
import { clearVolatileDrafts, getVolatileDraftPersistenceState, hydrateVolatileDrafts, invalidateVolatileDraftHydration, readVolatileDraft, retryVolatileDraftPersistence, subscribeVolatileDraftPersistence, writeVolatileDraft } from '@/lib/volatile-draft-store'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

const workspace = '/workspace/crash-recovery'
const connection: DatabaseConnection = {
  id: 'connection-recovery',
  name: 'Database Recovery',
  driver: 'sqlite',
  sqlitePath: '/tmp/recovery.sqlite',
  hasPassword: false,
}

function draftBridge(snapshots: RendererDraftSnapshot[]) {
  return {
    list: vi.fn(async () => snapshots),
    write: vi.fn(),
    discard: vi.fn(),
  }
}

function installBridge(snapshots: RendererDraftSnapshot[] = []) {
  const volatileDrafts = draftBridge(snapshots)
  const database = {
    listConnections: vi.fn(async () => [connection]),
    createConnection: vi.fn(), updateConnection: vi.fn(), deleteConnection: vi.fn(),
    execute: vi.fn(), cancel: vi.fn(), begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
    inspectSchema: vi.fn(async () => ({ tables: [], routines: [] })),
    tableRows: vi.fn(), updateTableRows: vi.fn(),
    listSavedQueries: vi.fn(async () => []),
    saveQuery: vi.fn(async (input: { connectionId: string; name: string; sql: string }) => ({ id: 'saved-recovery', ...input, updatedAt: 1 })),
    updateSavedQuery: vi.fn(), deleteSavedQuery: vi.fn(), listHistory: vi.fn(async () => []), clearHistory: vi.fn(),
  } as unknown as Window['vincodeLab']['database']
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      volatileDrafts,
      database,
      preferences: { get: vi.fn(async () => ({ schema: [], global: {}, explicitGlobal: {}, overrides: {}, effective: {}, sources: {}, workspaceAvailable: true })) },
    } as unknown as Window['vincodeLab'],
  })
  return { database, volatileDrafts }
}

beforeEach(() => {
  clearVolatileDrafts()
  vi.restoreAllMocks()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})

describe('bozze recuperate dopo la perdita del renderer', () => {
  it('segnala la protezione crash degradata e la ripristina con acknowledgement', async () => {
    const identity = { scope: 'project-editor' as const, workspace, resource: 'src/retry.ts' }
    const { volatileDrafts } = installBridge()
    volatileDrafts.write
      .mockRejectedValueOnce(new Error('token=non-mostrare DRAFT_MIRROR_UNAVAILABLE'))
      .mockResolvedValueOnce({ stored: true })
    const states: boolean[] = []
    const unsubscribe = subscribeVolatileDraftPersistence((state) => states.push(state.degraded))

    writeVolatileDraft(identity, 'modifica non salvata', 'base')
    await waitFor(() => expect(getVolatileDraftPersistenceState().degraded).toBe(true))
    expect(readVolatileDraft(identity)).toEqual({ content: 'modifica non salvata', baseline: 'base' })
    expect(getVolatileDraftPersistenceState().failures[0]).toMatchObject({ identity, operation: 'write' })

    await retryVolatileDraftPersistence()
    expect(volatileDrafts.write).toHaveBeenCalledTimes(2)
    expect(getVolatileDraftPersistenceState()).toMatchObject({ degraded: false, failures: [] })
    expect(states).toEqual([false, true, false])
    unsubscribe()
  })

  it('reidrata dal registro main e continua a sincronizzare commit e modifiche', async () => {
    const identity = { scope: 'project-editor' as const, workspace, resource: 'src/app.ts' }
    const { volatileDrafts } = installBridge([{ ...identity, content: 'modifica', baseline: 'base' }])

    await hydrateVolatileDrafts()
    expect(readVolatileDraft(identity)).toEqual({ content: 'modifica', baseline: 'base' })

    writeVolatileDraft(identity, 'modifica 2', 'base')
    expect(volatileDrafts.write).toHaveBeenLastCalledWith({ ...identity, content: 'modifica 2', baseline: 'base' })
    writeVolatileDraft(identity, 'base', 'base')
    expect(volatileDrafts.discard).toHaveBeenCalledWith(identity)
  })

  it('ignora una risposta di reidratazione tardiva e conserva la bozza più recente in memoria', async () => {
    const identity = { scope: 'project-editor' as const, workspace, resource: 'src/late.ts' }
    const { volatileDrafts } = installBridge()
    let resolveFirst!: (snapshots: RendererDraftSnapshot[]) => void
    volatileDrafts.list
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce([{ ...identity, content: 'snapshot retry', baseline: 'base' }])

    const firstHydration = hydrateVolatileDrafts()
    writeVolatileDraft(identity, 'bozza più recente', 'base')
    invalidateVolatileDraftHydration()
    const retryHydration = hydrateVolatileDrafts()

    await retryHydration
    resolveFirst([{ ...identity, content: 'snapshot tardivo', baseline: 'base' }])
    await firstHydration

    expect(readVolatileDraft(identity)).toEqual({ content: 'bozza più recente', baseline: 'base' })
    expect(volatileDrafts.list).toHaveBeenCalledTimes(2)
  })

  it('ripristina SQL e bozza connessione senza scriverli su persistenza workspace', async () => {
    const sqlIdentity = { scope: 'database-sql' as const, workspace, resource: connection.id }
    const connectionIdentity = { scope: 'database-connection' as const, workspace, resource: connection.id }
    const baselineConnection = { name: connection.name, driver: 'sqlite', sqlitePath: connection.sqlitePath, password: '', hasPassword: false }
    const changedConnection = { ...baselineConnection, name: 'Database non salvato' }
    const { volatileDrafts } = installBridge([
      { ...sqlIdentity, content: 'SELECT 42 AS recuperato', baseline: 'SELECT 1 AS risultato' },
      { ...connectionIdentity, content: JSON.stringify(changedConnection), baseline: JSON.stringify(baselineConnection) },
    ])
    await hydrateVolatileDrafts()
    let guard: WorkspaceChangeGuard | null = null
    const currentGuard = () => {
      if (!guard) throw new Error('Guardia workspace non registrata.')
      return guard
    }
    const rendered = render(<DatabaseWorkspace workspace={workspace} onWorkspaceGuardChange={(next) => { guard = next }} />)

    await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.cm-editor')
      const view = element ? EditorView.findFromDOM(element) : null
      expect(view?.state.doc.toString()).toBe('SELECT 42 AS recuperato')
    })
    expect(await screen.findByRole('dialog', { name: 'Modifica connessione' })).toBeVisible()
    expect(screen.getByLabelText('Nome connessione')).toHaveValue('Database non salvato')
    expect(currentGuard().hasUnsavedChanges()).toBe(true)
    expect(volatileDrafts.list).toHaveBeenCalledTimes(1)
  })

  it('ripristina le celle modificate e le elimina soltanto su discard esplicito', async () => {
    const identity = { scope: 'database-grid' as const, workspace, resource: JSON.stringify([connection.id, 'users']) }
    const rowKey = JSON.stringify([['id', 1]])
    const persistedDrafts = { [rowKey]: { key: { id: 1 }, values: { name: 'Grace' } } }
    const { volatileDrafts } = installBridge([{ ...identity, content: JSON.stringify(persistedDrafts), baseline: '{}' }])
    await hydrateVolatileDrafts()
    let guard: DatabaseTableDraftGuard | null = null
    const currentGuard = () => {
      if (!guard) throw new Error('Guardia griglia non registrata.')
      return guard
    }
    const user = userEvent.setup()
    render(<DatabaseTableGrid
      draftIdentity={identity}
      filter=""
      loading={false}
      onDraftGuardChange={(next) => { guard = next }}
      onFilterChange={vi.fn()}
      onLoadMore={vi.fn()}
      onRequestSave={vi.fn()}
      page={{
        table: { name: 'users', primaryKey: ['id'], columns: [
          { name: 'id', type: 'integer', nullable: false, primaryKeyPosition: 1, editable: false },
          { name: 'name', type: 'text', nullable: false, editable: true },
        ] },
        rows: [{ id: 1, name: 'Ada' }], offset: 0, hasMore: false, durationMs: 1, resultBytes: 16,
      }}
      transactionActive
    />)

    expect(await screen.findByText('Grace')).toBeVisible()
    expect(currentGuard().hasChanges()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(currentGuard().hasChanges()).toBe(false)
    expect(volatileDrafts.discard).toHaveBeenCalledWith(identity)
  })

  it('non applica né elimina automaticamente una bozza celle non valida', async () => {
    const identity = { scope: 'database-grid' as const, workspace, resource: JSON.stringify([connection.id, 'users']) }
    const { volatileDrafts } = installBridge([{ ...identity, content: '{bozza-non-valida', baseline: '{}' }])
    await hydrateVolatileDrafts()
    const user = userEvent.setup()
    render(<DatabaseTableGrid
      draftIdentity={identity}
      filter=""
      loading={false}
      onFilterChange={vi.fn()}
      onLoadMore={vi.fn()}
      onRequestSave={vi.fn()}
      page={{
        table: { name: 'users', primaryKey: ['id'], columns: [{ name: 'id', type: 'integer', nullable: false, primaryKeyPosition: 1, editable: false }] },
        rows: [{ id: 1 }], offset: 0, hasMore: false, durationMs: 1, resultBytes: 8,
      }}
      transactionActive
    />)

    const notice = (await screen.findByRole('heading', { name: 'Modifiche celle non ripristinate' })).closest('[role="status"]') as HTMLElement
    expect(readVolatileDraft(identity)).not.toBeNull()
    expect(volatileDrafts.discard).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Rimuovi bozza' }))
    expect(readVolatileDraft(identity)).toBeNull()
    expect(volatileDrafts.discard).toHaveBeenCalledWith(identity)
    expect(notice).not.toBeInTheDocument()
  })

  it('mantiene una bozza connessione non leggibile fino alla rimozione esplicita', async () => {
    const identity = { scope: 'database-connection' as const, workspace, resource: connection.id }
    const { volatileDrafts } = installBridge([{ ...identity, content: '{bozza-non-valida', baseline: '{}' }])
    await hydrateVolatileDrafts()
    const user = userEvent.setup()
    render(<DatabaseWorkspace workspace={workspace} />)

    const notice = (await screen.findByRole('heading', { name: 'Bozza connessione non leggibile' })).closest('[role="status"]') as HTMLElement
    expect(readVolatileDraft(identity)).not.toBeNull()
    expect(volatileDrafts.discard).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Rimuovi bozza' }))
    expect(readVolatileDraft(identity)).toBeNull()
    expect(volatileDrafts.discard).toHaveBeenCalledWith(identity)
    expect(notice).not.toBeInTheDocument()
  })
})
