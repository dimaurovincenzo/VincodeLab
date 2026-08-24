import type { EditorTreeNode } from './editor.types'

export function toEditorTreeNodes(entries: ProjectFileTreeNode[], draftDirectoryId?: string, draftName = ''): EditorTreeNode[] {
  return entries.map((entry): EditorTreeNode => {
    if (entry.kind === 'file') return { kind: 'file', value: entry.id, id: entry.id, name: entry.name }
    const children = entry.children?.length ? toEditorTreeNodes(entry.children, draftDirectoryId, draftName) : []
    if (draftDirectoryId === entry.id) children.unshift({ kind: 'new-file', value: `editor:new-file:${entry.id}`, name: draftName, directoryId: entry.id })
    return { kind: 'directory', value: entry.id, id: entry.id, name: entry.name, loaded: entry.children !== undefined, children }
  })
}

export function replaceDirectoryChildren(entries: ProjectFileTreeNode[], directoryId: string, children: ProjectFileTreeNode[]): ProjectFileTreeNode[] {
  return entries.map((entry) => {
    if (entry.id === directoryId) return { ...entry, children }
    return entry.children ? { ...entry, children: replaceDirectoryChildren(entry.children, directoryId, children) } : entry
  })
}

export function remapProjectPath(value: string, previousId: string, nextId: string) {
  return value === previousId ? nextId : value.startsWith(`${previousId}/`) ? `${nextId}${value.slice(previousId.length)}` : value
}

export function projectEntryContainsPath(entryId: string, entryKind: 'file' | 'directory', candidate: string) {
  return candidate === entryId || (entryKind === 'directory' && (entryId === '' || candidate.startsWith(`${entryId}/`)))
}

export function projectEntriesOverlap(leftId: string, leftKind: 'file' | 'directory', rightId: string, rightKind: 'file' | 'directory') {
  return projectEntryContainsPath(leftId, leftKind, rightId) || projectEntryContainsPath(rightId, rightKind, leftId)
}

export function renameProjectTreeEntry(entries: ProjectFileTreeNode[], previousId: string, nextId: string): ProjectFileTreeNode[] {
  return entries.map((entry) => {
    if (entry.id === previousId || entry.id.startsWith(`${previousId}/`)) {
      const id = remapProjectPath(entry.id, previousId, nextId)
      return {
        ...entry,
        id,
        ...(entry.id === previousId ? { name: nextId.split('/').at(-1) ?? entry.name } : {}),
        ...(entry.children ? { children: renameProjectTreeEntry(entry.children, previousId, nextId) } : {}),
      }
    }
    return entry.children ? { ...entry, children: renameProjectTreeEntry(entry.children, previousId, nextId) } : entry
  })
}

export function removeProjectTreeEntry(entries: ProjectFileTreeNode[], entryId: string): ProjectFileTreeNode[] {
  return entries
    .filter((entry) => entry.id !== entryId)
    .map((entry) => entry.children ? { ...entry, children: removeProjectTreeEntry(entry.children, entryId) } : entry)
}

export function mergeRefreshedProjectEntries(current: ProjectFileTreeNode[], refreshed: ProjectFileTreeNode[]) {
  const currentById = new Map(current.map((entry) => [entry.id, entry]))
  return refreshed.map((entry) => {
    const existing = currentById.get(entry.id)
    return entry.kind === 'directory' && existing?.kind === 'directory' && existing.children
      ? { ...entry, children: existing.children }
      : entry
  })
}

export function findProjectTreeEntry(entries: ProjectFileTreeNode[], entryId: string): ProjectFileTreeNode | undefined {
  for (const entry of entries) {
    if (entry.id === entryId) return entry
    const nested = entry.children && findProjectTreeEntry(entry.children, entryId)
    if (nested) return nested
  }
  return undefined
}

export function filterEditorTree(entries: ProjectFileTreeNode[], query: string): ProjectFileTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('it-IT')
  if (!normalizedQuery) return entries
  return entries.flatMap((entry) => {
    if (entry.kind === 'file') return entry.name.toLocaleLowerCase('it-IT').includes(normalizedQuery) ? [entry] : []
    const children = entry.children ? filterEditorTree(entry.children, normalizedQuery) : undefined
    return entry.name.toLocaleLowerCase('it-IT').includes(normalizedQuery) || (children?.length ?? 0) > 0 ? [{ ...entry, children }] : []
  })
}
