import { describe, expect, it } from 'vitest'
import type { GitFileStatus } from '@/bridge'
import {
  editorDocumentForTab,
  editorDraftIdentity,
  editorStateKey,
  parseCsvPreview,
  previewKindForFile,
  sessionFileRef,
} from '@/features/editor/model/editor-document'
import { editorTabCloseTargets, editorWorkbenchCycleDirection } from '@/features/editor/model/editor.commands'
import { gitStatusMap } from '@/features/editor/model/editor-git'
import { clearCachedEditorStateForFile } from '@/features/editor/model/editor-state'
import {
  filterEditorTree,
  findProjectTreeEntry,
  mergeRefreshedProjectEntries,
  projectEntriesOverlap,
  removeProjectTreeEntry,
  renameProjectTreeEntry,
  toEditorTreeNodes,
} from '@/features/editor/model/editor-tree'
import type { EditorTab } from '@/features/editor/model/editor.types'

const tree: ProjectFileTreeNode[] = [
  {
    id: 'src',
    kind: 'directory',
    name: 'src',
    children: [
      { id: 'src/App.tsx', kind: 'file', name: 'App.tsx' },
      { id: 'src/lib', kind: 'directory', name: 'lib', children: [{ id: 'src/lib/id.ts', kind: 'file', name: 'id.ts' }] },
    ],
  },
  { id: 'README.md', kind: 'file', name: 'README.md' },
]

function workspaceTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'src/App.tsx',
    name: 'App.tsx',
    content: 'corrente',
    savedContent: 'salvato',
    revision: 2,
    savedRevision: 1,
    instance: 1,
    source: 'workspace',
    ...overrides,
  }
}

describe('editor tree model', () => {
  it('converte, cerca e individua nodi senza mutare l’albero sorgente', () => {
    const nodes = toEditorTreeNodes(tree, 'src', 'nuovo.ts')
    expect(nodes[0]?.kind).toBe('directory')
    if (nodes[0]?.kind !== 'directory') throw new Error('Directory attesa')
    expect(nodes[0].children?.[0]).toMatchObject({ kind: 'new-file', name: 'nuovo.ts' })
    expect(findProjectTreeEntry(tree, 'src/lib/id.ts')?.name).toBe('id.ts')
    expect(filterEditorTree(tree, 'app')).toEqual([
      { ...tree[0], children: [{ id: 'src/App.tsx', kind: 'file', name: 'App.tsx' }] },
    ])
    expect(tree[0]).toEqual(expect.objectContaining({ id: 'src' }))
  })

  it('rinomina e rimuove directory mantenendo coerenti i percorsi discendenti', () => {
    const renamed = renameProjectTreeEntry(tree, 'src/lib', 'src/shared')
    expect(findProjectTreeEntry(renamed, 'src/shared/id.ts')?.name).toBe('id.ts')
    expect(findProjectTreeEntry(renamed, 'src/lib')).toBeUndefined()
    expect(findProjectTreeEntry(removeProjectTreeEntry(renamed, 'src/shared'), 'src/shared/id.ts')).toBeUndefined()
    expect(projectEntriesOverlap('src', 'directory', 'src/App.tsx', 'file')).toBe(true)
    expect(projectEntriesOverlap('src/App.tsx', 'file', 'src/App.tsx.bak', 'file')).toBe(false)
  })

  it('mantiene i figli caricati quando aggiorna il livello corrente', () => {
    const refreshed: ProjectFileTreeNode[] = [{ id: 'src', kind: 'directory', name: 'src' }]
    expect(mergeRefreshedProjectEntries(tree, refreshed)[0]).toEqual(tree[0])
  })
})

describe('editor document model', () => {
  it('riconosce anteprime e limita una tabella CSV', () => {
    expect(previewKindForFile('foto.webp')).toBe('image')
    expect(previewKindForFile('README.md')).toBe('markdown')
    expect(previewKindForFile('main.ts')).toBeUndefined()
    expect(parseCsvPreview('nome;testo\nuno;"a;b"')).toEqual([['nome', 'testo'], ['uno', 'a;b']])

    const wideRow = Array.from({ length: 35 }, (_, index) => `c${index}`).join(',')
    expect(parseCsvPreview(wideRow)[0]).toHaveLength(30)
  })

  it('produce identità di sessione, draft e cache stabili', () => {
    const tab = workspaceTab()
    expect(editorStateKey(tab)).toBe('src/App.tsx::source')
    expect(editorDraftIdentity('/workspace', 'workspace', tab.id)).toEqual({
      scope: 'project-editor',
      workspace: '/workspace',
      resource: JSON.stringify(['workspace', tab.id]),
    })
    expect(sessionFileRef(tab)).toEqual({ source: 'workspace', id: tab.id, mode: 'source' })
    expect(editorDocumentForTab(tab)).toBe('corrente')
    expect(editorDocumentForTab(workspaceTab({ preview: 'image' }))).toBe('')
  })

  it('invalida tutte le varianti di stato di un file e non quelle degli altri', () => {
    const states = new Map([
      ['src/App.tsx::source', 1],
      ['src/App.tsx::preview:markdown', 2],
      ['src/other.ts::source', 3],
    ])
    const scroll = new Map(states)
    clearCachedEditorStateForFile('src/App.tsx', states, scroll)
    expect([...states.keys()]).toEqual(['src/other.ts::source'])
    expect([...scroll.keys()]).toEqual(['src/other.ts::source'])
  })
})

describe('editor commands and Git status', () => {
  it('risolve i target dei comandi tab senza side effect', () => {
    const tabs = ['a', 'b', 'c']
    expect(editorTabCloseTargets('editorTab.close', tabs, 'b')).toEqual(['b'])
    expect(editorTabCloseTargets('editorTab.closeOthers', tabs, 'b')).toEqual(['a', 'c'])
    expect(editorTabCloseTargets('editorTab.closeRight', tabs, 'b')).toEqual(['c'])
    expect(editorTabCloseTargets('editorTab.closeAll', tabs, 'b')).toEqual(tabs)
    expect(editorTabCloseTargets('editorTab.save', tabs, 'b')).toBeNull()
    expect(editorWorkbenchCycleDirection({ kind: 'next-tab', nonce: 1 })).toBe(1)
    expect(editorWorkbenchCycleDirection({ kind: 'previous-tab', nonce: 2 })).toBe(-1)
  })

  it('indicizza anche il percorso precedente di un file Git rinominato', () => {
    const file: GitFileStatus = { path: 'nuovo.ts', previousPath: 'vecchio.ts', index: 'R', workingTree: ' ' }
    const status = gitStatusMap({
      isRepository: true,
      files: [file],
      commits: [],
      graph: [],
      filesHasMore: false,
      filesTruncated: false,
      graphHasMore: false,
      graphTruncated: false,
      hasMore: false,
      truncated: false,
    })
    expect(status.get('nuovo.ts')).toBe(file)
    expect(status.get('vecchio.ts')).toBe(file)
  })
})
