import assert from 'node:assert/strict'
import test from 'node:test'

const library = await import('../src/features/terminal/model/workspace-command-library.js').catch(() => ({}))

const categories = [
  {
    id: 'server',
    name: 'Server',
    commands: [
      { id: 'production', title: 'Produzione', command: 'ssh api-prod', note: 'Accesso remoto' },
      { id: 'logs', title: 'Log applicativi', command: 'journalctl -f', note: '' },
    ],
  },
  { id: 'build', name: 'Build', commands: [] },
]

test('mantiene visibili le categorie e lascia i comandi collassabili senza ricerca', () => {
  assert.equal(typeof library.workspaceCommandLibraryView, 'function')

  const view = library.workspaceCommandLibraryView(categories, '')

  assert.deepEqual(view.categories.map((category) => category.id), ['server', 'build'])
  assert.deepEqual(view.autoExpandedIds, [])
})

test('la ricerca filtra i comandi ed espande automaticamente le categorie trovate', () => {
  assert.equal(typeof library.workspaceCommandLibraryView, 'function')

  const commandMatch = library.workspaceCommandLibraryView(categories, 'journal')
  assert.deepEqual(commandMatch.categories.map((category) => ({ id: category.id, commands: category.commands.map((command) => command.id) })), [
    { id: 'server', commands: ['logs'] },
  ])
  assert.deepEqual(commandMatch.autoExpandedIds, ['server'])

  const categoryMatch = library.workspaceCommandLibraryView(categories, 'build')
  assert.deepEqual(categoryMatch.categories.map((category) => category.id), ['build'])
  assert.deepEqual(categoryMatch.autoExpandedIds, ['build'])
})
