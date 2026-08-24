// oxlint-disable-next-line typescript/triple-slash-reference -- include bridge globals in this isolated hook test.
/// <reference path="../../src/vincode-lab.d.ts" />

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppNavigation } from '@/app/hooks/use-app-navigation'
import { useWorkspaceCloseGuards } from '@/app/hooks/use-workspace-close-guards'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { createMemoryHistoryStorage, WorkbenchUsageHistory } from '@/lib/workbench-history'

let closeRequested: ((request: LifecycleCloseRequest) => void) | null
const respondToClose = vi.fn()

beforeEach(() => {
  closeRequested = null
  respondToClose.mockReset()
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: {
      appMenu: { setContext: vi.fn() },
      lifecycle: {
        onCloseRequested: vi.fn((listener: (request: LifecycleCloseRequest) => void) => {
          closeRequested = listener
          return () => { closeRequested = null }
        }),
        respondToClose,
      },
    } as unknown as Window['vincodeLab'],
  })
})

describe('hook della shell applicativa', () => {
  it('confina le modifiche sporche e salva prima del cambio workspace', async () => {
    let dirty = true
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => dirty,
      saveAll: vi.fn(async () => { dirty = false }),
      discardAll: vi.fn(async () => { dirty = false }),
    }
    const performWorkspaceChange = vi.fn(async () => undefined)
    const flushUntilClean = vi.fn(async () => undefined)
    const { result } = renderHook(() => useWorkspaceCloseGuards({ flushUntilClean, performWorkspaceChange }))

    act(() => {
      result.current.handleEditorWorkspaceGuardChange(guard)
      result.current.requestWorkspaceChange({ kind: 'recent', path: '/tmp/next' })
    })

    expect(result.current.workspaceChangeRequest).toEqual({ kind: 'recent', path: '/tmp/next' })
    expect(performWorkspaceChange).not.toHaveBeenCalled()

    await act(async () => { await result.current.saveAndChangeWorkspace() })

    expect(guard.saveAll).toHaveBeenCalledTimes(1)
    expect(performWorkspaceChange).toHaveBeenCalledWith({ kind: 'recent', path: '/tmp/next' })
    expect(result.current.workspaceChangeRequest).toBeNull()

    act(() => { closeRequested?.({ requestId: 'close-1', reason: 'window' }) })
    await waitFor(() => expect(respondToClose).toHaveBeenCalledWith('close-1', 'proceed'))
    expect(flushUntilClean).toHaveBeenCalledTimes(1)
  })

  it('mantiene viste visitate e cronologia file senza rimontare la navigazione', () => {
    const history = new WorkbenchUsageHistory({ storage: createMemoryHistoryStorage(), now: () => 42 })
    const { result } = renderHook(() => useAppNavigation({ usageHistory: history, workspace: '/tmp/demo' }))

    act(() => {
      result.current.selectAppSection('database')
      result.current.openWorkspaceFile('src/main.ts')
    })

    expect(result.current.appSection).toBe('editor')
    expect(result.current.loadedSections.database).toBe(true)
    expect(result.current.loadedSections.editor).toBe(true)
    expect(result.current.editorWorkbenchRequest).toMatchObject({ kind: 'open-file', fileId: 'src/main.ts' })
    expect(history.find('file', 'src/main.ts', '/tmp/demo')).toMatchObject({ useCount: 1, lastUsedAt: 42 })

    act(() => { result.current.openGitDiffForFile('src/main.ts') })
    expect(result.current.appSection).toBe('github')
    expect(result.current.githubWorkbenchRequest).toMatchObject({ kind: 'open-file-diff', filePath: 'src/main.ts' })

    act(() => { result.current.navigateToAppSection('ai', true) })
    expect(result.current.aiTab).toBe('terminal')
    expect(result.current.aiFocusRequest).toBeGreaterThan(0)
  })
})
