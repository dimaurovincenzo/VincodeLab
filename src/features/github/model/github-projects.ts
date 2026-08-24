import type { GitHubProjectBoard, GitHubProjectField, GitHubProjectItem } from '@/bridge'

export type HierarchicalGitHubProjectItem = {
  depth: number
  item: GitHubProjectItem
}

export function matchesProjectItemSearch(item: GitHubProjectItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase('it-IT')
  const numeric = normalized.match(/^#?(\d+)$/)?.[1]
  if (numeric) return item.content?.number === Number(numeric)
  const searchableValues = [
    item.content?.title ?? item.title ?? '',
    item.status ?? '',
    ...(item.assignees ?? []),
    ...Object.values(item.fieldValues ?? {}),
  ]
  return !normalized || searchableValues.some((value) => String(value).toLocaleLowerCase('it-IT').includes(normalized))
}

export function projectFieldDataType(field: GitHubProjectField) {
  return typeof field.dataType === 'string' ? field.dataType.toLowerCase() : ''
}

export function projectFieldName(field: GitHubProjectField) {
  return typeof field.name === 'string' ? field.name.toLocaleLowerCase('it-IT') : ''
}

export function projectIssueKey(item: GitHubProjectItem) {
  const number = item.content?.number
  return Number.isInteger(number) ? `${item.content?.repository ?? ''}#${number}` : ''
}

export function orderProjectItemsByHierarchy(items: GitHubProjectItem[]) {
  const itemKeys = new Set(items.map(projectIssueKey).filter(Boolean))
  const childrenByParent = new Map<string, GitHubProjectItem[]>()
  const roots: GitHubProjectItem[] = []
  for (const item of items) {
    const parentKey = item.parent ? `${item.parent.repository ?? item.content?.repository ?? ''}#${item.parent.number}` : ''
    if (parentKey && itemKeys.has(parentKey)) childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), item])
    else roots.push(item)
  }

  const ordered: HierarchicalGitHubProjectItem[] = []
  const visited = new Set<string>()
  const visit = (item: GitHubProjectItem, depth: number) => {
    if (visited.has(item.id)) return
    visited.add(item.id)
    ordered.push({ item, depth })
    for (const child of childrenByParent.get(projectIssueKey(item)) ?? []) visit(child, depth + 1)
  }
  for (const item of roots) visit(item, 0)
  for (const item of items) visit(item, 0)
  return ordered
}

export function groupProjectItems(
  items: GitHubProjectItem[],
  groupFieldId: string,
  groupField: GitHubProjectField | undefined,
  statusField: GitHubProjectField | undefined,
) {
  const groups = new Map<string, GitHubProjectItem[]>()
  for (const item of items) {
    const groupName = groupFieldId
      ? item.fieldValues?.[groupFieldId] ?? (groupFieldId === statusField?.id ? item.status : '')
      : ''
    const label = String(groupName || (groupField ? 'Senza gruppo' : 'Tutte le attività'))
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  return groups
}

export function projectStatusCounts(items: GitHubProjectItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const statusName = String(item.status || 'Senza stato')
    counts.set(statusName, (counts.get(statusName) ?? 0) + 1)
  }
  return counts
}

export function projectBoardLimitMessages(board: GitHubProjectBoard | null) {
  if (!board) return []
  const messages: string[] = []
  if (board.fieldsHasMore) messages.push('Sono mostrati solo i primi campi disponibili.')
  if (board.fieldOptionsTruncated) messages.push('Alcune opzioni dei campi sono state abbreviate.')
  if (board.fieldsTruncated && !board.fieldsHasMore && !board.fieldOptionsTruncated) messages.push('I campi della board sono parziali.')
  if (board.itemsHasMore) messages.push('Sono mostrate solo le prime attività disponibili.')
  if (board.itemValuesTruncated) messages.push('Alcuni valori delle attività sono stati abbreviati.')
  if (board.itemsTruncated && !board.itemsHasMore && !board.itemValuesTruncated) messages.push('Le attività della board sono parziali.')
  if ((board.hasMore || board.truncated) && messages.length === 0) messages.push('La board contiene altri dati non inclusi in questa vista.')
  return messages
}
