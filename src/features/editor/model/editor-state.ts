const editorStateCacheSuffixes = ['source', 'preview:image', 'preview:pdf', 'preview:csv', 'preview:markdown'] as const

export function clearCachedEditorStateForFile<TState, TScroll>(fileId: string, states: Map<string, TState>, scrollPositions: Map<string, TScroll>) {
  for (const suffix of editorStateCacheSuffixes) {
    const key = `${fileId}::${suffix}`
    states.delete(key)
    scrollPositions.delete(key)
  }
}
