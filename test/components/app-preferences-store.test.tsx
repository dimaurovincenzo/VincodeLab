// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createAppPreferencesStore, setAppPreferencesWorkspace, useAppPreferences } from '@/lib/app-preferences'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function preferenceSnapshot(marker: string): AppPreferencesSnapshot {
  const key = 'editor.testMarker'
  return {
    schema: [{ key, section: 'editor', label: 'Marcatore test', type: 'enum', default: marker, values: [marker] }],
    global: { [key]: marker },
    explicitGlobal: {},
    overrides: { [key]: marker },
    effective: { [key]: marker },
    sources: { [key]: 'workspace' },
    workspaceAvailable: true,
  }
}

function PreferenceConsumer({ label }: { label: string }) {
  const { preferences } = useAppPreferences()
  return <output data-testid={label}>{String(preferences?.effective['editor.testMarker'] ?? 'loading')}</output>
}

describe('store delle preferenze applicative', () => {
  it('deduplica i consumer e scarta la risposta del workspace precedente', async () => {
    const workspaceA = deferred<AppPreferencesSnapshot>()
    const workspaceB = deferred<AppPreferencesSnapshot>()
    const get = vi.fn()
      .mockReturnValueOnce(workspaceA.promise)
      .mockReturnValueOnce(workspaceB.promise)
    Object.defineProperty(window, 'vincodeLab', {
      configurable: true,
      value: { preferences: { get } } as unknown as Window['vincodeLab'],
    })

    setAppPreferencesWorkspace('/tmp/workspace-a')
    render(<StrictMode>
      <PreferenceConsumer label="primo-consumer" />
      <PreferenceConsumer label="secondo-consumer" />
    </StrictMode>)

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('primo-consumer')).toHaveTextContent('loading')
    expect(screen.getByTestId('secondo-consumer')).toHaveTextContent('loading')

    act(() => setAppPreferencesWorkspace('/tmp/workspace-b'))
    expect(screen.getByTestId('primo-consumer')).toHaveTextContent('loading')
    expect(screen.getByTestId('secondo-consumer')).toHaveTextContent('loading')
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))

    workspaceB.resolve(preferenceSnapshot('workspace-b'))
    await waitFor(() => expect(screen.getByTestId('primo-consumer')).toHaveTextContent('workspace-b'))
    expect(screen.getByTestId('secondo-consumer')).toHaveTextContent('workspace-b')

    await act(async () => {
      workspaceA.resolve(preferenceSnapshot('workspace-a'))
      await workspaceA.promise
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('primo-consumer')).toHaveTextContent('workspace-b')
    expect(screen.getByTestId('secondo-consumer')).toHaveTextContent('workspace-b')
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('termina il loading dopo un reject e un retry successivo ripristina i valori', async () => {
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('bridge non disponibile'))
      .mockResolvedValueOnce(preferenceSnapshot('retry-ok'))
    const store = createAppPreferencesStore(get)

    const firstLoad = store.ensure()
    expect(store.getSnapshot()).toMatchObject({ loading: true, error: null, preferences: null })
    await expect(firstLoad).rejects.toThrow('bridge non disponibile')
    expect(store.getSnapshot()).toMatchObject({ loading: false, preferences: null })
    expect(store.getSnapshot().error).toBeInstanceOf(Error)

    await expect(store.refresh()).resolves.toMatchObject({ effective: { 'editor.testMarker': 'retry-ok' } })
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null })
    expect(store.getSnapshot().preferences?.effective['editor.testMarker']).toBe('retry-ok')
  })

  it('ignora una risposta di retry superata da una richiesta più recente', async () => {
    const older = deferred<AppPreferencesSnapshot>()
    const newer = deferred<AppPreferencesSnapshot>()
    const get = vi.fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const store = createAppPreferencesStore(get)

    const olderRequest = store.refresh()
    const newerRequest = store.refresh()
    newer.resolve(preferenceSnapshot('newer'))
    await expect(newerRequest).resolves.toMatchObject({ effective: { 'editor.testMarker': 'newer' } })

    older.resolve(preferenceSnapshot('older'))
    await expect(olderRequest).resolves.toBeNull()
    expect(store.getSnapshot().preferences?.effective['editor.testMarker']).toBe('newer')
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null })
  })

  it('normalizza ogni preferenza e campo IPC senza invalidare quelli sani', async () => {
    const malformed = {
      schema: [
        { key: 'editor.fontSize', section: 'editor', label: 'Dimensione testo', type: 'number', default: 13, min: 10, max: 24, step: 'invalid' },
        { key: 'editor.wordWrap', section: 'editor', label: 'A capo automatico', type: 'boolean', default: true },
        { key: 'terminal.fontSize', section: 'terminal', label: 42, type: 'number', default: 11 },
      ],
      global: { 'editor.fontSize': 'grande', 'editor.wordWrap': false, 'terminal.fontSize': 15 },
      explicitGlobal: { 'editor.fontSize': 17, 'editor.wordWrap': 'invalid' },
      overrides: { 'editor.fontSize': 18, 'editor.wordWrap': 'invalid' },
      effective: { 'editor.fontSize': 'invalid', 'editor.wordWrap': false, 'terminal.fontSize': 15 },
      sources: { 'editor.fontSize': 'future-source', 'editor.wordWrap': 'global', 'terminal.fontSize': 'default' },
      workspaceAvailable: 'yes',
      futureField: { ignored: true },
    } as unknown as AppPreferencesSnapshot
    const store = createAppPreferencesStore(vi.fn(async () => malformed))

    await store.ensure()

    expect(store.getSnapshot().preferences).toEqual({
      schema: [
        { key: 'editor.fontSize', section: 'editor', label: 'Dimensione testo', type: 'number', default: 13, min: 10, max: 24 },
        { key: 'editor.wordWrap', section: 'editor', label: 'A capo automatico', type: 'boolean', default: true },
      ],
      global: { 'editor.fontSize': 17, 'editor.wordWrap': false },
      explicitGlobal: { 'editor.fontSize': 17 },
      overrides: { 'editor.fontSize': 18 },
      effective: { 'editor.fontSize': 18, 'editor.wordWrap': false },
      sources: { 'editor.fontSize': 'workspace', 'editor.wordWrap': 'global' },
      workspaceAvailable: false,
    })
  })

  it('rifiuta un payload IPC che non è uno snapshot oggetto', async () => {
    const store = createAppPreferencesStore(vi.fn(async () => [] as unknown as AppPreferencesSnapshot))

    await expect(store.ensure()).rejects.toThrow('preferenze ricevute non sono valide')
    expect(store.getSnapshot()).toMatchObject({ loading: false, preferences: null })
    expect(store.getSnapshot().error).toBeInstanceOf(Error)
  })
})
