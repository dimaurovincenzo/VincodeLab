export type WorkspaceCommandLibraryCategory<TCommand = unknown> = {
  id: string
  name: string
  commands: TCommand[]
}

export function workspaceCommandLibraryView<TCategory extends WorkspaceCommandLibraryCategory>(
  categories: TCategory[],
  query: string,
): { categories: TCategory[]; autoExpandedIds: string[] }
