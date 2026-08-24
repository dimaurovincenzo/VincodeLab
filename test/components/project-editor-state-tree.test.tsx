// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { undo, undoDepth } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot, AppPreferenceValue, ContextMenuAction, ProjectFileTreeNode, VincodeLabBridge, WorkspaceSessionState } from '@/bridge'
import { ProjectEditor } from '@/features/editor'
import { publishAppPreferences } from '@/lib/app-preferences'
import { clearVolatileDrafts, writeVolatileDraft } from '@/lib/volatile-draft-store'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

const savedSource = 'export const answer = 42\n'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function externalFileConflict() {
  return Object.assign(
    new Error('Il file è stato modificato o rimosso da un’altra applicazione. Le modifiche locali non sono state sovrascritte. [FILESYSTEM_EXTERNAL_CONFLICT]'),
    { code: 'FILESYSTEM_EXTERNAL_CONFLICT' },
  )
}

type FileReadResult = { id: string; name: string; content: string; revision: string; size: number }
type FileSaveResult = { id: string; revision: string; size: number }
type FileSaveOptions = { revision?: string; force?: boolean }
type FileListResult = { entries: ProjectFileTreeNode[]; truncated: boolean }
type InstallOptions = {
  effective?: Record<string, AppPreferenceValue>
  list?: () => Promise<FileListResult>
  listDirectory?: (directoryId: string) => Promise<FileListResult>
  read?: (fileId: string) => Promise<FileReadResult>
  save?: (fileId: string, content: string, options: FileSaveOptions) => Promise<FileSaveResult>
  trash?: (entryId: string, expectedKind: 'file' | 'directory') => Promise<{ id: string; kind: 'file' | 'directory'; trashed: true }>
}

function installVincodeLab(entries: ProjectFileTreeNode[] = [], options: InstallOptions = {}) {
  const preferenceSnapshot: AppPreferencesSnapshot = {
    schema: [],
    global: {},
    explicitGlobal: {},
    overrides: {},
    effective: options.effective ?? {},
    sources: {},
    workspaceAvailable: true,
  }
  const files = {
    create: vi.fn(async (directoryId: string, fileName: string) => ({
      id: directoryId ? `${directoryId}/${fileName}` : fileName,
      name: fileName,
      content: '',
      revision: `created:${directoryId}/${fileName}`,
      size: 0,
    })),
    createDirectory: vi.fn(async (parentId: string, directoryName: string) => ({ id: parentId ? `${parentId}/${directoryName}` : directoryName, kind: 'directory' as const, name: directoryName })),
    duplicate: vi.fn(async (entryId: string, expectedKind: 'file' | 'directory') => ({ id: `${entryId} copia`, kind: expectedKind, name: `${entryId.split('/').at(-1)} copia`, sourceId: entryId })),
    list: vi.fn(options.list ?? (async () => ({ entries, truncated: false }))),
    listDirectory: vi.fn(options.listDirectory ?? (async () => ({ entries: [], truncated: false }))),
    preview: vi.fn(async (fileId: string) => ({ id: fileId, name: fileId.split('/').at(-1) ?? fileId, kind: 'image' as const, content: '', size: 0 })),
    read: vi.fn(options.read ?? (async (fileId: string) => ({ id: fileId, name: fileId.split('/').at(-1) ?? fileId, content: savedSource, revision: `read:${fileId}`, size: savedSource.length }))),
    rename: vi.fn(async (entryId: string, entryName: string, expectedKind: 'file' | 'directory') => {
      const parentId = entryId.split('/').slice(0, -1).join('/')
      return { id: parentId ? `${parentId}/${entryName}` : entryName, kind: expectedKind, name: entryName, previousId: entryId, renamed: entryName !== entryId.split('/').at(-1) }
    }),
    save: vi.fn(options.save ?? (async (fileId: string, content: string) => ({ id: fileId, revision: `saved:${fileId}`, size: content.length }))),
    trash: vi.fn(options.trash ?? (async (entryId: string, expectedKind: 'file' | 'directory') => ({ id: entryId, kind: expectedKind, trashed: true as const }))),
  }
  const gitStatus = vi.fn(async () => ({
    data: { isRepository: false, files: [], commits: [], graph: [] },
    cache: { fetchedAt: 0, expiresAt: 0, stale: false },
  }))
  const preferences = vi.fn(async () => preferenceSnapshot)
  let contextActionListener: ((action: ContextMenuAction) => void) | null = null

  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      files,
      github: { gitStatus },
      contextMenu: {
        open: vi.fn(async () => ({ opened: true as const })),
        onAction: vi.fn((listener: (action: ContextMenuAction) => void) => {
          contextActionListener = listener
          return () => { if (contextActionListener === listener) contextActionListener = null }
        }),
      },
      preferences: { get: preferences },
    } as unknown as VincodeLabBridge,
  })
  publishAppPreferences(preferenceSnapshot)

  return {
    files,
    dispatchContextAction(action: ContextMenuAction) {
      act(() => contextActionListener?.(action))
    },
  }
}

describe('ProjectEditor state discard and TreeView rename', () => {
  beforeEach(() => {
    vi.useRealTimers()
    window.sessionStorage.clear()
    clearVolatileDrafts()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates and cancels a new file through Ark NodeRenameInput keyboard semantics', async () => {
    const user = userEvent.setup()
    const { files } = installVincodeLab()
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-test" />)

    const trigger = await screen.findByRole('button', { name: 'Nuovo file' })
    await user.click(trigger)

    const renameInput = await screen.findByRole('textbox', { name: 'Nome del nuovo file' })
    await waitFor(() => expect(renameInput).toHaveFocus())
    await user.type(renameInput, 'nuovo.ts')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(files.create).toHaveBeenCalledWith('', 'nuovo.ts'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome del nuovo file' })).not.toBeInTheDocument())

    const triggerAfterCreate = screen.getByRole('button', { name: 'Nuovo file' })
    await user.click(triggerAfterCreate)
    const cancelledInput = await screen.findByRole('textbox', { name: 'Nome del nuovo file' })
    await waitFor(() => expect(cancelledInput).toHaveFocus())
    await user.type(cancelledInput, 'bozza.ts')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Nome del nuovo file' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nuovo file' })).toHaveFocus())
    expect(files.create).toHaveBeenCalledTimes(1)
  })

  it('rinomina il file cliccato dal menu contestuale e aggiorna Explorer senza cambiare bersaglio', async () => {
    const user = userEvent.setup()
    const fileId = 'src/vecchio.ts'
    const harness = installVincodeLab([{ id: fileId, kind: 'file', name: 'vecchio.ts' }])
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-context-rename" />)

    expect(await screen.findByRole('treeitem', { name: 'vecchio.ts' })).toBeInTheDocument()
    harness.dispatchContextAction({ command: 'workspaceFile.rename', contextId: fileId, contextKind: 'workspace-file' })

    const input = await screen.findByRole('textbox', { name: 'Nuovo nome' })
    await user.clear(input)
    await user.type(input, 'nuovo.ts')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(harness.files.rename).toHaveBeenCalledWith(fileId, 'nuovo.ts', 'file'))
    expect(await screen.findByRole('treeitem', { name: 'nuovo.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('treeitem', { name: 'vecchio.ts' })).not.toBeInTheDocument()
  })

  it('non rinomina un file mentre la sua apertura è ancora in corso', async () => {
    const user = userEvent.setup()
    const fileId = 'src/in-caricamento.ts'
    const pendingRead = deferred<FileReadResult>()
    const harness = installVincodeLab([{ id: fileId, kind: 'file', name: 'in-caricamento.ts' }], { read: () => pendingRead.promise })
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-pending-open" />)

    await user.click(await screen.findByRole('treeitem', { name: 'in-caricamento.ts' }))
    await waitFor(() => expect(harness.files.read).toHaveBeenCalledWith(fileId))
    harness.dispatchContextAction({ command: 'workspaceFile.rename', contextId: fileId, contextKind: 'workspace-file' })

    expect(screen.queryByRole('textbox', { name: 'Nuovo nome' })).not.toBeInTheDocument()
    expect(harness.files.rename).not.toHaveBeenCalled()
    await act(async () => {
      pendingRead.resolve({ id: fileId, name: 'in-caricamento.ts', content: savedSource, revision: 'read:pending', size: savedSource.length })
      await pendingRead.promise
    })
    expect(await screen.findByRole('tab', { name: /in-caricamento\.ts/u })).toBeInTheDocument()
  })

  it('non rinomina una cartella mentre il suo contenuto è ancora in caricamento', async () => {
    const user = userEvent.setup()
    const pendingDirectory = deferred<FileListResult>()
    const harness = installVincodeLab([{ id: 'src', kind: 'directory', name: 'src' }], { listDirectory: () => pendingDirectory.promise })
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-pending-directory" />)

    await user.click(await screen.findByRole('button', { name: 'src: espandi o comprimi' }))
    await waitFor(() => expect(harness.files.listDirectory).toHaveBeenCalledWith('src'))
    harness.dispatchContextAction({ command: 'workspaceDirectory.rename', contextId: 'src', contextKind: 'workspace-directory' })

    expect(screen.queryByRole('textbox', { name: 'Nuovo nome' })).not.toBeInTheDocument()
    expect(harness.files.rename).not.toHaveBeenCalled()
    await act(async () => {
      pendingDirectory.resolve({ entries: [{ id: 'src/app.ts', kind: 'file', name: 'app.ts' }], truncated: false })
      await pendingDirectory.promise
    })
    expect(await screen.findByRole('treeitem', { name: 'app.ts' })).toBeInTheDocument()
  })

  it('sposta nel Cestino soltanto dopo conferma e rimuove il file dalla vista a successo avvenuto', async () => {
    const user = userEvent.setup()
    const fileId = 'src/da-eliminare.ts'
    const harness = installVincodeLab([{ id: fileId, kind: 'file', name: 'da-eliminare.ts' }])
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-context-trash" />)

    expect(await screen.findByRole('treeitem', { name: 'da-eliminare.ts' })).toBeInTheDocument()
    harness.dispatchContextAction({ command: 'workspaceFile.trash', contextId: fileId, contextKind: 'workspace-file' })

    expect(await screen.findByRole('heading', { name: 'Sposta “da-eliminare.ts” nel Cestino' })).toBeInTheDocument()
    expect(harness.files.trash).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Sposta nel Cestino' }))

    await waitFor(() => expect(harness.files.trash).toHaveBeenCalledWith(fileId, 'file'))
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'da-eliminare.ts' })).not.toBeInTheDocument())
  })

  it('non riapre un file mentre lo spostamento nel Cestino è in corso', async () => {
    const user = userEvent.setup()
    const fileId = 'src/cestino-in-corso.ts'
    const pendingTrash = deferred<{ id: string; kind: 'file' | 'directory'; trashed: true }>()
    const harness = installVincodeLab([{ id: fileId, kind: 'file', name: 'cestino-in-corso.ts' }], { trash: () => pendingTrash.promise })
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-pending-trash" />)

    const treeItem = await screen.findByRole('treeitem', { name: 'cestino-in-corso.ts' })
    harness.dispatchContextAction({ command: 'workspaceFile.trash', contextId: fileId, contextKind: 'workspace-file' })
    await user.click(await screen.findByRole('button', { name: 'Sposta nel Cestino' }))
    await waitFor(() => expect(harness.files.trash).toHaveBeenCalledWith(fileId, 'file'))

    await user.click(treeItem)
    expect(harness.files.read).not.toHaveBeenCalled()
    await act(async () => {
      pendingTrash.resolve({ id: fileId, kind: 'file', trashed: true })
      await pendingTrash.promise
    })
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'cestino-in-corso.ts' })).not.toBeInTheDocument())
  })

  it('conclude il loading Explorer con un errore locale sanitizzato e recuperabile', async () => {
    const user = userEvent.setup()
    const entries: ProjectFileTreeNode[] = [{ id: 'src/recovered.ts', kind: 'file', name: 'recovered.ts' }]
    let attempt = 0
    const { files } = installVincodeLab(entries, {
      list: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('EACCES /Users/alice/private token=super-secret')
        return { entries, truncated: false }
      },
    })
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-explorer-recovery" />)

    expect(await screen.findByRole('heading', { name: 'Explorer non disponibile' })).toBeInTheDocument()
    expect(screen.queryByText(/EACCES|alice|super-secret/iu)).not.toBeInTheDocument()
    expect(screen.getByText(/Riferimento ERR-[A-F0-9]{6}/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mostra dettagli' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tipo: Error')
    expect(screen.queryByText(/EACCES|alice|super-secret|PATH REDACTED/iu)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Riprova' }))
    expect(await screen.findByRole('treeitem', { name: 'recovered.ts' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Explorer non disponibile' })).not.toBeInTheDocument())
    expect(files.list).toHaveBeenCalledTimes(2)
  })

  it('mantiene gli altri tab e riapre localmente un file dopo un read fallito', async () => {
    const user = userEvent.setup()
    const fileId = 'src/retry.ts'
    let attempt = 0
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'retry.ts' }], {
      read: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('ENOENT /Users/alice/private/retry.ts')
        return { id: fileId, name: 'retry.ts', content: savedSource, revision: 'retry:2', size: savedSource.length }
      },
    })
    render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-open-recovery" />)

    await user.click(await screen.findByRole('treeitem', { name: 'retry.ts' }))
    expect(await screen.findByRole('heading', { name: 'File non aperto' })).toBeInTheDocument()
    expect(screen.queryByText(/ENOENT|alice|private/iu)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Riapri file' }))
    expect(await screen.findByRole('tab', { name: 'retry.ts' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'File non aperto' })).not.toBeInTheDocument())
    expect(files.read).toHaveBeenCalledTimes(2)
  })

  it('drops the cached CodeMirror history when unsaved changes are discarded', async () => {
    const user = userEvent.setup()
    const fileId = 'src/answer.ts'
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'answer.ts' }])
    const { container } = render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-test" />)

    const fileItem = await screen.findByRole('treeitem', { name: 'answer.ts' })
    await user.click(fileItem)
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(1))

    const editorElement = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.cm-editor')
      expect(element).not.toBeNull()
      return element!
    })
    const view = EditorView.findFromDOM(editorElement)
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))

    act(() => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: '// non salvato\n' } })
    })
    expect(undoDepth(view.state)).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Chiudi answer.ts' }))
    await user.click(await screen.findByRole('button', { name: 'Scarta modifiche' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Chiudi answer.ts' })).not.toBeInTheDocument())

    await user.click(fileItem)
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))

    expect(EditorView.findFromDOM(editorElement)).toBe(view)
    expect(undoDepth(view.state)).toBe(0)
    expect(undo(view)).toBe(false)
    expect(view.state.doc.toString()).toBe(savedSource)
  })

  it('keeps the newest activation intent when concurrent opens resolve out of order', async () => {
    const firstRead = deferred<FileReadResult>()
    const secondRead = deferred<FileReadResult>()
    const { files } = installVincodeLab([], {
      read: (fileId) => fileId === 'src/first.ts' ? firstRead.promise : secondRead.promise,
    })
    const { rerender } = render(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-open-order"
      workbenchRequest={{ kind: 'open-file', fileId: 'src/first.ts', nonce: 1 }}
    />)
    await waitFor(() => expect(files.read).toHaveBeenCalledWith('src/first.ts'))

    rerender(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-open-order"
      workbenchRequest={{ kind: 'open-file', fileId: 'src/second.ts', nonce: 2 }}
    />)
    await waitFor(() => expect(files.read).toHaveBeenCalledWith('src/second.ts'))

    await act(async () => {
      secondRead.resolve({ id: 'src/second.ts', name: 'second.ts', content: '// second\n', revision: 'read:second', size: 10 })
      await secondRead.promise
    })
    expect(await screen.findByRole('tab', { name: 'second.ts' })).toHaveAttribute('aria-selected', 'true')

    await act(async () => {
      firstRead.resolve({ id: 'src/first.ts', name: 'first.ts', content: '// first\n', revision: 'read:first', size: 9 })
      await firstRead.promise
    })
    expect(await screen.findByRole('tab', { name: 'first.ts' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'second.ts' })).toHaveAttribute('aria-selected', 'true')
  })

  it('uses a single read and creates one tab for duplicate concurrent opens', async () => {
    const read = deferred<FileReadResult>()
    const { files } = installVincodeLab([], { read: () => read.promise })
    const { rerender } = render(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-single-flight"
      workbenchRequest={{ kind: 'open-file', fileId: 'src/shared.ts', nonce: 1 }}
    />)
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(1))

    rerender(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-single-flight"
      workbenchRequest={{ kind: 'open-file', fileId: 'src/shared.ts', nonce: 2 }}
    />)
    await act(async () => { await Promise.resolve() })
    expect(files.read).toHaveBeenCalledTimes(1)

    await act(async () => {
      read.resolve({ id: 'src/shared.ts', name: 'shared.ts', content: '// shared\n', revision: 'read:shared', size: 10 })
      await read.promise
    })
    expect(await screen.findByRole('tab', { name: 'shared.ts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('button', { name: 'Chiudi shared.ts' })).toHaveLength(1)
  })

  it('keeps the autosave timer for a file when another tab becomes active', async () => {
    const user = userEvent.setup()
    const firstId = 'src/first.ts'
    const secondId = 'src/second.ts'
    const { files } = installVincodeLab([
      { id: firstId, kind: 'file', name: 'first.ts' },
      { id: secondId, kind: 'file', name: 'second.ts' },
    ], {
      effective: { 'editor.autoSave': true },
      read: async (fileId) => ({ id: fileId, name: fileId.split('/').at(-1)!, content: `// ${fileId}\n`, revision: `read:${fileId}`, size: fileId.length + 4 }),
    })
    const { container, rerender } = render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-autosave-tabs" />)
    await user.click(await screen.findByRole('treeitem', { name: 'first.ts' }))
    await waitFor(() => expect(files.read).toHaveBeenCalledWith(firstId))
    await user.click(screen.getByRole('treeitem', { name: 'second.ts' }))
    await waitFor(() => expect(files.read).toHaveBeenCalledWith(secondId))
    await user.click(screen.getByRole('tab', { name: 'first.ts' }))

    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toContain(firstId))

    vi.useFakeTimers()
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// autosave first\n' } }) })
    rerender(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-autosave-tabs"
      workbenchRequest={{ kind: 'next-tab', nonce: 1 }}
    />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('tab', { name: 'second.ts' })).toHaveAttribute('aria-selected', 'true')
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })

    expect(files.save).toHaveBeenCalledTimes(1)
    expect(files.save).toHaveBeenCalledWith(firstId, expect.stringContaining('// autosave first\n'), { revision: `read:${firstId}` })
    vi.useRealTimers()
  })

  it('does not mark a newer edit saved when an older save finishes late', async () => {
    const user = userEvent.setup()
    const fileId = 'src/revision.ts'
    const firstSave = deferred<FileSaveResult>()
    const secondSave = deferred<FileSaveResult>()
    let saveAttempt = 0
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'revision.ts' }], {
      effective: { 'editor.autoSave': true },
      save: () => (++saveAttempt === 1 ? firstSave.promise : secondSave.promise),
    })
    const { container } = render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-autosave-revision" />)
    await user.click(await screen.findByRole('treeitem', { name: 'revision.ts' }))
    await waitFor(() => expect(files.read).toHaveBeenCalledWith(fileId))
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))

    vi.useFakeTimers()
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// revision one\n' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(files.save).toHaveBeenCalledTimes(1)

    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// revision two\n' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(files.save).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstSave.resolve({ id: fileId, revision: 'saved:one', size: savedSource.length + 16 })
      await firstSave.promise
      await Promise.resolve()
    })
    expect(screen.getByText('Modifiche non salvate')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(files.save).toHaveBeenCalledTimes(2)
    expect(files.save.mock.calls[1]?.[1]).toContain('// revision two\n')

    await act(async () => {
      secondSave.resolve({ id: fileId, revision: 'saved:two', size: view.state.doc.length })
      await secondSave.promise
      await Promise.resolve()
    })
    expect(screen.getByText('Salvato')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('ripristina il baseline su disco quando lo scarto incontra un salvataggio in corso', async () => {
    const user = userEvent.setup()
    const fileId = 'src/discard-race.ts'
    const pendingSave = deferred<FileSaveResult>()
    let saveAttempt = 0
    let workspaceGuard: WorkspaceChangeGuard | null = null
    const getWorkspaceGuard = () => workspaceGuard
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'discard-race.ts' }], {
      save: async (savedFileId, content) => {
        saveAttempt += 1
        if (saveAttempt === 1) return pendingSave.promise
        return { id: savedFileId, revision: 'saved:discarded', size: content.length }
      },
    })
    const { container } = render(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-discard-race"
      onWorkspaceGuardChange={(guard) => { workspaceGuard = guard }}
    />)
    await user.click(await screen.findByRole('treeitem', { name: 'discard-race.ts' }))
    await waitFor(() => expect(files.read).toHaveBeenCalledWith(fileId))
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))

    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// da scartare\n' } }) })
    await user.click(screen.getByRole('button', { name: 'Salva file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Chiudi discard-race.ts' })).toBeDisabled()
    const registeredGuard = getWorkspaceGuard()
    if (!registeredGuard) throw new Error('Guard workspace non registrato')

    const discardPromise = registeredGuard.discardAll()
    expect(files.save).toHaveBeenCalledTimes(1)
    await act(async () => {
      pendingSave.resolve({ id: fileId, revision: 'saved:pending', size: view.state.doc.length })
      await discardPromise
    })

    expect(files.save).toHaveBeenCalledTimes(2)
    expect(files.save).toHaveBeenNthCalledWith(2, fileId, savedSource, { revision: 'saved:pending' })
    expect(view.state.doc.toString()).toBe(savedSource)
    expect(registeredGuard.hasUnsavedChanges()).toBe(false)
    expect(screen.getByText('Salvato')).toBeInTheDocument()
  })

  it('mantiene il buffer e offre un retry locale quando il salvataggio della guardia fallisce', async () => {
    const user = userEvent.setup()
    const fileId = 'src/guard-recovery.ts'
    let workspaceGuard: WorkspaceChangeGuard | null = null
    const getWorkspaceGuard = () => workspaceGuard
    let saveAttempt = 0
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'guard-recovery.ts' }], {
      save: async (savedFileId, content) => {
        saveAttempt += 1
        if (saveAttempt === 1) throw new Error('EACCES /Users/alice/private token=editor-secret')
        return { id: savedFileId, revision: 'saved:recovery', size: content.length }
      },
    })
    const { container } = render(<ProjectEditor
      workspace="/tmp/vincodelab-project-editor-guard-recovery"
      onWorkspaceGuardChange={(guard) => { workspaceGuard = guard }}
    />)
    await user.click(await screen.findByRole('treeitem', { name: 'guard-recovery.ts' }))
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))
    const localContent = `${savedSource}// bozza preservata\n`
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// bozza preservata\n' } }) })
    const registeredGuard = getWorkspaceGuard()
    if (!registeredGuard) throw new Error('Guard workspace non registrato')

    await act(async () => {
      await expect(registeredGuard.saveAll()).rejects.toThrow()
    })

    expect(view.state.doc.toString()).toBe(localContent)
    expect(screen.getByRole('heading', { name: 'File non salvati' })).toBeInTheDocument()
    expect(screen.getByText(/Riferimento ERR-[A-F0-9]{6}/u)).toBeInTheDocument()
    expect(screen.queryByText(/EACCES|alice|editor-secret/iu)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Salva i file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'File non salvati' })).not.toBeInTheDocument())
    expect(view.state.doc.toString()).toBe(localContent)
    expect(registeredGuard.hasUnsavedChanges()).toBe(false)
  })

  it('preserva il buffer, ferma i retry autosave e sovrascrive solo dopo conferma esplicita', async () => {
    const user = userEvent.setup()
    const fileId = 'src/external-conflict.ts'
    let persisted = savedSource
    let diskRevision = 'disk:initial'
    let saveAttempt = 0
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'external-conflict.ts' }], {
      effective: { 'editor.autoSave': true },
      read: async () => ({ id: fileId, name: 'external-conflict.ts', content: persisted, revision: diskRevision, size: persisted.length }),
      save: async (savedFileId, content, _options) => {
        saveAttempt += 1
        if (saveAttempt === 1) {
          persisted = '// modifica esterna\n'
          diskRevision = 'disk:external'
          throw externalFileConflict()
        }
        persisted = content
        diskRevision = `disk:saved:${saveAttempt}`
        return { id: savedFileId, revision: diskRevision, size: content.length }
      },
    })
    const { container } = render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-external-conflict" />)
    await user.click(await screen.findByRole('treeitem', { name: 'external-conflict.ts' }))
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))
    const localContent = `${savedSource}// modifica locale\n`

    vi.useFakeTimers()
    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// modifica locale\n' } }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(files.save).toHaveBeenCalledTimes(1)
    expect(files.save).toHaveBeenLastCalledWith(fileId, localContent, { revision: 'disk:initial' })
    expect(view.state.doc.toString()).toBe(localContent)
    expect(persisted).toBe('// modifica esterna\n')
    expect(screen.getByText('File modificato sul disco')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(files.save).toHaveBeenCalledTimes(1)
    vi.useRealTimers()

    await user.click(screen.getByRole('button', { name: 'Sovrascrivi file' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Sovrascrivi file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledTimes(2))
    expect(files.save).toHaveBeenNthCalledWith(2, fileId, localContent, { force: true })
    await waitFor(() => expect(screen.queryByText('File modificato sul disco')).not.toBeInTheDocument())
    expect(persisted).toBe(localContent)

    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// nuova modifica\n' } }) })
    await user.click(screen.getByRole('button', { name: 'Salva file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledTimes(3))
    expect(files.save.mock.calls[2]?.[2]).toEqual({ revision: 'disk:saved:2' })
    await waitFor(() => expect(screen.getByText('Salvato')).toBeInTheDocument())
  })

  it('ricarica esplicitamente la versione esterna e usa la nuova revisione al salvataggio successivo', async () => {
    const user = userEvent.setup()
    const fileId = 'src/reload-conflict.ts'
    let persisted = savedSource
    let diskRevision = 'disk:initial'
    let saveAttempt = 0
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'reload-conflict.ts' }], {
      read: async () => ({ id: fileId, name: 'reload-conflict.ts', content: persisted, revision: diskRevision, size: persisted.length }),
      save: async (savedFileId, content) => {
        saveAttempt += 1
        if (saveAttempt === 1) {
          persisted = '// versione esterna\n'
          diskRevision = 'disk:external'
          throw externalFileConflict()
        }
        persisted = content
        diskRevision = 'disk:after-reload-save'
        return { id: savedFileId, revision: diskRevision, size: content.length }
      },
    })
    const { container } = render(<ProjectEditor workspace="/tmp/vincodelab-project-editor-reload-conflict" />)
    await user.click(await screen.findByRole('treeitem', { name: 'reload-conflict.ts' }))
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(savedSource))

    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// locale al sicuro\n' } }) })
    const localContent = view.state.doc.toString()
    await user.click(screen.getByRole('button', { name: 'Salva file' }))
    await screen.findByText('File modificato sul disco')
    expect(view.state.doc.toString()).toBe(localContent)
    expect(screen.queryByText('Impossibile salvare il file.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ricarica dal disco' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Ricarica dal disco' }))
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.state.doc.toString()).toBe('// versione esterna\n'))
    expect(screen.queryByText('File modificato sul disco')).not.toBeInTheDocument()

    act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: '// dopo reload\n' } }) })
    await user.click(screen.getByRole('button', { name: 'Salva file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledTimes(2))
    expect(files.save).toHaveBeenLastCalledWith(fileId, '// versione esterna\n// dopo reload\n', { revision: 'disk:external' })
    await waitFor(() => expect(screen.getByText('Salvato')).toBeInTheDocument())
  })

  it('mantiene la scelta esplicita anche quando un draft locale viene recuperato dopo un rimontaggio', async () => {
    const user = userEvent.setup()
    const workspace = '/tmp/vincodelab-project-editor-restored-conflict'
    const fileId = 'src/restored-conflict.ts'
    const localContent = `${savedSource}// draft recuperato\n`
    const externalContent = '// versione esterna dopo il crash\n'
    writeVolatileDraft(
      { scope: 'project-editor', workspace, resource: JSON.stringify(['workspace', fileId]) },
      localContent,
      savedSource,
    )
    const { files } = installVincodeLab([{ id: fileId, kind: 'file', name: 'restored-conflict.ts' }], {
      read: async () => ({ id: fileId, name: 'restored-conflict.ts', content: externalContent, revision: 'disk:external', size: externalContent.length }),
    })
    const initialState: WorkspaceSessionState['editor'] = {
      openFiles: [{ source: 'workspace', id: fileId }],
      activeFile: { source: 'workspace', id: fileId },
      expandedDirectoryIds: [],
      fileViews: [],
    }
    const { container } = render(<ProjectEditor workspace={workspace} initialState={initialState} />)
    await screen.findByText('File modificato sul disco')
    const editorElement = container.querySelector<HTMLElement>('.cm-editor')
    const view = editorElement ? EditorView.findFromDOM(editorElement) : null
    if (!view) throw new Error('CodeMirror EditorView non trovata')
    await waitFor(() => expect(view.state.doc.toString()).toBe(localContent))
    expect(files.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Salva file' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Ricarica dal disco' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Ricarica dal disco' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe(externalContent))
    expect(files.save).not.toHaveBeenCalled()
  })
})
