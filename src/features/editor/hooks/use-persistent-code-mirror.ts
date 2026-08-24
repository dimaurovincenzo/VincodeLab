import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { defaultKeymap, history as editorHistory, historyKeymap, indentWithTab } from '@codemirror/commands'
import { foldGutter, foldKeymap } from '@codemirror/language'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { showMinimap } from '@replit/codemirror-minimap'
import type { WorkspaceSessionFileView } from '@/bridge'
import { graphiteCodeMirrorTheme } from '@/lib/codemirror-theme'
import { writeVolatileDraft } from '@/lib/volatile-draft-store'
import { editorDocumentForTab, editorDraftIdentity, editorStateKey, sessionFileRef } from '../model/editor-document'
import { languageForFile } from '../model/editor-language'
import type { EditorCompartments } from '../model/editor-runtime.types'
import { clearCachedEditorStateForFile } from '../model/editor-state'
import type { EditorTab } from '../model/editor.types'
import { mediaPreviewExtension } from '../components/editor-media-preview'
import { createEditorSearchPanel } from '../components/editor-search-panel'

type PersistentCodeMirrorOptions = {
  activeId: string | null
  activeTab: EditorTab | null
  editorFontSize: number
  editorTabSize: number
  editorWordWrap: boolean
  saveActiveRef: MutableRefObject<() => Promise<void>>
  setTabs: Dispatch<SetStateAction<EditorTab[]>>
  tabsRef: MutableRefObject<EditorTab[]>
  workspaceRef: MutableRefObject<string>
}

export function usePersistentCodeMirror({
  activeId,
  activeTab,
  editorFontSize,
  editorTabSize,
  editorWordWrap,
  saveActiveRef,
  setTabs,
  tabsRef,
  workspaceRef,
}: PersistentCodeMirrorOptions) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compartmentsRef = useRef<EditorCompartments>({ fontSize: new Compartment(), tabSize: new Compartment(), wordWrap: new Compartment(), documentMode: new Compartment() })
  const baseExtensionsRef = useRef<Extension[] | null>(null)
  const statesRef = useRef(new Map<string, EditorState>())
  const scrollPositionsRef = useRef(new Map<string, { left: number; top: number }>())
  const activeOwnerRef = useRef<{ key: string; tabId: string; preview?: EditorTab['preview'] } | null>(null)
  const emptyStateRef = useRef<EditorState | null>(null)
  const scrollRestoreKeyRef = useRef({})
  const pendingFocusRef = useRef(false)
  const [selection, setSelection] = useState<{ fromLine: number; toLine: number } | null>(null)
  const [sessionRevision, setSessionRevision] = useState(0)

  const documentMode = useCallback((tab: EditorTab): Extension => tab.preview
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false), mediaPreviewExtension(tab.preview, tab.content)]
    : [EditorState.readOnly.of(false), EditorView.editable.of(true), languageForFile(tab.name)], [])

  const configurationEffects = useCallback((tab: EditorTab) => {
    const compartments = compartmentsRef.current
    return [
      compartments.fontSize.reconfigure(EditorView.theme({ '&': { fontSize: `${editorFontSize}px` } })),
      compartments.tabSize.reconfigure(EditorState.tabSize.of(editorTabSize)),
      compartments.wordWrap.reconfigure(editorWordWrap ? EditorView.lineWrapping : []),
      compartments.documentMode.reconfigure(documentMode(tab)),
    ]
  }, [documentMode, editorFontSize, editorTabSize, editorWordWrap])

  const configureState = useCallback((state: EditorState, tab: EditorTab) => {
    const content = editorDocumentForTab(tab)
    return state.update({
      ...(state.doc.toString() === content ? {} : { changes: { from: 0, to: state.doc.length, insert: content } }),
      effects: configurationEffects(tab),
    }).state
  }, [configurationEffects])

  const focusTarget = useCallback(() => {
    const view = viewRef.current
    if (!view || view.dom.closest('[hidden], [inert], [aria-hidden="true"]')) return false
    view.focus()
    if (view.hasFocus) return true

    const editorSurface = hostRef.current?.closest<HTMLElement>('[aria-label="Editor progetto"]')
    const activeTabTrigger = editorSurface?.querySelector<HTMLElement>('[aria-label="File aperti"] [role="tab"][aria-selected="true"]')
    activeTabTrigger?.focus()
    return document.activeElement === activeTabTrigger
  }, [])

  const focus = useCallback(() => {
    pendingFocusRef.current = true
    requestAnimationFrame(() => {
      if (focusTarget()) pendingFocusRef.current = false
    })
  }, [focusTarget])

  const openSearch = useCallback(() => {
    if (viewRef.current) openSearchPanel(viewRef.current)
  }, [])

  useEffect(() => {
    if (!hostRef.current) return
    const compartments = compartmentsRef.current
    const extensions: Extension[] = [
      graphiteCodeMirrorTheme,
      lineNumbers(),
      foldGutter(),
      editorHistory(),
      compartments.fontSize.of(EditorView.theme({ '&': { fontSize: `${editorFontSize}px` } })),
      compartments.tabSize.of(EditorState.tabSize.of(editorTabSize)),
      compartments.wordWrap.of(editorWordWrap ? EditorView.lineWrapping : []),
      compartments.documentMode.of([]),
      search({ top: true, createPanel: createEditorSearchPanel }),
      showMinimap.compute(['doc'], () => ({
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'editor-minimap'
          return { dom }
        },
        displayText: 'characters',
        showOverlay: 'always',
      })),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab, { key: 'Mod-s', run: () => { void saveActiveRef.current(); return true } }]),
      EditorView.updateListener.of((update) => {
        const owner = activeOwnerRef.current
        if (!owner) return
        statesRef.current.set(owner.key, update.state)
        scrollPositionsRef.current.set(owner.key, { left: update.view.scrollDOM.scrollLeft, top: update.view.scrollDOM.scrollTop })
        if (update.selectionSet || update.viewportChanged) setSessionRevision((current) => current + 1)
        if (update.selectionSet || update.docChanged) {
          const selected = update.state.selection.main
          setSelection(selected.from === selected.to ? null : {
            fromLine: update.state.doc.lineAt(selected.from).number,
            toLine: update.state.doc.lineAt(selected.to).number,
          })
        }
        if (!update.docChanged || owner.preview) return
        const content = update.state.doc.toString()
        setTabs((current) => {
          const next = current.map((tab) => {
            if (tab.id !== owner.tabId) return tab
            writeVolatileDraft(editorDraftIdentity(workspaceRef.current, tab.source, tab.id), content, tab.savedContent)
            return { ...tab, content, revision: tab.revision + 1 }
          })
          tabsRef.current = next
          return next
        })
      }),
    ]
    baseExtensionsRef.current = extensions
    const state = EditorState.create({ extensions })
    emptyStateRef.current = state
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      if (viewRef.current === view) viewRef.current = null
      view.destroy()
      baseExtensionsRef.current = null
      emptyStateRef.current = null
    }
    // La vista vive quanto ProjectEditor; preferenze e documento cambiano tramite
    // Compartment e setState, mai attraverso un remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const tab = tabsRef.current.find((entry) => entry.id === activeId)
    const nextOwner = tab && !tab.remote?.binary ? { key: editorStateKey(tab), tabId: tab.id, preview: tab.preview } : null
    const currentOwner = activeOwnerRef.current

    if (currentOwner?.key === nextOwner?.key && tab) {
      view.dispatch({ effects: configurationEffects(tab) })
      return
    }
    if (currentOwner) {
      statesRef.current.set(currentOwner.key, view.state)
      scrollPositionsRef.current.set(currentOwner.key, { left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop })
    }
    activeOwnerRef.current = nextOwner
    if (!nextOwner || !tab) {
      if (emptyStateRef.current) view.setState(emptyStateRef.current)
      setSelection(null)
      return
    }

    const baseExtensions = baseExtensionsRef.current
    if (!baseExtensions) return
    const cachedState = statesRef.current.get(nextOwner.key) ?? EditorState.create({ doc: editorDocumentForTab(tab), extensions: baseExtensions })
    const nextState = configureState(cachedState, tab)
    const scrollPosition = scrollPositionsRef.current.get(nextOwner.key) ?? { left: 0, top: 0 }
    statesRef.current.set(nextOwner.key, nextState)
    view.setState(nextState)
    const selected = nextState.selection.main
    setSelection(selected.from === selected.to ? null : {
      fromLine: nextState.doc.lineAt(selected.from).number,
      toLine: nextState.doc.lineAt(selected.to).number,
    })
    view.requestMeasure({
      key: scrollRestoreKeyRef.current,
      read: () => scrollPosition,
      write: (position, currentView) => {
        if (activeOwnerRef.current?.key !== nextOwner.key) return
        currentView.scrollDOM.scrollLeft = position.left
        currentView.scrollDOM.scrollTop = position.top
      },
    })
  }, [activeId, activeTab?.preview, activeTab?.remote?.binary, configurationEffects, configureState, tabsRef])

  useEffect(() => {
    const view = viewRef.current
    const tab = tabsRef.current.find((entry) => entry.id === activeId)
    if (!view || !tab || tab.remote?.binary || activeOwnerRef.current?.key !== editorStateKey(tab)) return
    const content = editorDocumentForTab(tab)
    if (view.state.doc.toString() === content) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      effects: compartmentsRef.current.documentMode.reconfigure(documentMode(tab)),
    })
  }, [activeId, activeTab?.content, activeTab?.preview, activeTab?.remote?.binary, documentMode, tabsRef])

  useEffect(() => {
    if (!pendingFocusRef.current || !activeId || activeTab?.remote?.binary) return
    const frame = requestAnimationFrame(() => {
      if (focusTarget()) pendingFocusRef.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, activeTab?.remote?.binary, focusTarget])

  const clearFile = useCallback((fileId: string) => {
    if (activeOwnerRef.current?.tabId === fileId) activeOwnerRef.current = null
    clearCachedEditorStateForFile(fileId, statesRef.current, scrollPositionsRef.current)
  }, [])

  const renameFile = useCallback((previous: EditorTab, renamed: EditorTab) => {
    const oldKey = editorStateKey(previous)
    const nextKey = editorStateKey(renamed)
    const state = statesRef.current.get(oldKey)
    const scroll = scrollPositionsRef.current.get(oldKey)
    if (state) { statesRef.current.delete(oldKey); statesRef.current.set(nextKey, state) }
    if (scroll) { scrollPositionsRef.current.delete(oldKey); scrollPositionsRef.current.set(nextKey, scroll) }
    if (activeOwnerRef.current?.tabId === previous.id) activeOwnerRef.current = { ...activeOwnerRef.current, key: nextKey, tabId: renamed.id }
  }, [])

  const restoreFileView = useCallback((tab: EditorTab, storedView: WorkspaceSessionFileView) => {
    const baseExtensions = baseExtensionsRef.current
    if (!baseExtensions || tab.remote?.binary) return
    const document = editorDocumentForTab(tab)
    const anchor = Math.min(storedView.selection.anchor, document.length)
    const head = Math.min(storedView.selection.head, document.length)
    const state = EditorState.create({ doc: document, extensions: baseExtensions, selection: { anchor, head } })
    statesRef.current.set(editorStateKey(tab), configureState(state, tab))
    scrollPositionsRef.current.set(editorStateKey(tab), storedView.scroll)
  }, [configureState])

  const restoreActiveFileView = useCallback((tab: EditorTab, storedView: WorkspaceSessionFileView) => {
    const view = viewRef.current
    if (!view || tab.remote?.binary) return
    const anchor = Math.min(storedView.selection.anchor, view.state.doc.length)
    const head = Math.min(storedView.selection.head, view.state.doc.length)
    view.dispatch({ selection: { anchor, head }, scrollIntoView: false })
    view.scrollDOM.scrollTop = storedView.scroll.top
    view.scrollDOM.scrollLeft = storedView.scroll.left
  }, [])

  const collectFileViews = useCallback((tabs: EditorTab[]) => {
    const fileViews: WorkspaceSessionFileView[] = []
    for (const tab of tabs) {
      if (tab.remote?.binary) continue
      const key = editorStateKey(tab)
      const isActiveOwner = activeOwnerRef.current?.key === key
      const state = isActiveOwner ? viewRef.current?.state : statesRef.current.get(key)
      if (!state) continue
      const storedScroll = isActiveOwner && viewRef.current
        ? { top: viewRef.current.scrollDOM.scrollTop, left: viewRef.current.scrollDOM.scrollLeft }
        : scrollPositionsRef.current.get(key) ?? { top: 0, left: 0 }
      const selected = state.selection.main
      fileViews.push({
        ...sessionFileRef(tab),
        selection: { anchor: Math.min(selected.anchor, 2_000_000), head: Math.min(selected.head, 2_000_000) },
        scroll: {
          top: Math.min(Math.max(0, storedScroll.top), 100_000_000),
          left: Math.min(Math.max(0, storedScroll.left), 100_000_000),
        },
      })
    }
    return fileViews
  }, [])

  const bumpSessionRevision = useCallback(() => {
    setSessionRevision((current) => current + 1)
  }, [])

  return {
    bumpSessionRevision,
    clearFile,
    collectFileViews,
    focus,
    focusTarget,
    hostRef,
    openSearch,
    renameFile,
    restoreActiveFileView,
    restoreFileView,
    selection,
    sessionRevision,
  }
}
