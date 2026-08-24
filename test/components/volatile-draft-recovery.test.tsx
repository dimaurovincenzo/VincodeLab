// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { useState, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppPreferencesSnapshot, ProjectSkill, VincodeLabBridge, WorkspaceSessionState } from '@/bridge'
import { ProjectEditor } from '@/features/editor'
import { ProjectInstructions } from '@/features/ai/components/project-instructions'
import { ProjectSkills } from '@/features/ai/components/project-skills'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { publishAppPreferences } from '@/lib/app-preferences'
import { clearVolatileDrafts, readVolatileDraft } from '@/lib/volatile-draft-store'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})

function Fault({ active }: { active: boolean }) {
  if (active) throw new Error('fault di test')
  return null
}

function RetryHarness({ children, viewName }: { children: ReactNode; viewName: string }) {
  const [fault, setFault] = useState(false)
  return <>
    <button onClick={() => setFault(true)}>Inietta guasto</button>
    <button onClick={() => setFault(false)}>Risolvi guasto</button>
    <ViewErrorBoundary viewName={viewName}>{children}<Fault active={fault} /></ViewErrorBoundary>
  </>
}

function installEditorBridge(fileId: string, persistedContent: string) {
  const files = {
    create: vi.fn(),
    list: vi.fn(async () => ({ entries: [{ id: fileId, kind: 'file' as const, name: fileId.split('/').at(-1) ?? fileId }], truncated: false })),
    listDirectory: vi.fn(async () => ({ entries: [], truncated: false })),
    preview: vi.fn(),
    read: vi.fn(async () => ({ id: fileId, name: fileId.split('/').at(-1) ?? fileId, content: persistedContent, revision: 'read:initial', size: persistedContent.length })),
    save: vi.fn(async (_id: string, content: string) => ({ id: fileId, revision: 'saved:local', size: content.length })),
  }
  const preferenceSnapshot: AppPreferencesSnapshot = {
    schema: [], global: {}, explicitGlobal: {}, overrides: {}, effective: {}, sources: {}, workspaceAvailable: true,
  }
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      files,
      github: { gitStatus: vi.fn(async () => ({ data: { isRepository: false, files: [], commits: [], graph: [] }, cache: { fetchedAt: 0, expiresAt: 0, stale: false } })) },
      preferences: { get: vi.fn(async () => preferenceSnapshot) },
    } as unknown as VincodeLabBridge,
  })
  publishAppPreferences(preferenceSnapshot)
  return files
}

async function triggerRetry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Inietta guasto' }))
  await screen.findByRole('alert')
  await user.click(screen.getByRole('button', { name: 'Risolvi guasto' }))
  await user.click(screen.getByRole('button', { name: 'Riprova' }))
}

describe('bozze volatili dopo il retry di una vista', () => {
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearVolatileDrafts()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => consoleError.mockRestore())

  it('ripristina la Skill sporca e non la propaga ad altre risorse o workspace', async () => {
    const user = userEvent.setup()
    const skill: ProjectSkill = { id: 'review-code', name: 'review-code', description: 'Review', valid: true, issues: [], content: '# Base' }
    const skills = {
      list: vi.fn(async () => [skill]),
      get: vi.fn(async () => skill),
      update: vi.fn(async (_id: string, content: string) => ({ ...skill, content })),
      create: vi.fn(), delete: vi.fn(), reload: vi.fn(),
    }
    Object.defineProperty(window, 'vincodeLab', { configurable: true, value: { skills } as unknown as VincodeLabBridge })

    render(<RetryHarness viewName="Skill"><ProjectSkills workspace="/workspace/a" /></RetryHarness>)
    await user.click(await screen.findByRole('option', { name: /review-code/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# Base'))
    await user.type(editor, ' locale')

    expect(readVolatileDraft({ scope: 'project-skill', workspace: '/workspace/a', resource: 'review-code' })?.content).toBe('# Base locale')
    expect(readVolatileDraft({ scope: 'project-skill', workspace: '/workspace/a', resource: 'other-skill' })).toBeNull()
    expect(readVolatileDraft({ scope: 'project-skill', workspace: '/workspace/b', resource: 'review-code' })).toBeNull()

    await triggerRetry(user)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Contenuto SKILL.md' })).toHaveValue('# Base locale'))

    await user.click(screen.getByRole('button', { name: 'Annulla modifiche' }))
    await waitFor(() => expect(readVolatileDraft({ scope: 'project-skill', workspace: '/workspace/a', resource: 'review-code' })).toBeNull())
  })

  it('ripristina le istruzioni sporche e cancella la bozza dopo il salvataggio', async () => {
    const user = userEvent.setup()
    let persisted = '# Istruzioni base'
    const instructions = {
      get: vi.fn(async () => ({ exists: true, content: persisted })),
      save: vi.fn(async (content: string) => { persisted = content; return { exists: true as const, content } }),
      clear: vi.fn(),
    }
    Object.defineProperty(window, 'vincodeLab', { configurable: true, value: { instructions } as unknown as VincodeLabBridge })

    render(<RetryHarness viewName="Istruzioni"><ProjectInstructions workspace="/workspace/instructions" /></RetryHarness>)
    const editor = await screen.findByRole('textbox', { name: 'Istruzioni progetto' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, ' locali')

    await triggerRetry(user)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Istruzioni progetto' })).toHaveValue('# Istruzioni base locali'))
    expect(readVolatileDraft({ scope: 'project-instructions', workspace: '/workspace/other', resource: '.pi/APPEND_SYSTEM.md' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))
    await waitFor(() => expect(readVolatileDraft({ scope: 'project-instructions', workspace: '/workspace/instructions', resource: '.pi/APPEND_SYSTEM.md' })).toBeNull())
  })

  it('ripristina il buffer CodeMirror dopo fault e retry e lo elimina dopo il salvataggio', async () => {
    const user = userEvent.setup()
    const workspace = '/workspace/editor-a'
    const fileId = 'src/shared.ts'
    const persisted = 'export const value = 1\n'
    const files = installEditorBridge(fileId, persisted)
    const initialState: WorkspaceSessionState['editor'] = {
      openFiles: [{ source: 'workspace', id: fileId }],
      activeFile: { source: 'workspace', id: fileId },
      expandedDirectoryIds: [],
      fileViews: [],
    }
    const rendered = render(<RetryHarness viewName="Editor"><ProjectEditor workspace={workspace} initialState={initialState} /></RetryHarness>)

    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(1))
    const firstEditor = await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.cm-editor')
      const view = element ? EditorView.findFromDOM(element) : null
      expect(view?.state.doc.toString()).toBe(persisted)
      return view!
    })
    const dirty = `${persisted}// locale\n`
    act(() => firstEditor.dispatch({ changes: { from: firstEditor.state.doc.length, insert: '// locale\n' } }))

    const identity = { scope: 'project-editor' as const, workspace, resource: JSON.stringify(['workspace', fileId]) }
    expect(readVolatileDraft(identity)?.content).toBe(dirty)
    expect(readVolatileDraft({ ...identity, resource: JSON.stringify(['workspace', 'src/other.ts']) })).toBeNull()
    expect(readVolatileDraft({ ...identity, workspace: '/workspace/editor-b' })).toBeNull()

    await triggerRetry(user)
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(2))
    await waitFor(() => {
      const element = rendered.container.querySelector<HTMLElement>('.cm-editor')
      const view = element ? EditorView.findFromDOM(element) : null
      expect(view?.state.doc.toString()).toBe(dirty)
    })

    await user.click(screen.getByRole('button', { name: 'Salva file' }))
    await waitFor(() => expect(files.save).toHaveBeenCalledWith(fileId, dirty, { revision: 'read:initial' }))
    await waitFor(() => expect(readVolatileDraft(identity)).toBeNull())
  })

  it('mantiene la modalità sorgente di Markdown durante il retry locale', async () => {
    const user = userEvent.setup()
    const workspace = '/workspace/editor-markdown'
    const fileId = 'README.md'
    const persisted = '# Documento\n'
    const files = installEditorBridge(fileId, persisted)
    const initialState: WorkspaceSessionState['editor'] = {
      openFiles: [{ source: 'workspace', id: fileId, mode: 'source' }],
      activeFile: { source: 'workspace', id: fileId, mode: 'source' },
      expandedDirectoryIds: [],
      fileViews: [],
    }
    const rendered = render(<RetryHarness viewName="Editor"><ProjectEditor workspace={workspace} initialState={initialState} /></RetryHarness>)

    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(rendered.container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true'))
    expect(screen.getByRole('button', { name: 'Mostra anteprima' })).toBeVisible()

    await triggerRetry(user)
    await waitFor(() => expect(files.read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(rendered.container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true'))
    expect(screen.getByRole('button', { name: 'Mostra anteprima' })).toBeVisible()
  })
})
