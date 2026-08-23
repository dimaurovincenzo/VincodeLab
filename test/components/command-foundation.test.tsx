import { describe, expect, it, vi } from 'vitest'
import { rankFuzzyCandidates, scoreFuzzyCandidate } from '@/lib/fuzzy-score'
import { createMemoryHistoryStorage, WorkbenchUsageHistory } from '@/lib/workbench-history'
import { WorkbenchCommandRegistry, type WorkbenchCommand } from '@/lib/workbench-command-registry'

type TestContext = {
  workspaceOpen: boolean
  focus: 'editor' | 'terminal'
}

function command(
  values: Partial<WorkbenchCommand<TestContext>> & Pick<WorkbenchCommand<TestContext>, 'id' | 'run'>,
): WorkbenchCommand<TestContext> {
  return {
    category: 'Test',
    title: values.id,
    ...values,
  }
}

describe('workbench command registry', () => {
  it('enforces unique ids and keeps bulk registration atomic', () => {
    const registry = new WorkbenchCommandRegistry<TestContext>({ workspaceOpen: true, focus: 'editor' })
    registry.register(command({ id: 'file.open', run: () => undefined }))

    expect(() => registry.register(command({ id: 'file.open', run: () => undefined })))
      .toThrow('already registered')
    expect(() => registry.registerAll([
      command({ id: 'file.save', run: () => undefined }),
      command({ id: 'file.open', run: () => undefined }),
    ])).toThrow('already registered')
    expect(registry.list().map(({ command: item }) => item.id)).toEqual(['file.open'])
  })

  it('separates contextual visibility from enabled state and notifies on context changes', async () => {
    const registry = new WorkbenchCommandRegistry<TestContext>({ workspaceOpen: false, focus: 'terminal' })
    const listener = vi.fn()
    registry.subscribe(listener)
    registry.registerAll([
      command({ id: 'file.save', when: ({ workspaceOpen }) => workspaceOpen, run: () => undefined }),
      command({ id: 'terminal.clear', enabled: ({ focus }) => focus === 'terminal', run: () => undefined }),
      command({ id: 'editor.format', enabled: ({ focus }) => focus === 'editor', run: () => undefined }),
    ])

    expect(registry.list().map(({ command: item, enabled }) => [item.id, enabled])).toEqual([
      ['terminal.clear', true],
      ['editor.format', false],
    ])
    await expect(registry.execute('file.save')).resolves.toMatchObject({ status: 'unavailable' })
    await expect(registry.execute('editor.format')).resolves.toMatchObject({ status: 'disabled' })

    registry.setContext({ workspaceOpen: true, focus: 'editor' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.list().map(({ command: item, enabled }) => [item.id, enabled])).toEqual([
      ['file.save', true],
      ['terminal.clear', false],
      ['editor.format', true],
    ])
  })

  it('normalizes run results, exposes focus requests and contains command failures', async () => {
    const registry = new WorkbenchCommandRegistry<TestContext>({ workspaceOpen: true, focus: 'editor' })
    const run = vi.fn(() => ({
      status: 'completed' as const,
      focus: { target: 'editor', select: true },
    }))
    registry.register(command({ id: 'file.open', run }))
    registry.register(command({ id: 'file.fail', run: () => { throw new Error('boom') } }))

    await expect(registry.execute('file.open', { source: 'palette', query: 'open' })).resolves.toEqual({
      status: 'executed',
      commandId: 'file.open',
      outcome: { status: 'completed', focus: { target: 'editor', select: true } },
      focus: { target: 'editor', select: true },
    })
    expect(run).toHaveBeenCalledWith(
      { workspaceOpen: true, focus: 'editor' },
      { source: 'palette', query: 'open' },
    )
    await expect(registry.execute('file.fail')).resolves.toMatchObject({ status: 'failed' })
    await expect(registry.execute('missing.command')).resolves.toEqual({
      status: 'not-found',
      commandId: 'missing.command',
    })
  })
})

describe('deterministic fuzzy ranking', () => {
  it('orders exact, basename, prefix, word-boundary and subsequence matches predictably', () => {
    const ranked = rankFuzzyCandidates('term', [
      { id: 'subsequence', label: 'Teamroom' },
      { id: 'boundary', label: 'Apri terminale' },
      { id: 'prefix', label: 'Terminale attivo' },
      { id: 'basename', label: 'File corrente', path: '/workspace/term' },
      { id: 'exact', label: 'Term' },
    ], { now: 10_000 })

    expect(ranked.map(({ item }) => item.id)).toEqual([
      'exact',
      'basename',
      'prefix',
      'boundary',
      'subsequence',
    ])
    expect(ranked.map(({ match }) => match)).toEqual([
      'exact',
      'basename-exact',
      'prefix',
      'word-boundary',
      'subsequence',
    ])
  })

  it('normalizes accents, filters non-matches and uses stable input order for ties', () => {
    const candidates = [
      { id: 'first', label: 'Caffè' },
      { id: 'second', label: 'CAFFE' },
      { id: 'missing', label: 'Terminale' },
    ]
    const firstRun = rankFuzzyCandidates('caffe', candidates, { now: 500 })
    const secondRun = rankFuzzyCandidates('caffe', candidates, { now: 500 })

    expect(firstRun.map(({ item }) => item.id)).toEqual(['first', 'second'])
    expect(secondRun).toEqual(firstRun)
  })

  it('treats path separators as word boundaries and searches visible categories', () => {
    const candidates = [
      { id: 'path', label: 'App.tsx', path: 'src/features/quick-open/App.tsx', category: 'File' },
      { id: 'category', label: 'Verifica aggiornamenti remoti', category: 'Git' },
    ]

    expect(rankFuzzyCandidates('quick open', candidates, { now: 1 }).map(({ item }) => item.id))
      .toEqual(['path'])
    expect(rankFuzzyCandidates('git', candidates, { now: 1 }).map(({ item }) => item.id))
      .toEqual(['category'])
  })

  it('adds bounded recency and frequency boosts without hiding the textual match kind', () => {
    const score = scoreFuzzyCandidate(
      'open',
      { id: 'file.open', label: 'Open file' },
      { frequency: 32, lastUsedAt: 99_000 },
      100_000,
    )

    expect(score).toMatchObject({ match: 'prefix' })
    expect(score?.usageBoost).toBeGreaterThan(100)
    expect(score?.usageBoost).toBeLessThanOrEqual(210)
  })
})

describe('bounded workbench history', () => {
  it('keeps command and scoped file metadata independently bounded and persistent', () => {
    const storage = createMemoryHistoryStorage()
    let now = 100
    const history = new WorkbenchUsageHistory({
      storage,
      maxCommands: 2,
      maxFiles: 2,
      now: () => now++,
    })

    history.recordCommand('file.open')
    history.recordCommand('file.save')
    history.recordCommand('view.terminal')
    history.recordCommand('file.save')
    history.recordFile('/src/index.ts', 'workspace-a')
    history.recordFile('/src/index.ts', 'workspace-b')
    history.recordFile('/src/app.ts', 'workspace-a')

    expect(history.list('command').map(({ id, useCount }) => [id, useCount])).toEqual([
      ['file.save', 2],
      ['view.terminal', 1],
    ])
    expect(history.list('file').map(({ id, scope }) => [id, scope])).toEqual([
      ['/src/app.ts', 'workspace-a'],
      ['/src/index.ts', 'workspace-b'],
    ])

    const restored = new WorkbenchUsageHistory({ storage, maxCommands: 2, maxFiles: 2 })
    expect(restored.getUsage('command', 'file.save')).toMatchObject({ frequency: 2 })
    expect(restored.find('file', '/src/index.ts', 'workspace-a')).toBeUndefined()
  })

  it('recovers from corrupt storage and keeps working when persistence throws', () => {
    const storage = {
      getItem: () => '{invalid',
      setItem: () => { throw new Error('quota') },
    }
    const history = new WorkbenchUsageHistory({ storage, now: () => 42 })

    expect(history.list('command')).toEqual([])
    expect(() => history.recordCommand('file.open')).not.toThrow()
    expect(history.find('command', 'file.open')).toEqual({
      id: 'file.open',
      lastUsedAt: 42,
      useCount: 1,
    })
  })

  it('notifies reactive consumers only when history metadata changes', () => {
    const history = new WorkbenchUsageHistory({ storage: null, now: () => 50 })
    const listener = vi.fn()
    const unsubscribe = history.subscribe(listener)

    history.recordCommand('file.open')
    expect(history.remove('file', 'missing.ts')).toBe(false)
    history.recordFile('src/App.tsx', 'workspace-a')
    history.clear('file')
    unsubscribe()
    history.recordCommand('file.save')

    expect(listener).toHaveBeenCalledTimes(3)
  })
})
