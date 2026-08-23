import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RedisWorkspace } from '@/components/redis-workspace'
import { toast } from '@/components/ui'
import type { RedisApi, RedisPayloadSearchProgress, RedisPayloadSearchResult } from '@/lib/redis-types'

const connection = { id: 'redis-local', name: 'Redis locale', host: '127.0.0.1', port: 6379, database: 0, hasPassword: false }
const keyRef = (key: string) => btoa(key)

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

  it('naviga con SCAN, applica i filtri e legge una chiave tramite key ref sicuro', async () => {
    const scanKeys = vi.fn()
      .mockResolvedValueOnce({ cursor: 'cursor-2', keys: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'string', ttlMs: null }], scanned: 250, hasMore: true })
      .mockResolvedValueOnce({ cursor: '0', keys: [{ key: 'user:2', keyRef: keyRef('user:2'), type: 'hash', ttlMs: 5_000 }], scanned: 20, hasMore: false })
      .mockResolvedValueOnce({ cursor: '0', keys: [{ key: 'session:1', keyRef: keyRef('session:1'), type: 'hash', ttlMs: 1_000 }], scanned: 1, hasMore: false })
    const { api } = installRedis({ scanKeys })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis" />)

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

  it('mostra progressi e risultati parziali e inoltra annullamento al bridge', async () => {
    let finishSearch!: (result: RedisPayloadSearchResult) => void
    const searchPayloads = vi.fn((_id: string, input: { operationId: string }) => new Promise<RedisPayloadSearchResult>((resolve) => {
      finishSearch = resolve
      expect(input.operationId).toMatch(/^[0-9a-f-]{36}$/iu)
    }))
    const harness = installRedis({ searchPayloads })
    const user = userEvent.setup()
    render(<RedisWorkspace workspace="/tmp/redis-search" />)

    await user.click(await screen.findByRole('tab', { name: /Cerca nei payload/ }))
    const query = screen.getByRole('textbox', { name: 'Testo da cercare nei payload' })
    await user.type(query, 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Cerca' }))
    await waitFor(() => expect(searchPayloads).toHaveBeenCalledTimes(1))
    const operationId = searchPayloads.mock.calls[0][1].operationId
    expect(searchPayloads.mock.calls[0][1]).toMatchObject({ count: 100, limit: 100 })
    expect(screen.getByRole('progressbar', { name: 'Avanzamento ricerca nei payload Redis' })).not.toHaveAttribute('aria-valuenow')

    act(() => harness.emitProgress({ operationId, scanned: 125, estimatedTotal: 500, matches: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'hash', path: 'name', excerpt: 'Ada Lovelace' }] }))
    expect(await screen.findByText('Ada Lovelace')).toBeVisible()
    expect(screen.getByText(/125 chiavi analizzate/)).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Avanzamento ricerca nei payload Redis' })).toHaveAttribute('aria-valuenow', '25')

    act(() => harness.emitProgress({ operationId, scanned: 126, estimatedTotal: 500, matches: [{ key: 'user:1', keyRef: keyRef('user:1'), type: 'hash', path: 'name', excerpt: 'Ada Lovelace aggiornata' }] }))
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace aggiornata')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Annulla' }))
    expect(harness.api.cancel).toHaveBeenCalledWith(operationId)
    act(() => finishSearch({ operationId, scanned: 126, matches: [], truncated: false, cancelled: true }))
    expect(await screen.findByText(/Ricerca annullata · risultati parziali/)).toBeVisible()
    expect(screen.getByText('Ada Lovelace aggiornata')).toBeVisible()
  })

  it('inoltra tutte le azioni redis-key usando il keyRef e copia soltanto dati visibili', async () => {
    const harness = installRedis()
    const writeText = vi.fn(async () => undefined)
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<RedisWorkspace workspace="/tmp/redis-context" />)

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
    await user.click(screen.getByRole('tab', { name: 'Inspector' }))
    await user.click(screen.getByRole('tab', { name: 'Metadati' }))
    expect(screen.getByRole('heading', { name: 'user:1' }).closest('[data-context-menu-kind="redis-key"]')).not.toHaveAttribute('data-context-has-visible-value')
  })

  it('rende recuperabile un errore clipboard senza copiare valori non visibili', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = installRedis()
    const clipboardFailure = new DOMException('clipboard denied', 'NotAllowedError')
    const writeText = vi.fn().mockRejectedValueOnce(clipboardFailure).mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const errorToast = vi.spyOn(toast, 'error')
    const warningToast = vi.spyOn(toast, 'warning')
    render(<RedisWorkspace workspace="/tmp/redis-copy-recovery" />)
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
    await screen.findByRole('button', { name: /user:1/i })

    await user.click(screen.getByRole('button', { name: 'Connessione' }))
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Redis HA')
    const modeSelect = screen.getByRole('combobox', { name: 'Modalità' })
    modeSelect.focus()
    await user.keyboard('{End}{Enter}')
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
