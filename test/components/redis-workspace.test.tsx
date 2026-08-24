import { act, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RedisWorkspace } from '@/features/redis'
import { toast } from '@/components/ui'
import type { RedisApi, RedisPayloadSearchProgress, RedisPayloadSearchResult } from '@/features/redis'

const connection = { id: 'redis-local', name: 'Redis locale', mode: 'standalone' as const, host: '127.0.0.1', port: 6379, database: 0, hasPassword: false }
const keyRef = (key: string) => btoa(key)

async function connectSelected(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: `Connetti a ${connection.name}` }))
}

function installRedis(overrides: Partial<RedisApi> = {}) {
  let progressListener: ((progress: RedisPayloadSearchProgress) => void) | null = null
  let contextActionListener: ((action: { command: string; contextId: string | null; contextKind: string }) => void) | null = null
  const api = {
    listConnections: vi.fn(async () => [connection]),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    deleteConnection: vi.fn(),
    testConnection: vi.fn(async () => ({ ok: true, latencyMs: 2 })),
    scanKeys: vi.fn(async () => ({ cursor: '0', keys: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'string' as const, ttlMs: null }], scanned: 1, hasMore: false })),
    readKey: vi.fn(async () => ({ key: 'user:1', keyRef: keyRef('user:1'), type: 'string' as const, ttlMs: null, encoding: 'embstr', value: 'Ada Lovelace' })),
    reconnect: vi.fn(async () => ({ reconnected: true as const })),
    searchPayloads: vi.fn(async (_id: string, input: { operationId: string }) => ({ operationId: input.operationId, scanned: 1, matches: [], truncated: false, cancelled: false })),
    cancel: vi.fn(async () => ({ cancelled: true })),
    onSearchProgress: vi.fn((listener: (progress: RedisPayloadSearchProgress) => void) => { progressListener = listener; return () => { progressListener = null } }),
    ...overrides,
  } as unknown as RedisApi
  Object.defineProperty(window, 'vincodeLab', { configurable: true, value: {
    redis: api,
    contextMenu: {
      onAction: vi.fn((listener: (action: { command: string; contextId: string | null; contextKind: string }) => void) => { contextActionListener = listener; return () => { if (contextActionListener === listener) contextActionListener = null } }),
    },
  } })
  return {
    api,
    dispatchContextAction: (command: string, contextId: string | null) => act(() => contextActionListener?.({ command, contextId, contextKind: 'redis-key' })),
    emitProgress: (progress: RedisPayloadSearchProgress) => progressListener?.(progress),
  }
}

describe('Redis workspace read-only', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  })

  it('resta passivo con la selezione persistita finché l’utente non sceglie Connetti', async () => {
    const harness = installRedis()
    const user = userEvent.setup()
    const initialState = { selectedConnectionId: connection.id, databaseIndex: 0, view: 'keys' as const, typeFilter: 'all' as const, inspectorTab: 'value' as const }
    const view = render(<StrictMode><RedisWorkspace initialState={initialState} workspace="/tmp/redis-passive" /></StrictMode>)

    expect(await screen.findByRole('heading', { name: 'Connessione Redis inattiva' })).toBeVisible()
    expect(screen.getByText(/nessuna richiesta di rete parte entrando nella tab Redis/i)).toBeVisible()
    expect(harness.api.scanKeys).not.toHaveBeenCalled()
    expect(harness.api.readKey).not.toHaveBeenCalled()
    expect(harness.api.searchPayloads).not.toHaveBeenCalled()
    expect(harness.api.testConnection).not.toHaveBeenCalled()
    expect(harness.api.reconnect).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new CustomEvent('vincodelab:application-menu-command', { detail: 'redis.refresh' }))
      window.dispatchEvent(new CustomEvent('vincodelab:application-menu-command', { detail: 'redis.reconnect' }))
    })
    expect(harness.api.scanKeys).not.toHaveBeenCalled()
    expect(harness.api.reconnect).not.toHaveBeenCalled()

    view.rerender(<StrictMode><RedisWorkspace focusRequest={1} initialState={initialState} workspace="/tmp/redis-passive" /></StrictMode>)
    await waitFor(() => expect(harness.api.scanKeys).not.toHaveBeenCalled())

    await connectSelected(user)
    expect(await screen.findByRole('button', { name: /user:1/i })).toBeVisible()
    expect(harness.api.scanKeys).toHaveBeenCalledTimes(1)

    view.rerender(<StrictMode><RedisWorkspace focusRequest={2} initialState={initialState} workspace="/tmp/redis-passive" /></StrictMode>)
    await waitFor(() => expect(harness.api.scanKeys).toHaveBeenCalledTimes(1))
  })

  it('non usa l’ID persistito mentre l’elenco locale è ancora in caricamento', async () => {
    let resolveConnections!: (connections: readonly (typeof connection)[]) => void
    const listConnections = vi.fn(() => new Promise<readonly (typeof connection)[]>((resolve) => { resolveConnections = resolve }))
    const harness = installRedis({ listConnections })
    const initialState = { selectedConnectionId: connection.id, databaseIndex: 0, view: 'keys' as const, typeFilter: 'all' as const, inspectorTab: 'value' as const }
    render(<RedisWorkspace initialState={initialState} workspace="/tmp/redis-delayed-config" />)

    await waitFor(() => expect(listConnections).toHaveBeenCalledTimes(1))
    expect(harness.api.scanKeys).not.toHaveBeenCalled()
    expect(harness.api.testConnection).not.toHaveBeenCalled()
    act(() => resolveConnections([connection]))

    expect(await screen.findByRole('heading', { name: 'Connessione Redis inattiva' })).toBeVisible()
    expect(harness.api.scanKeys).not.toHaveBeenCalled()
  })

  it('rende recuperabili apertura e disconnessione senza riconnettere automaticamente', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const scanKeys = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ cursor: '0', keys: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'string', ttlMs: null }], scanned: 1, hasMore: false })
    const reconnect = vi.fn()
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValue({ reconnected: true as const })
    installRedis({ reconnect, scanKeys })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-recovery" />)

    await connectSelected(user)
    expect(await screen.findByText('Connessione Redis non aperta')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Riprova connessione' }))
    expect(await screen.findByRole('button', { name: /user:1/i })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Disconnetti' }))
    expect(await screen.findByText('Redis non disconnesso')).toBeVisible()
    expect(screen.getByRole('button', { name: /user:1/i })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Riprova disconnessione' }))
    expect(await screen.findByRole('heading', { name: 'Connessione Redis inattiva' })).toBeVisible()
    expect(scanKeys).toHaveBeenCalledTimes(2)
    expect(reconnect).toHaveBeenCalledTimes(2)
  })

  it('naviga con SCAN, applica i filtri e legge una chiave tramite key ref sicuro', async () => {
    const scanKeys = vi.fn()
      .mockResolvedValueOnce({ cursor: 'cursor-2', keys: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'string', ttlMs: null }], scanned: 250, hasMore: true })
      .mockResolvedValueOnce({ cursor: '0', keys: [{ key: 'user:2', keyRef: keyRef('user:2'), type: 'hash', ttlMs: 5_000 }], scanned: 20, hasMore: false })
      .mockResolvedValueOnce({ cursor: '0', keys: [{ key: 'session:1', keyRef: keyRef('session:1'), type: 'hash', ttlMs: 1_000 }], scanned: 1, hasMore: false })
    const { api } = installRedis({ scanKeys })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis" />)

    await connectSelected(user)
    expect(await screen.findByRole('button', { name: /user:1/i })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Pagina successiva chiavi' }))
    expect(await screen.findByRole('button', { name: /user:2/i })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Pagina precedente chiavi' }))
    expect(screen.getByRole('button', { name: /user:1/i })).toBeVisible()

    await user.click(screen.getByRole('button', { name: /user:1/i }))
    expect(await screen.findByText('Ada Lovelace')).toBeVisible()
    expect(api.readKey).toHaveBeenCalledWith('redis-local', keyRef('user:1'), { count: 200 })

    await user.clear(screen.getByRole('textbox', { name: 'Pattern chiavi Redis' }))
    await user.type(screen.getByRole('textbox', { name: 'Pattern chiavi Redis' }), 'session:*')
    await user.click(screen.getByRole('combobox', { name: 'Tipo chiave Redis' }))
    await user.click(await screen.findByRole('option', { name: 'Hash' }))
    await user.click(screen.getByRole('button', { name: 'Applica filtri chiavi' }))
    expect(await screen.findByRole('button', { name: /session:1/i })).toBeVisible()
    expect(scanKeys).toHaveBeenLastCalledWith('redis-local', { count: 250, cursor: undefined, match: 'session:*', type: 'hash' })
  })

  it('scarta una lettura obsoleta quando cambia la connessione attiva', async () => {
    const remoteConnection = { ...connection, id: 'redis-remote', name: 'Redis remoto' }
    let finishRead!: (value: { key: string; keyRef: string; type: 'string'; ttlMs: null; value: string; previewBytes: number; totalBytes: number; truncated: false }) => void
    const readKey = vi.fn(() => new Promise<Parameters<typeof finishRead>[0]>((resolve) => { finishRead = resolve }))
    const harness = installRedis({
      listConnections: vi.fn(async () => [connection, remoteConnection]),
      readKey,
    })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-switch" />)

    await connectSelected(user)
    await user.click(await screen.findByRole('button', { name: /user:1/i }))
    expect(screen.getByText('Lettura della chiave…')).toBeVisible()
    await user.click(screen.getByRole('combobox', { name: 'Configurazione Redis selezionata' }))
    await user.click(await screen.findByRole('option', { name: 'Redis remoto · DB 0' }))
    expect(await screen.findByRole('heading', { name: 'Connessione Redis inattiva' })).toBeVisible()
    expect(readKey).toHaveBeenCalledTimes(1)
    expect(harness.api.scanKeys).toHaveBeenCalledTimes(1)

    act(() => finishRead({ key: 'user:1', keyRef: keyRef('user:1'), type: 'string', ttlMs: null, value: 'risultato obsoleto', previewBytes: 17, totalBytes: 17, truncated: false }))
    await waitFor(() => expect(screen.queryByText('risultato obsoleto')).not.toBeInTheDocument())
    expect(screen.queryByText('Lettura della chiave…')).not.toBeInTheDocument()
  })

  it('mostra progressi e risultati parziali e inoltra annullamento al bridge', async () => {
    let finishSearch!: (result: RedisPayloadSearchResult) => void
    const searchPayloads = vi.fn((_id: string, input: { operationId: string }) => new Promise<RedisPayloadSearchResult>((resolve) => {
      finishSearch = resolve
      expect(input.operationId).toMatch(/^[0-9a-f-]{36}$/iu)
    }))
    const harness = installRedis({ searchPayloads })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-search" />)

    await connectSelected(user)
    await user.click(await screen.findByRole('tab', { name: /Cerca nei payload/ }))
    const query = screen.getByRole('textbox', { name: 'Testo da cercare nei payload' })
    await user.type(query, 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Cerca' }))
    await waitFor(() => expect(searchPayloads).toHaveBeenCalledTimes(1))
    const operationId = searchPayloads.mock.calls[0][1].operationId
    expect(searchPayloads.mock.calls[0][1]).toMatchObject({ count: 100, limit: 100 })
    expect(screen.getByRole('progressbar', { name: 'Avanzamento ricerca nei payload Redis' })).not.toHaveAttribute('aria-valuenow')

    act(() => {
      harness.emitProgress({ operationId, scanned: 124, estimatedTotal: 500, matches: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'hash', path: 'name', excerpt: 'Risultato intermedio' }] })
      harness.emitProgress({ operationId, scanned: 125, estimatedTotal: 500, matches: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'hash', path: 'name', excerpt: 'Ada Lovelace' }] })
    })
    expect(await screen.findByText('Ada Lovelace')).toBeVisible()
    expect(screen.queryByText('Risultato intermedio')).not.toBeInTheDocument()
    expect(screen.getByText(/125 chiavi analizzate/)).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Avanzamento ricerca nei payload Redis' })).toHaveAttribute('aria-valuenow', '25')

    act(() => harness.emitProgress({ operationId, scanned: 126, estimatedTotal: 500, matches: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'hash', path: 'name', excerpt: 'Ada Lovelace aggiornata' }] }))
    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument())
    expect(await screen.findByText('Ada Lovelace aggiornata')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(harness.api.cancel).toHaveBeenCalledWith(operationId)
    act(() => finishSearch({ operationId, scanned: 126, matches: [], truncated: false, cancelled: true }))
    expect(await screen.findByText(/Ricerca annullata · risultati parziali/)).toBeVisible()
    expect(screen.getByText('Ada Lovelace aggiornata')).toBeVisible()
  })

  it('preserva l’ultimo progresso pending se la ricerca fallisce e limita gli annunci live', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let failSearch!: (reason: unknown) => void
    const searchPayloads = vi.fn((_id: string, input: { operationId: string }) => new Promise<RedisPayloadSearchResult>((_resolve, reject) => {
      failSearch = reject
      expect(input.operationId).toMatch(/^[0-9a-f-]{36}$/iu)
    }))
    const harness = installRedis({ searchPayloads })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-search-failure" />)

    await connectSelected(user)
    await user.click(await screen.findByRole('tab', { name: /Cerca nei payload/ }))
    await user.type(screen.getByRole('textbox', { name: 'Testo da cercare nei payload' }), 'parziale')
    await user.click(screen.getByRole('button', { name: 'Cerca' }))
    await waitFor(() => expect(searchPayloads).toHaveBeenCalledTimes(1))
    const operationId = searchPayloads.mock.calls[0][1].operationId
    act(() => harness.emitProgress({ operationId, scanned: 17, estimatedTotal: 100, matches: [{ key: 'job:17', keyRef: keyRef('job:17'), type: 'string', excerpt: 'risultato parziale conservato' }] }))
    act(() => failSearch(new Error('connection reset')))

    expect(await screen.findByText('risultato parziale conservato')).toBeVisible()
    expect(await screen.findByText('Ricerca nei payload non completata')).toBeVisible()
    expect(screen.getByText(/17 chiavi analizzate/).closest('[aria-live]')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Ricerca Redis avviata.')
  })

  it('inoltra tutte le azioni redis-key usando il keyRef e copia soltanto dati visibili', async () => {
    const harness = installRedis()
    const writeText = vi.fn(async () => undefined)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<RedisWorkspace workspace="/tmp/redis-context" />)

    await connectSelected(user)
    const keyButton = await screen.findByRole('button', { name: /user:1/i })
    const contextId = keyRef('user:1')
    expect(keyButton.closest('[data-context-menu-kind="redis-key"]')).toHaveAttribute('data-context-menu-id', contextId)

    harness.dispatchContextAction('redisKey.open', contextId)
    expect(await screen.findByText('Ada Lovelace')).toBeVisible()
    expect(screen.getByText('Ada Lovelace').closest('[data-context-menu-kind="redis-key"]')).toHaveAttribute('data-context-has-visible-value', 'true')

    harness.dispatchContextAction('redisKey.copyName', contextId)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('user:1'))
    harness.dispatchContextAction('redisKey.copyVisibleValue', contextId)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Ada Lovelace'))

    harness.dispatchContextAction('redisKey.refresh', contextId)
    await waitFor(() => expect(harness.api.readKey).toHaveBeenCalledTimes(2))
    expect(harness.api.readKey).toHaveBeenLastCalledWith('redis-local', contextId, { count: 200 })

    harness.dispatchContextAction('redisKey.searchPayload', contextId)
    expect(await screen.findByRole('tab', { name: /Cerca nei payload/ })).toHaveAttribute('data-selected')
    expect(screen.getByRole('textbox', { name: 'Pattern chiavi per ricerca payload' })).toHaveValue('user:1')
    await user.type(screen.getByRole('textbox', { name: 'Testo da cercare nei payload' }), 'Ada')
    await user.click(screen.getByRole('button', { name: 'Cerca' }))
    await waitFor(() => expect(harness.api.searchPayloads).toHaveBeenCalledWith('redis-local', expect.objectContaining({ keyRef: contextId, keyPattern: 'user:1' })))
    expect(await screen.findByText(/Ricerca completata · 1 chiave analizzata/)).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Avanzamento ricerca nei payload Redis' })).toHaveAttribute('aria-valuenow', '100')
    await user.click(screen.getByRole('tab', { name: 'Inspector' }))
    await user.click(screen.getByRole('tab', { name: 'Metadati' }))
    expect(screen.getByRole('heading', { name: 'user:1' }).closest('[data-context-menu-kind="redis-key"]')).not.toHaveAttribute('data-context-has-visible-value')
  })

  it('rende recuperabile un errore clipboard senza copiare valori non visibili', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = installRedis()
    const clipboardFailure = new DOMException('clipboard denied', 'NotAllowedError')
    const writeText = vi.fn().mockRejectedValueOnce(clipboardFailure).mockResolvedValue(undefined)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const errorToast = vi.spyOn(toast, 'error')
    const warningToast = vi.spyOn(toast, 'warning')
    render(<RedisWorkspace workspace="/tmp/redis-copy-recovery" />)
    await connectSelected(user)
    await screen.findByRole('button', { name: /user:1/i })

    harness.dispatchContextAction('redisKey.copyVisibleValue', keyRef('user:1'))
    expect(warningToast).toHaveBeenCalledWith('Valore Redis non visibile', expect.objectContaining({ description: expect.stringContaining('inspector') }))

    harness.dispatchContextAction('redisKey.copyName', keyRef('user:1'))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Contenuto Redis non copiato', expect.objectContaining({ recoveryAction: expect.any(Object) })))
    const options = errorToast.mock.calls.at(-1)?.[1]
    options?.recoveryAction?.onClick()
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(writeText).toHaveBeenLastCalledWith('user:1')
  })

  it('configura e testa una connessione Sentinel con componenti accessibili', async () => {
    const harness = installRedis()
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-sentinel" />)
    await screen.findByRole('heading', { name: 'Connessione Redis inattiva' })
    expect(harness.api.scanKeys).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Connessione' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nuova connessione Redis' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Redis HA')
    const modeSelect = within(dialog).getByRole('combobox', { name: 'Modalità' })
    expect(modeSelect).toHaveTextContent('Standalone')
    expect(modeSelect).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(modeSelect).getByText('Standalone'))
    expect(modeSelect).toHaveAttribute('aria-expanded', 'true')
    let modeList = await screen.findByRole('listbox', { name: 'Modalità' })
    await waitFor(() => expect(modeList).toHaveFocus())
    expect(modeList).toHaveClass('z_modalPopover')
    expect(modeList.closest('[data-scope="select"][data-part="positioner"]')).toHaveClass('z_modalPopover')
    expect(within(modeList).getAllByRole('option').map((option) => option.textContent?.trim())).toEqual(['Standalone', 'Sentinel'])
    expect(within(modeList).getByRole('option', { name: 'Standalone' })).toHaveAttribute('aria-selected', 'true')
    expect(modeList.closest('[aria-hidden="true"]')).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Modalità' })).not.toBeInTheDocument())
    expect(modeSelect).toHaveFocus()
    expect(dialog).toBeVisible()

    await user.keyboard('{Enter}')
    modeList = await screen.findByRole('listbox', { name: 'Modalità' })
    await waitFor(() => expect(modeList).toHaveFocus())
    await user.keyboard('{End}{Enter}')
    await waitFor(() => expect(modeSelect).toHaveTextContent('Sentinel'))
    await waitFor(() => expect(modeSelect).toHaveFocus())
    await user.clear(screen.getByRole('textbox', { name: 'Host Sentinel' }))
    await user.type(screen.getByRole('textbox', { name: 'Host Sentinel' }), 'sentinel.internal')
    await user.type(screen.getByRole('textbox', { name: 'Nome master Sentinel' }), 'vincodelab-primary')
    await user.click(screen.getByRole('button', { name: 'Testa' }))

    await waitFor(() => expect(harness.api.testConnection).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'sentinel',
      host: 'sentinel.internal',
      port: 26379,
      sentinelMasterName: 'vincodelab-primary',
    }), undefined))
    expect(await screen.findByText(/Connessione riuscita/)).toBeVisible()
  })
})
