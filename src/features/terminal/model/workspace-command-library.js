function normalizedSearchText(value) {
  return String(value ?? '').trim().toLocaleLowerCase('it-IT')
}

export function workspaceCommandLibraryView(categories, query) {
  const normalizedQuery = normalizedSearchText(query)
  if (!normalizedQuery) return { categories, autoExpandedIds: [] }

  const visibleCategories = []
  for (const category of categories) {
    const categoryMatches = normalizedSearchText(category.name).includes(normalizedQuery)
    const commands = categoryMatches
      ? category.commands
      : category.commands.filter((command) => normalizedSearchText(`${command.title} ${command.command} ${command.note}`).includes(normalizedQuery))
    if (categoryMatches || commands.length > 0) visibleCategories.push({ ...category, commands })
  }

  return {
    categories: visibleCategories,
    autoExpandedIds: visibleCategories.map((category) => category.id),
  }
}
