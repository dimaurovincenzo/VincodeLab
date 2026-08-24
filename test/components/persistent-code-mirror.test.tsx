// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { useRef, useState } from 'react'
import { render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import { usePersistentCodeMirror } from '@/features/editor/hooks/use-persistent-code-mirror'
import type { EditorTab } from '@/features/editor/model/editor.types'

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
})

const firstTab: EditorTab = {
  id: 'src/first.ts',
  name: 'first.ts',
  content: 'export const first = true\n',
  savedContent: 'export const first = true\n',
  revision: 0,
  savedRevision: 0,
  instance: 1,
  source: 'workspace',
}

const secondTab: EditorTab = {
  ...firstTab,
  id: 'src/second.ts',
  name: 'second.ts',
  content: 'export const second = true\n',
  savedContent: 'export const second = true\n',
  instance: 2,
}

function CodeMirrorHarness({ activeTab, fontSize = 13 }: { activeTab: EditorTab; fontSize?: number }) {
  const tabsRef = useRef([firstTab, secondTab])
  const workspaceRef = useRef('/tmp/vincodelab-persistent-codemirror')
  const saveActiveRef = useRef(async () => undefined)
  const [, setTabs] = useState([firstTab, secondTab])
  const { hostRef } = usePersistentCodeMirror({
    activeId: activeTab.id,
    activeTab,
    editorFontSize: fontSize,
    editorTabSize: 2,
    editorWordWrap: false,
    saveActiveRef,
    setTabs,
    tabsRef,
    workspaceRef,
  })

  return <div data-testid="codemirror-host" ref={hostRef} />
}

describe('usePersistentCodeMirror', () => {
  it('mantiene una sola EditorView, cambia stato per tab, riconfigura i Compartment e distrugge al cleanup', async () => {
    const setState = vi.spyOn(EditorView.prototype, 'setState')
    const dispatch = vi.spyOn(EditorView.prototype, 'dispatch')
    const destroy = vi.spyOn(EditorView.prototype, 'destroy')
    const { container, rerender, unmount } = render(<CodeMirrorHarness activeTab={firstTab} />)

    await waitFor(() => expect(container.querySelectorAll('.cm-editor')).toHaveLength(1))
    await waitFor(() => expect(setState).toHaveBeenCalled())
    const editorDom = container.querySelector('.cm-editor')
    const initialSetStateCalls = setState.mock.calls.length

    rerender(<CodeMirrorHarness activeTab={secondTab} />)

    await waitFor(() => expect(setState.mock.calls.length).toBeGreaterThan(initialSetStateCalls))
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(container.querySelector('.cm-editor')).toBe(editorDom)
    expect(destroy).not.toHaveBeenCalled()

    const dispatchCallsBeforePreferenceChange = dispatch.mock.calls.length
    rerender(<CodeMirrorHarness activeTab={secondTab} fontSize={16} />)

    await waitFor(() => expect(dispatch.mock.calls.length).toBeGreaterThan(dispatchCallsBeforePreferenceChange))
    const reconfiguration = dispatch.mock.calls
      .slice(dispatchCallsBeforePreferenceChange)
      .map(([spec]) => spec as unknown as { effects?: unknown[] })
      .find((spec) => Array.isArray(spec.effects) && spec.effects.length === 4)
    expect(reconfiguration).toBeDefined()
    expect(container.querySelector('.cm-editor')).toBe(editorDom)
    expect(destroy).not.toHaveBeenCalled()

    unmount()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})
